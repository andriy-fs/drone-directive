import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../../config/gameConfig';
import { palette } from '../../../config/palette';
import type { HitTarget } from '../../../engine/game/events';
import { WeaponType } from '@drone-directive/types/enums';
import { ParticleField, ParticleKind, particleAlpha, particleRadius } from './particles';

/**
 * Draws the combustion field — the muzzle, the impact and what they leave behind.
 *
 * **Two `Graphics`, on two layers, and the split matters.** Everything airborne
 * goes on `fx` (above the units, because a flash happens in front of the hull
 * that made it); scorch marks go on `ground` (below the fog and below the units,
 * because a burn is on the field and must be darkened by the fog exactly as the
 * ground under it is). Drawn on one layer they would either float over the fog
 * or be buried by it.
 *
 * The whole field is cleared and redrawn each frame from plain state, the same
 * way `ExplosionView` works. That is affordable because it is two draw calls no
 * matter how big the fight gets, which is the reason for one shared field
 * instead of a `Graphics` per effect.
 */
export class FxView {
  readonly container: Container;
  readonly groundContainer: Container;
  private readonly air: Graphics;
  private readonly marks: Graphics;
  private readonly field = new ParticleField();
  /** Last frame's clock reading, for the delta. `null` until the first frame. */
  private last: number | null = null;

  constructor() {
    this.container = new Container();
    this.container.label = 'fx-particles';
    this.air = new Graphics();
    this.container.addChild(this.air);

    this.groundContainer = new Container();
    this.groundContainer.label = 'fx-scorch';
    this.marks = new Graphics();
    this.groundContainer.addChild(this.marks);
  }

  /**
   * A shot left a barrel. `dir` is the shooter's facing; the flash sits on it and
   * the smoke is thrown back along it, which is what makes a hull look like it
   * recoiled rather than like it lit up.
   */
  muzzle(x: number, y: number, dir: number, weapon: WeaponType): void {
    const m = gameConfig.fx.muzzle;
    const cos = Math.cos(dir);
    const sin = Math.sin(dir);

    if (weapon === WeaponType.Dew) {
      // Not a gun: no smoke, no recoil, no warmth. A cold bloom on the emitter
      // coils, in the colour of the effect it is about to inflict — `dew` and
      // `status.disabled` share a value precisely so this reads as one weapon.
      this.field.flash(x + cos * 10, y + sin * 10, m.flashRadius * 1.1, m.flashDuration * 2, palette.status.disabled, 0.85);
      return;
    }

    const launch = weapon === WeaponType.Missiles;
    const radius = launch ? m.launchFlashRadius : m.flashRadius;
    this.field.flash(x + cos * 12, y + sin * 12, radius, m.flashDuration, palette.fx.flash);
    // A few sparks straight down the barrel — this is what separates "fired" from
    // "glowed" in a single frame, which is all a 0.08 s flash gets.
    this.field.burst(x + cos * 14, y + sin * 14, dir, {
      count: launch ? 5 : 3,
      speed: 210,
      speedSpread: 0.4,
      cone: 0.3,
      length: 7,
      life: 0.16,
      color: launch ? palette.fx.exhaust : palette.fx.spark,
      alpha: 0.9,
    });
    // Behind the barrel, drifting further back. A launch dumps a real cloud; a
    // cannon leaves a wisp.
    const back = launch ? 6 : 9;
    this.field.smoke(
      x + cos * back,
      y + sin * back,
      launch ? 9 : 4.5,
      launch ? m.launchSmokeDuration : m.smokeDuration,
      palette.fx.smoke,
      launch ? 0.45 : 0.25,
      -cos * (launch ? 34 : 18),
      -sin * (launch ? 34 : 18),
    );
  }

  /**
   * A round stopped. `dir` is where it was going, so sparks are thrown *back*
   * out of the surface it struck — the impact then says which way the fire came
   * from, which is the only thing a hit on a survivor can tell the player.
   */
  impact(x: number, y: number, dir: number, weapon: WeaponType, target: HitTarget): void {
    // A round that ran out of fuel hit nothing, and must not be dressed as a hit.
    if (target === 'expired') return;
    // A dome already flashes white where a round is absorbed
    // (`ShieldDomeView`). A second effect on top would only compete with it, and
    // sparks off an energy shell would say the wrong thing entirely.
    if (target === 'dome') return;

    const i = gameConfig.fx.impact;
    // Back the way it came.
    const out = dir + Math.PI;

    if (weapon === WeaponType.Dew) {
      // No damage, no debris — the mark it leaves is electrical. The discharge
      // ring over the victim is the real tell (`EffectKind.Emp`); this is only
      // the point of contact, and it exists so a round that hits a hull the
      // weapon cannot disable still visibly *arrives*.
      this.field.flash(x, y, i.flashRadius, i.sparkDuration * 0.6, palette.status.disabled, 0.9);
      this.field.burst(x, y, out, {
        count: 5,
        speed: 120,
        speedSpread: 0.5,
        cone: Math.PI,
        length: 5,
        life: 0.22,
        color: palette.status.disabled,
        alpha: 0.8,
      });
      return;
    }

    if (target === 'terrain') {
      // A mountain ate it. Dust and grit rather than sparks: the round did not
      // reach anything, and the player is better off reading "blocked" than "hit".
      this.field.smoke(x, y, 5, i.dustDuration, palette.dust.plume, 0.5);
      this.field.burst(x, y, out, {
        count: 4,
        speed: 90,
        speedSpread: 0.5,
        cone: 1.1,
        length: 4,
        life: i.sparkDuration * 0.8,
        color: palette.dust.plume,
        alpha: 0.6,
      });
      return;
    }

    // A hull, a building, or something in the air. The loud one: this is the
    // beat the game did not draw at all before.
    const heavy = weapon === WeaponType.Missiles;
    this.field.flash(x, y, heavy ? i.flashRadius * 1.5 : i.flashRadius, i.sparkDuration * 0.3, palette.fx.flash);
    this.field.burst(x, y, out, {
      count: heavy ? i.sparkCount + 5 : i.sparkCount,
      speed: i.sparkSpeed,
      speedSpread: 0.55,
      // A wide fan rather than a full ring: debris comes off the face that was
      // struck, and the fan is what encodes the direction.
      cone: 1.0,
      length: i.sparkLength,
      life: i.sparkDuration,
      color: palette.fx.spark,
      alpha: 0.95,
    });
    if (heavy) {
      this.field.flash(x, y, i.flashRadius * 2.2, i.sparkDuration * 0.5, palette.fx.fireCore, 0.7);
      this.field.smoke(x, y, 7, gameConfig.fx.debris.smokeDuration * 0.5, palette.fx.smoke, 0.4);
    }
  }

  /**
   * The debris half of an explosion: embers thrown outward, a lingering cloud,
   * and a burn on the ground. `ExplosionView` still draws the fireball itself —
   * that is tied to the effect entity's own clock and has to stay there, while
   * everything here outlives the entity by design.
   */
  blast(x: number, y: number, radius: number): void {
    const d = gameConfig.fx.debris;
    // Scaled off the blast's own radius so a base's death throws proportionally
    // more than a robot's, without a second set of numbers for it — but scaled
    // by its *square root* and then capped. A kamikaze's radius is 120 against a
    // robot's 30, and taking that ratio straight would put a 115 px cloud and a
    // 66 px burn on the field for one detonation, which stops reading as debris
    // and starts reading as a hole punched in the ground.
    const scale = Math.min(2, Math.sqrt(radius / gameConfig.fx.explosionMaxRadius));
    this.field.burst(x, y, 0, {
      count: Math.round(d.emberCount * scale),
      speed: d.emberSpeed * scale,
      speedSpread: 0.6,
      cone: Math.PI,
      length: 8,
      life: 0.5,
      color: palette.fx.spark,
      alpha: 0.9,
    });
    const puff = gameConfig.fx.explosionMaxRadius * 0.35 * scale;
    this.field.smoke(x, y, puff, d.smokeDuration, palette.fx.smoke, 0.4);
    this.field.smoke(x + puff * 0.6, y - puff * 0.5, puff * 0.7, d.smokeDuration * 0.8, palette.fx.smoke, 0.3, 8, -14);
    this.field.scorch(x, y, gameConfig.fx.explosionMaxRadius * d.scorchScale * scale, d.scorchDuration, palette.fx.scorch, 0.3);
  }

  /** A match ended: drop everything, so the next one does not open under the last one's smoke. */
  clear(): void {
    this.field.clear();
    this.air.clear();
    this.marks.clear();
  }

  /** Age the field on the shared frame clock and redraw both halves. */
  update(now: number): void {
    // Clamped: a backgrounded tab returns with a delta of seconds, which would
    // teleport every spark across the field in one step.
    const dt = this.last === null ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.field.advance(dt);
    this.drawAir();
    this.drawMarks();
  }

  private drawAir(): void {
    const g = this.air;
    g.clear();
    for (const p of this.field.particles) {
      const alpha = particleAlpha(p);
      if (alpha <= 0) continue;
      const r = particleRadius(p);
      if (p.kind === ParticleKind.Spark) {
        // Along its own velocity: a streak whose angle disagrees with where the
        // thing is going is the one artefact that makes particles look pasted on.
        const speed = Math.hypot(p.vx, p.vy) || 1;
        g.moveTo(p.x, p.y)
          .lineTo(p.x - (p.vx / speed) * r, p.y - (p.vy / speed) * r)
          .stroke({ width: 1.6, color: p.color, alpha });
        continue;
      }
      if (p.kind === ParticleKind.Flash) {
        // A core plus a wider, fainter bloom — one circle reads as a dot, two
        // read as something too bright to have an edge.
        g.circle(p.x, p.y, r).fill({ color: p.color, alpha });
        g.circle(p.x, p.y, r * 1.9).fill({ color: p.color, alpha: alpha * 0.25 });
        continue;
      }
      g.circle(p.x, p.y, r).fill({ color: p.color, alpha });
    }
  }

  private drawMarks(): void {
    const g = this.marks;
    g.clear();
    for (const p of this.field.scorches) {
      const alpha = particleAlpha(p);
      if (alpha <= 0) continue;
      // One disc, not two. Stacking a second circle inside the first compounds
      // the alpha where they overlap — 0.3 over 0.3 is 0.51 — and a dark mark
      // that opaque is the "hole punched in the field" the `dust` palette note
      // warns about, rather than a burn on ground that still shows through.
      g.circle(p.x, p.y, particleRadius(p)).fill({ color: p.color, alpha });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.groundContainer.destroy({ children: true });
  }
}
