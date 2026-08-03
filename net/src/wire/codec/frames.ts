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
  /** `chatId` is opaque here: this package carries it and never looks inside it. */
  | { type: 'start'; seed: number; mapSize: MapSize; aiCount: number; chatId: string }
  | { type: 'tick'; tick: number; commands: Command[]; drone: DroneControl; check: WorldCheck | null }
  | { type: 'opponentLeft' }
  | { type: 'error'; code: wire.ErrorCode; message: string };

export type WorldCheck = wire.WorldCheck;
export type ErrorCode = wire.ErrorCode;
export const ErrorCode = wire.ErrorCode;

/** Encode this client's input for one tick, ready to hand to the socket. */
export function encodeTick(
  tick: number,
  commands: Command[],
  drone: DroneControl,
  check: WorldCheck | null,
): Uint8Array<ArrayBuffer> {
  const payload = wire.encodeTickMessage({
    tick,
    commands: commands.map(commandToWire),
    drone: { dir: { x: drone.dir.x, y: drone.dir.y }, possess: drone.possessPulse, fire: drone.firePulse },
    check,
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
