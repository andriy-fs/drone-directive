/** A robot's autonomous move intent for the current tick, if any (see `resolveAction`). */
export type MoveIntent = { kind: 'goal'; x: number; y: number } | { kind: 'hold' };

/** What a directive's `do` action produced this tick — a move intent, a fire intent, both, or neither. */
export interface Outcome {
  move?: MoveIntent;
  fire?: string;
}
