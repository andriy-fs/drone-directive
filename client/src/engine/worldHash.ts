import type { EcsWorld } from './ecs/world';

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
 * floats, and the rounding keeps the hash readable when logging a mismatch. The
 * directed-energy knock-out is quantised the same way and for the same reason:
 * peers that disagree on who is disabled will disagree on positions one tick
 * later, and leaving it out would hide the divergence until it had spread.
 *
 * hp is quantised to 1/1000 too, not to whole points: passive repair
 * (`systems/regen.ts`) moves it in fractions of a point per tick, and rounding
 * to integers would hide a regeneration mismatch for seconds. That fine grain is
 * also why the repair lock itself needs no field of its own here — it is only
 * ever observable through hp, which now diverges on the very next tick.
 *
 * An FPV strike drone's `ttl` is deliberately **not** in here, and adding it would
 * be redundant rather than safer: a munition moves every tick it is alive, so two
 * peers that disagreed about its remaining flight time would disagree about the
 * set of entities — and therefore about this hash — on the very next tick. The
 * fields already present catch it.
 *
 * An observer drone's `MoveDrone` goal is left out on exactly the same grounds. A
 * drone under a standing order moves every tick until it arrives, so peers that
 * disagreed about where it was sent would disagree about its `position` on the
 * very next one. The omission is a decision, not an oversight.
 *
 * A base's energy dome is the exception that proves that rule: it *prevents* hp
 * from moving, so it is not observable through hp at all and has to be hashed on
 * both its axes — how much of it is left, and how long it still stands, since
 * either changes what the next hit does. `shieldSpent` goes in too: peers that
 * disagree about whether the one charge is gone will disagree about a *second*
 * dome later, which is precisely the kind of divergence that stays invisible
 * until it decides a match.
 */
export function worldHash(world: EcsWorld): number {
  const parts: string[] = [];
  for (const e of world.entities) {
    // Skip nothing: projectile and explosion lifetimes are simulation state too,
    // and a divergence there is exactly the kind that snowballs into damage.
    const x = e.position ? Math.round(e.position.x * 1000) : 0;
    const y = e.position ? Math.round(e.position.y * 1000) : 0;
    const off = Math.round((e.disabled?.left ?? 0) * 1000);
    const hp = Math.round((e.hp ?? 0) * 1000);
    // Quantised to 1/1000 for the same reason as hp: the dome mends by 0.667 and
    // its clock moves by 0.033 per tick, so whole numbers would hide a
    // divergence for a second or more — long enough for one peer to absorb a
    // volley the other took on the chin. '-' for no dome, so "none" stays
    // distinguishable from "at zero".
    const dome = e.shield ? `${Math.round(e.shield.hp * 1000)}/${Math.round(e.shield.left * 1000)}` : '-';
    const spent = e.shieldSpent ? '1' : '0';
    // In for the same reason the dome is: while `Shield` runs it *stops* hp from
    // moving, so hp cannot be the thing that reveals a disagreement about it —
    // and the kind matters as much as the clock, since the two modes end the hull
    // in different ways. `'-'` keeps "no mode" apart from "a mode at zero".
    const ovr = e.override ? `${e.override.kind}/${Math.round(e.override.left * 1000)}` : '-';
    // Which formation, and which group of it. Membership is what decides where a
    // robot is told to stand next tick, so peers that disagree about it diverge
    // in position immediately afterwards — the divergence would be caught either
    // way, but a tick later and one step further from its cause. The shape goes
    // in with the group because the same members in a box and in a line are two
    // different sets of orders.
    const form = e.script?.blackboard.formation;
    const line = form ? `${form.gid}/${form.type}` : '-';
    parts.push(
      `${e.id}:${e.owner ?? '-'}:${x}:${y}:${hp}:${e.script?.programId ?? '-'}:${off}:${dome}:${spent}:${line}:${ovr}`,
    );
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
