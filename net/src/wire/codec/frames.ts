import { frame, MAX_AI_OPPONENTS, MessageTag, payloadOf, tagOf } from '@drone-directive/protocol';
import * as wire from '@drone-directive/protocol/codec';
import type { Command } from '@drone-directive/types/commands';
import type { DroneControl } from '@drone-directive/types/entities';
import type { MapSize } from '@drone-directive/types/enums';
import { commandFromWire, commandToWire } from './commands';
import { MAP_SIZE_FROM_WIRE } from './enums';

/** A relay frame, decoded and translated into terms the game already speaks. */
export type DecodedMessage =
  | { type: 'created'; roomCode: string }
  /**
   * `chatId` is opaque here: this package carries it and never looks inside it.
   * `resumeToken` is opaque too, but it does not leave the package — the session
   * keeps it to reclaim its own seat after a drop.
   */
  | { type: 'start'; seed: number; mapSize: MapSize; aiCount: number; chatId: string; resumeToken: string }
  | {
      type: 'tick';
      tick: number;
      commands: Command[];
      drone: DroneControl;
      check: WorldCheck | null;
      pauseToggle: boolean;
    }
  | { type: 'opponentLeft' }
  | { type: 'error'; code: wire.ErrorCode; message: string };

export type WorldCheck = wire.WorldCheck;
export type ErrorCode = wire.ErrorCode;
export const ErrorCode = wire.ErrorCode;

/**
 * Encode this client's input for one tick, ready to hand to the socket. The input
 * is taken structurally rather than as a `TickInput`: that type belongs to the
 * transport, which imports the codec and not the other way round.
 */
export function encodeTick(
  tick: number,
  input: { commands: Command[]; drone: DroneControl; pauseToggle: boolean },
  check: WorldCheck | null,
): Uint8Array<ArrayBuffer> {
  const { drone } = input;
  const payload = wire.encodeTickMessage({
    tick,
    commands: input.commands.map(commandToWire),
    drone: { dir: { x: drone.dir.x, y: drone.dir.y }, possess: drone.possessPulse, fire: drone.firePulse },
    check,
    pauseToggle: input.pauseToggle,
  });
  return frame(MessageTag.Tick, payload);
}

/**
 * Decode one received frame. `null` covers everything that isn't a message this
 * client understands — an unknown tag, a truncated payload, trailing bytes — all
 * of which a correct relay never sends and none of which is worth ending a match
 * over.
 */
export function decodeServerMessage(data: ArrayBuffer): DecodedMessage | null {
  const tag = tagOf(data);
  if (tag === null) return null;
  try {
    return decodePayload(tag, payloadOf(data));
  } catch {
    return null; // BareError: the bytes weren't what the tag promised
  }
}

function decodePayload(tag: MessageTag, payload: Uint8Array): DecodedMessage {
  switch (tag) {
    case MessageTag.Created:
      return { type: 'created', ...wire.decodeCreatedMessage(payload) };
    case MessageTag.Start: {
      const start = wire.decodeStartMessage(payload);
      return {
        type: 'start',
        seed: start.seed,
        mapSize: MAP_SIZE_FROM_WIRE[start.mapSize],
        // The relay already clamps this; clamp again rather than let a bad number
        // reach `startMatch` and try to seat more sides than the map has corners.
        aiCount: Math.min(start.aiCount, MAX_AI_OPPONENTS),
        chatId: start.chatId,
        resumeToken: start.resumeToken,
      };
    }
    case MessageTag.Tick: {
      const msg = wire.decodeTickMessage(payload);
      return {
        type: 'tick',
        tick: msg.tick,
        commands: msg.commands.map(commandFromWire),
        drone: { dir: { ...msg.drone.dir }, possessPulse: msg.drone.possess, firePulse: msg.drone.fire },
        check: msg.check,
        pauseToggle: msg.pauseToggle,
      };
    }
    case MessageTag.OpponentLeft:
      // Nothing to decode, so nothing to reject it on — insist on the empty
      // payload the schema promises rather than ignore whatever rode along.
      if (payload.length > 0) throw new Error('opponentLeft carries no payload');
      return { type: 'opponentLeft' };
    case MessageTag.Error:
      return { type: 'error', ...wire.decodeErrorMessage(payload) };
    case MessageTag.ChatSend:
    case MessageTag.ChatHistory:
    case MessageTag.ChatPosted:
    case MessageTag.ChatPresence:
      // Chat shares the tag space but runs on its own socket against its own
      // Durable Object (`@drone-directive/chat`). One arriving here means the
      // relay mixed two connections up; `decodeServerMessage` turns the throw
      // into a `null` and the frame is ignored. The switch is deliberately
      // exhaustive with no `default`, so a new tag has to be considered here.
      throw new Error('chat frame on the game socket');
  }
}
