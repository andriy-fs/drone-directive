import type { EcsWorld } from '../../engine/ecs/world';

/**
 * A cheap fingerprint of the simulated world, used to catch lockstep desyncs.
 *
 * Two peers running the same seed and the same inputs must produce identical
 * worlds; if they don't, everything they show each other afterwards is fiction.
 * Comparing full state per tick would be far too much traffic, so each peer
 * hashes its world every `DESYNC_CHECK_EVERY` ticks and ships the 32-bit result
 * (see `TickMessage.check`).
 *
 * What goes in has to be *simulation* state only — never anything derived from
 * `localSide` (fog, selection, camera), which legitimately differs per client.
 * Positions are quantised to 1/1000 px: identical simulations produce identical
 * floats, and the rounding keeps the hash readable when logging a mismatch.
 */
export function worldHash(world: EcsWorld): number {
  const parts: string[] = [];
  for (const e of world.entities) {
    // Skip nothing: projectile and explosion lifetimes are simulation state too,
    // and a divergence there is exactly the kind that snowballs into damage.
    const x = e.position ? Math.round(e.position.x * 1000) : 0;
    const y = e.position ? Math.round(e.position.y * 1000) : 0;
    parts.push(`${e.id}:${e.owner ?? '-'}:${x}:${y}:${Math.round(e.hp ?? 0)}:${e.script?.programId ?? '-'}`);
  }
  // Entity order comes from the ECS store and should already match, but sorting
  // makes the hash a statement about *contents* rather than iteration order.
  parts.sort();
  return fnv1a(parts.join('|'));
}

/** FNV-1a, 32-bit — small, fast, and good enough to catch a diverging world. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
