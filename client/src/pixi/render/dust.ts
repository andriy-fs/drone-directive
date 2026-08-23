/**
 * The dust a unit kicks up behind its drive, kept as a Pixi-free state machine for
 * the same reason `gait.ts` is: the interesting part is the arithmetic, and it is
 * worth testing without a renderer.
 *
 * **Why this exists at all.** A robot is 46 px on the field and the camera has no
 * zoom, so anything that happens *inside* the sprite — a tread scrolling, a wheel
 * turning — is a few pixels of change and reads as nothing. A trail is drawn
 * *outside* the silhouette and stays on the ground the unit has left, so it says
 * "this thing is moving, and that way" at any size. That is why the readability of
 * movement rests here rather than on the sprite sheets alone.
 *
 * **Driven by distance, not by time** — the same clock the gait uses, and for the
 * same three reasons: a stopped unit must not smoke, a unit grinding along at a
 * fraction of its speed must puff proportionally less, and neither needs a rule of
 * its own once "no travel, no puff" is the rule.
 *
 * Puffs are cosmetic and live only in the renderer. They are deliberately *not* ECS
 * effect entities like `ExplosionView`'s: nothing about a dust cloud may reach the
 * deterministic simulation, and one per robot per few pixels of travel would be a
 * lot of entities to spawn for something nobody can shoot.
 */

/** One cloud on the ground, in **world** coordinates — it does not follow the unit. */
export interface Puff {
  x: number;
  y: number;
  /** Radius at birth; it grows with age, see `puffRadius`. */
  r: number;
  /** Seconds since it was laid down. */
  age: number;
  /** Seconds it lives for. */
  life: number;
}

/** How a chassis kicks up dust. One of these per `ChassisType`, see `RobotView`. */
export interface DustSpec {
  /** Ground covered (px) between two puffs — the whole clock. */
  spacing: number;
  /** Radius (px) of a fresh puff, before it starts spreading. */
  radius: number;
  /** Seconds a puff takes to fade out. */
  life: number;
  /** Half the distance (px) between the left and right emission points. */
  spread: number;
  /** How far behind the unit's centre (px) the drive throws it. */
  offset: number;
  /** Opacity of a fresh puff. */
  alpha: number;
}

/**
 * Puffs alive at once, per unit. A ceiling rather than a tuning knob: the specs are
 * chosen so a moving unit sits well under it, and this is only what stops a pathological
 * frame (a teleport, a resumed tab) from laying down an unbounded ribbon.
 */
export const MAX_PUFFS = 12;

/** How much a puff spreads over its life — 1.8× its birth radius by the time it is gone. */
const SPREAD_GROWTH = 0.8;

/** Jitter applied to each emission point, as a fraction of `spread`. Keeps the trail from looking stamped. */
const JITTER = 0.5;

/** A puff's radius at its current age. */
export function puffRadius(puff: Puff): number {
  return puff.r * (1 + SPREAD_GROWTH * (puff.age / puff.life));
}

/**
 * A puff's opacity at its current age, `0` once it is spent.
 *
 * Squared falloff, so it is faint for most of its life: a trail whose tail is as
 * solid as its head reads as a painted stripe rather than as settling dust.
 */
export function puffAlpha(puff: Puff, spec: DustSpec): number {
  const left = 1 - puff.age / puff.life;
  return left <= 0 ? 0 : spec.alpha * left * left;
}

/**
 * The trail behind one unit: ages what is on the ground and lays down a new puff
 * every `spec.spacing` px of travel.
 *
 * Emission alternates sides, so the two wheel tracks (or the two treads, or the
 * left and right feet) are laid down in turn rather than as one central smear.
 */
export class DustTrail {
  private readonly live: Puff[] = [];
  /** Travel (px) banked since the last puff; never grows past one `spacing`. */
  private sinceLast = 0;
  /** Which side the next puff comes from, ±1. */
  private side = 1;

  get puffs(): readonly Puff[] {
    return this.live;
  }

  /**
   * @param dt      seconds since the last frame
   * @param step    ground covered (px) since the last frame; `0` when the unit is
   *                stopped, hidden or knocked out, which is what stops emission
   * @param x, y    the unit's world position
   * @param heading the unit's facing, radians (0 = +x)
   */
  advance(dt: number, step: number, x: number, y: number, heading: number, spec: DustSpec): void {
    for (const puff of this.live) puff.age += dt;
    // Splice-free compaction: a puff is dropped the frame its alpha reaches zero.
    let kept = 0;
    for (const puff of this.live) if (puff.age < puff.life) this.live[kept++] = puff;
    this.live.length = kept;

    if (step <= 0) return;
    this.sinceLast += step;
    // A single frame can cover several spacings (a slow tab, a fast unit). One puff
    // per frame regardless: the extra travel is dropped rather than laid down as a
    // burst of clouds in one spot, which is what a loop here would produce.
    if (this.sinceLast < spec.spacing) return;
    this.sinceLast = 0;

    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const lateral = this.side * spec.spread * (1 + (Math.random() - 0.5) * JITTER);
    this.side = -this.side;

    if (this.live.length >= MAX_PUFFS) this.live.shift();
    this.live.push({
      // Behind the unit along its heading, then out to one side of it.
      x: x - cos * spec.offset - sin * lateral,
      y: y - sin * spec.offset + cos * lateral,
      r: spec.radius * (0.8 + Math.random() * 0.4),
      age: 0,
      life: spec.life,
    });
  }
}
