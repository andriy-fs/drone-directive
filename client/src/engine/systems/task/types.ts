/**
 * A robot's autonomous move intent for the current tick, if any (see `resolveAction`).
 *
 * `reactive` marks an intent that exists *because* something just happened to
 * this robot rather than because of the job it was given — today only the dodge.
 * Formation keeping leaves those alone (`systems/task/formation.ts`): a unit
 * under fire strafes out of the line and walks back into it a second later,
 * which is the behaviour that keeps it alive without costing the shape.
 */
export type MoveIntent = { kind: 'goal'; x: number; y: number; reactive?: true } | { kind: 'hold' };

/** What a directive's `do` action produced this tick — a move intent, a fire intent, both, or neither. */
export interface Outcome {
  move?: MoveIntent;
  fire?: string;
}
