import type { DecodedMessage } from '../wire/codec';
import { parseCommands, parseDroneControl, type CommandLimits } from '../wire/validation';
import type { TickInput } from './types';

/** Turning a decoded frame — or nothing at all — into one tick's `TickInput`. */

export function emptyInput(): TickInput {
  return { commands: [], drone: { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false }, pauseToggle: false };
}

/**
 * Screen a decoded `tick` frame before it reaches the game. BARE has already
 * proved the shape by this point; what it cannot know is whether the values make
 * sense in *this* match — a well-formed f64 can still be `NaN`, and a well-formed
 * list of ids can still be a hundred thousand long. Anything the semantic layer
 * refuses is dropped, and an unusable drone input degrades to "idle" rather than
 * killing the match: a stalled drone is recoverable, a `NaN` position is not.
 */
export function screen(msg: Extract<DecodedMessage, { type: 'tick' }>, limits: CommandLimits): TickInput {
  return {
    commands: parseCommands(msg.commands, 'peer', limits),
    drone: parseDroneControl(msg.drone, 'peer') ?? emptyInput().drone,
    // A bool has no shape to get wrong and no bounds to exceed, so there is
    // nothing for the semantic layer to say about it.
    pauseToggle: msg.pauseToggle,
  };
}
