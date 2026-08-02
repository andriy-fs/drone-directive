import type { Command } from '@drone-directive/types/commands';
import type { DroneControl } from '@drone-directive/types/entities';
import * as v from 'valibot';
import { isDebug } from '../../debug';
import { commandSchemaFor, droneControlSchema, type CommandLimits } from './schemas';

/**
 * What to do with the rules in `schemas.ts`: batch-level policy (how many
 * commands a tick may carry, what a failure costs) and how a rejection is
 * reported.
 */

/** Where a batch came from — only used to make the dev-time warning legible. */
export type CommandOrigin = 'local' | 'peer';

/**
 * Most commands one side may issue in a single tick. A human at 30Hz produces one
 * or two; the cap exists so a hostile peer can't hand the engine a million.
 */
const MAX_COMMANDS_PER_TICK = 32;

/**
 * Validate one side's batch for a tick, dropping anything that doesn't hold up.
 * Rejection is per-command — a single bad order doesn't cost its valid neighbours
 * — except for an oversized batch, which is discarded whole rather than truncated
 * at an arbitrary point.
 */
export function parseCommands(raw: unknown, origin: CommandOrigin, limits: CommandLimits): Command[] {
  if (!Array.isArray(raw)) {
    reject(origin, 'commands is not an array');
    return [];
  }
  if (raw.length > MAX_COMMANDS_PER_TICK) {
    reject(origin, `batch of ${raw.length} commands exceeds the ${MAX_COMMANDS_PER_TICK} per-tick limit`);
    return [];
  }

  const schema = commandSchemaFor(limits);
  const commands: Command[] = [];
  for (const entry of raw) {
    const result = v.safeParse(schema, entry);
    if (result.success) commands.push(result.output);
    else reject(origin, summarize(result.issues));
  }
  return commands;
}

/** Validate one side's drone input for a tick; `null` means "unusable, treat as idle". */
export function parseDroneControl(raw: unknown, origin: CommandOrigin): DroneControl | null {
  const result = v.safeParse(droneControlSchema, raw);
  if (result.success) return result.output;
  reject(origin, summarize(result.issues));
  return null;
}

/**
 * Dropping input is silent in production — a match must not die over one bad
 * order — but in dev it's worth seeing, and worth knowing which side produced it:
 * `local` points at a UI bug, `peer` at a broken or hostile client.
 */
function reject(origin: CommandOrigin, reason: string): void {
  if (isDebug()) console.warn(`[net] dropped ${origin} input: ${reason}`);
}

function summarize(issues: readonly v.BaseIssue<unknown>[]): string {
  const first = issues[0];
  if (!first) return 'invalid';
  const path = first.path?.map((p) => String(p.key)).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}
