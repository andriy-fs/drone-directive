/**
 * The maths behind the missile launcher on a base's roof — where it points while
 * nothing is being shot at, how far it rocks back when it fires, and how ready it
 * looks while it reloads. Pure functions, so the feel can be tested without a
 * renderer, on the same terms as `gait.ts` and `cycle.ts`.
 *
 * **All three are decoration and none of them may reach the simulation.** The
 * battery's `heading` and its `cooldownLeft` are simulation state, identical on both
 * peers; what this module adds is read off them and drawn, never written back. That
 * is also why the scan below is a function of wall-clock time rather than of the tick
 * count: a lockstep peer that stalled for a frame must not end up with a launcher
 * pointing somewhere else.
 */

/** How far (radians) the idle scan swings either side of the last known bearing. */
const SCAN_AMPLITUDE = 0.44; // ~25°
/**
 * Seconds for one full there-and-back sweep. Exported because callers offset the
 * clock by a fraction of it, so two bases on screen do not sweep in lockstep.
 */
export const SCAN_PERIOD_S = 8;

/**
 * Bearing offset (radians) for a launcher with nothing to shoot at.
 *
 * A sine rather than a ramp, because the ends are what the eye reads: a turret that
 * slows into the edge of its sector and comes back is machinery searching, while one
 * that runs at a constant rate and snaps around is a rotating prop. The amplitude is
 * small on purpose — this is a launcher looking for work, not a radar sweeping the
 * map, and the dish on the roof already does the second job.
 */
export function idleScan(elapsedS: number): number {
  return SCAN_AMPLITUDE * Math.sin((elapsedS / SCAN_PERIOD_S) * Math.PI * 2);
}

/** How far (px) the launcher slides back on its mount at the peak of a shot. */
const RECOIL_PX = 3;
/** Seconds from the shot to the launcher being back where it started. */
const RECOIL_S = 0.18;
/** Share of that window spent travelling backwards; the rest is the return. */
const RECOIL_KICK = 0.25;

/**
 * How far back along its own barrels (px) the launcher sits, `sinceShotS` seconds
 * after firing.
 *
 * Asymmetric on purpose: a quarter of the window to slam back, three quarters to
 * settle. Equal halves read as a wobble — recoil is violent one way and damped the
 * other, and at 3 px that difference in timing is the only thing carrying the weight.
 */
export function recoilPx(sinceShotS: number): number {
  if (sinceShotS < 0 || sinceShotS >= RECOIL_S) return 0;
  const phase = sinceShotS / RECOIL_S;
  return phase < RECOIL_KICK
    ? RECOIL_PX * (phase / RECOIL_KICK)
    : RECOIL_PX * (1 - (phase - RECOIL_KICK) / (1 - RECOIL_KICK));
}

/**
 * How reloaded the battery is, in `[0, 1]`, from the weapon's own countdown — 0 the
 * instant it fires, 1 when it can fire again.
 *
 * A zero `cooldown` reads as "always ready" rather than as a division by zero: every
 * unarmed weapon in `gameConfig` has one, and a base that somehow carried one should
 * still draw a launcher that looks loaded.
 */
export function reloadFill(cooldownLeft: number, cooldown: number): number {
  if (cooldown <= 0) return 1;
  const fill = 1 - cooldownLeft / cooldown;
  return fill < 0 ? 0 : fill > 1 ? 1 : fill;
}

/** How dark the launcher goes at the bottom of a reload, as a share of its own colour. */
const RELOAD_DIM = 0.62;

/**
 * Tint for a launcher that is `fill` reloaded (see `reloadFill`) — a neutral grey
 * multiplier, so it darkens whatever the art is painted rather than colouring it.
 *
 * The cue is the tubes going cold and coming back up, which is the one thing a
 * top-down launcher can say about its own state without growing a gauge. It rides on
 * `tint` rather than on an overlay for the same reason the module has no bolts: at
 * 34 px anything drawn *on* the art is mush, while the whole thing changing value is
 * legible at a glance.
 */
export function reloadTint(fill: number): number {
  const v = Math.round(255 * (RELOAD_DIM + (1 - RELOAD_DIM) * fill));
  return (v << 16) | (v << 8) | v;
}
