/**
 * The combustion field: muzzle flashes, impact sparks, smoke and the scorch a
 * blast leaves on the ground. Kept as a Pixi-free state machine for the same
 * reason `dust.ts` and `gait.ts` are — the interesting part is the arithmetic,
 * and it is worth testing without a renderer.
 *
 * **Why it lives here and not in the ECS.** The rule is `dust.ts`'s, and this is
 * the same class of thing: a cannon fires every 0.8 s, a five-drone salvo lands
 * in one second, and every one of those wants a flash, a puff and a handful of
 * sparks. As effect entities that is hundreds of spawns and removals a minute in
 * the deterministic world, for something nobody can shoot and no rule reads.
 * Nothing in here may ever reach the simulation, which is why the whole module
 * takes plain numbers and returns plain numbers.
 *
 * **Why one field rather than one object per effect.** Particles outlive the
 * thing that emitted them — a robot may die while its own muzzle smoke is still
 * drifting — so they cannot hang off an entity view. One field owned by the
 * renderer, drawn by one `Graphics`, is also what keeps the draw-call count flat
 * as a firefight grows.
 */

/**
 * What a particle is drawn as. The four are separate kinds rather than one
 * parameterised blob because they age differently and that difference *is* the
 * effect: a flash dies before the eye tracks it, sparks fly and slow down, smoke
 * grows as it fades, and a scorch mark does not move at all.
 */
export const ParticleKind = {
  /** Ignition: a star at a point, gone within a tenth of a second. */
  Flash: 'flash',
  /** A thrown ember or chip — travels, decelerates, draws as a streak along its own velocity. */
  Spark: 'spark',
  /** A cloud that expands as it thins. Muzzle smoke, a launch cloud, what a fireball leaves behind. */
  Smoke: 'smoke',
  /** A burn on the ground. Static, long-lived, drawn under the units and under the fog. */
  Scorch: 'scorch',
} as const;
export type ParticleKind = (typeof ParticleKind)[keyof typeof ParticleKind];

/** One particle, in **world** coordinates — it does not follow whatever emitted it. */
export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  /** Velocity, px/s. Zero for a flash and a scorch, which do not travel. */
  vx: number;
  vy: number;
  /** Radius at birth for a flash/smoke/scorch; streak length at birth for a spark. */
  r: number;
  /** Seconds since it was emitted. */
  age: number;
  /** Seconds it lives for. */
  life: number;
  color: number;
  /** Opacity at birth; the falloff over `life` is per kind, see `particleAlpha`. */
  alpha: number;
}

/**
 * Airborne particles alive at once, across the whole field. A ceiling rather
 * than a tuning knob — same intent as `MAX_PUFFS` in `dust.ts`: the emission
 * numbers are chosen so a busy fight sits comfortably under it, and this is only
 * what stops a pathological case (a resumed tab, twenty units firing into one
 * spot) from growing the list without bound. Oldest out first.
 */
export const MAX_PARTICLES = 220;

/**
 * Scorch marks kept on the ground. Far fewer, because they last an order of
 * magnitude longer than anything airborne and a field littered with old burns
 * stops reading as damage and starts reading as texture.
 */
export const MAX_SCORCH = 24;

/** How much of its speed a spark keeps per second — enough to arc and settle rather than fly off screen. */
const SPARK_DRAG = 0.12;

/** How far a smoke cloud spreads over its life, as a fraction of its birth radius. */
const SMOKE_GROWTH = 1.4;

/**
 * A particle's drawn radius (or streak length, for a spark) at its current age.
 *
 * The three moving kinds each expand or contract on a curve that matches what
 * they are: smoke swells, a flash collapses inward as it dies rather than merely
 * fading (which is what makes it read as a *pop*), and a spark shortens as it
 * slows because a streak's length is really its speed.
 */
export function particleRadius(p: Particle): number {
  const t = p.age / p.life;
  switch (p.kind) {
    case ParticleKind.Smoke:
      return p.r * (1 + SMOKE_GROWTH * t);
    case ParticleKind.Flash:
      return p.r * (1 - t * 0.55);
    case ParticleKind.Spark:
      return p.r * (1 - t * 0.7);
    default:
      return p.r;
  }
}

/**
 * A particle's opacity at its current age, `0` once it is spent.
 *
 * Squared falloff for smoke, for `dust.ts`'s reason — a cloud as solid at its
 * end as at its start reads as paint. Linear for the two hot kinds, because a
 * spark that fades early looks like it went out rather than like it landed. A
 * scorch holds flat and then drops over its last third: a burn does not fade
 * gradually, it gets rained on.
 */
export function particleAlpha(p: Particle): number {
  const left = 1 - p.age / p.life;
  if (left <= 0) return 0;
  switch (p.kind) {
    case ParticleKind.Smoke:
      return p.alpha * left * left;
    case ParticleKind.Scorch:
      return p.alpha * Math.min(1, left * 3);
    default:
      return p.alpha * left;
  }
}

/** How a burst of sparks is thrown. Shared by the muzzle and the impact, which differ only in numbers. */
export interface BurstSpec {
  /** How many sparks. */
  count: number;
  /** Metres per second, before the per-spark spread below. */
  speed: number;
  /** Fractional spread on `speed`, so a burst is not a perfect ring of equal-length streaks. */
  speedSpread: number;
  /** Half-angle (radians) the burst is confined to, around the direction it is given. `Math.PI` = all round. */
  cone: number;
  /** Streak length at birth, px. */
  length: number;
  life: number;
  color: number;
  alpha: number;
}

/**
 * Every live particle, aged in one pass and emitted into by the bus adapters.
 *
 * There is deliberately no per-emitter bookkeeping: a flash does not belong to
 * the robot that fired it once it exists, which is exactly what lets a hull be
 * destroyed on the same tick it shoots without taking its own muzzle flash with
 * it.
 */
export class ParticleField {
  private readonly live: Particle[] = [];
  private readonly marks: Particle[] = [];

  /** Airborne particles — flashes, sparks, smoke. Drawn on the `fx` layer. */
  get particles(): readonly Particle[] {
    return this.live;
  }

  /** Ground scorch. Drawn on the `ground` layer, so units cover it and fog darkens it. */
  get scorches(): readonly Particle[] {
    return this.marks;
  }

  /** Age everything and drop what is spent. Splice-free compaction, as in `DustTrail.advance`. */
  advance(dt: number): void {
    age(this.live, dt, true);
    age(this.marks, dt, false);
  }

  /** Drop everything — a match ended, and the next one must not open under the last one's smoke. */
  clear(): void {
    this.live.length = 0;
    this.marks.length = 0;
  }

  flash(x: number, y: number, r: number, life: number, color: number, alpha = 1): void {
    this.add(this.live, MAX_PARTICLES, { kind: ParticleKind.Flash, x, y, vx: 0, vy: 0, r, age: 0, life, color, alpha });
  }

  smoke(x: number, y: number, r: number, life: number, color: number, alpha: number, vx = 0, vy = 0): void {
    this.add(this.live, MAX_PARTICLES, { kind: ParticleKind.Smoke, x, y, vx, vy, r, age: 0, life, color, alpha });
  }

  /**
   * A spray of sparks from `x, y`, centred on `dir` (radians) and confined to
   * `spec.cone` either side of it.
   *
   * The cone is what carries the information: sparks off a hull fly *back* along
   * the round that struck it, so the direction a shot came from is readable from
   * the impact alone — which is the whole reason to draw one on a target that
   * survives the hit.
   */
  burst(x: number, y: number, dir: number, spec: BurstSpec): void {
    for (let i = 0; i < spec.count; i++) {
      const a = dir + (Math.random() * 2 - 1) * spec.cone;
      const speed = spec.speed * (1 - spec.speedSpread + Math.random() * spec.speedSpread * 2);
      this.add(this.live, MAX_PARTICLES, {
        kind: ParticleKind.Spark,
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: spec.length * (0.7 + Math.random() * 0.6),
        age: 0,
        // Staggered, so a burst dies out over a moment instead of all at once.
        life: spec.life * (0.7 + Math.random() * 0.6),
        color: spec.color,
        alpha: spec.alpha,
      });
    }
  }

  scorch(x: number, y: number, r: number, life: number, color: number, alpha: number): void {
    this.add(this.marks, MAX_SCORCH, {
      kind: ParticleKind.Scorch,
      x,
      y,
      r,
      age: 0,
      life,
      color,
      alpha,
      vx: 0,
      vy: 0,
    });
  }

  private add(into: Particle[], cap: number, p: Particle): void {
    if (into.length >= cap) into.shift();
    into.push(p);
  }
}

/** Age one list in place, moving what travels and dropping what is spent. */
function age(list: Particle[], dt: number, moves: boolean): void {
  let kept = 0;
  for (const p of list) {
    p.age += dt;
    if (p.age >= p.life) continue;
    if (moves && (p.vx !== 0 || p.vy !== 0)) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Exponential drag, framerate-independent: a spark should slow by the same
      // fraction per second whether the frame took 16 ms or 50.
      const keep = SPARK_DRAG ** dt;
      p.vx *= keep;
      p.vy *= keep;
    }
    list[kept++] = p;
  }
  list.length = kept;
}
