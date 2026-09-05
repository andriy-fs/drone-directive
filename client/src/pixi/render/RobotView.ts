import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { RobotEntity } from '../../engine/ecs/archetypes';
import { overrideDuration } from '../../engine/systems/override';
import { useGameStore } from '../../store/gameStore';
import { selectOwnRobotsByWeapon } from '../../store/selection';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import { GAIT_STRIDE_PX, WEAPON_TARGET } from '../../config/sprites';
import { getRobotGaitTextures, getRobotTexture, getWeaponTexture, type ResolvedSprite } from '../assets';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { DustTrail, puffAlpha, puffRadius, type DustSpec } from './dust';
import { gaitPhase } from './gait';
import { HealthBar } from './HealthBar';
import { ownerColor, teamTint } from './ownerColor';

/**
 * How a chassis moves *as a body* — roll (radians), sideways waddle (px, across the
 * heading) and high-frequency `jitter` (px, a third-harmonic tremble on top of the
 * waddle), all at the peak of a cycle.
 *
 * **This is the half of the animation that survives the on-field size.** A unit is
 * 46 px with no zoom, so a tread or a wheel turning inside the silhouette is a couple
 * of pixels of change and reads as nothing; the whole hull leaning does read. So the
 * numbers are chosen for legibility at 46 px, not for physical modesty — the earlier
 * 0.02 rad / 0.4 px on `wheels` was invisible in game, which is what prompted this.
 *
 * They still differ by drive, or the vehicles look drunk: a walker (0.045 rad, ~0.9 px)
 * is a body thrown from one tripod to the other; a tank grinds, so it gets roll and
 * almost no waddle; a light buggy on soft suspension gets the least roll, the most
 * bounce, and the only `jitter` — that tremble *is* a buggy at speed.
 */
const GAIT_BODY: Record<ChassisType, { sway: number; bob: number; jitter: number }> = {
  legs: { sway: 0.045, bob: 0.9, jitter: 0 },
  tracks: { sway: 0.02, bob: 0.5, jitter: 0 },
  wheels: { sway: 0.03, bob: 1.6, jitter: 0.6 },
};

/**
 * How each chassis kicks up dust (see `dust.ts` for what the fields mean and why the
 * trail exists). Read against the chassis speeds in `gameConfig`, `spacing` is a rate:
 *
 * - `wheels` (135 px/s): a puff every 10 px, ~13/s — a light buggy roostering along.
 * - `tracks` (60 px/s): every 12 px, ~5/s, thrown wide — two grinding bands, so the
 *   emission points sit far apart and the clouds are the biggest here.
 * - `legs` (42 px/s): every 14 px, ~3/s. One thump per stride-ish, small and short,
 *   because a walker plants its feet rather than dragging anything.
 *
 * `offset` puts the source behind the hull's centre; a puff born under the sprite is
 * hidden by it, which is the whole difference between a trail that reads and one that
 * does not.
 */
const DUST: Record<ChassisType, DustSpec> = {
  legs: { spacing: 14, radius: 2.4, life: 0.5, spread: 7, offset: 8, alpha: 0.3 },
  tracks: { spacing: 12, radius: 3.4, life: 0.75, spread: 8, offset: 13, alpha: 0.34 },
  wheels: { spacing: 10, radius: 2.8, life: 0.6, spread: 9, offset: 12, alpha: 0.38 },
};
/**
 * The kamikaze fuse's blink, in `[0, 1]`, off the seconds it has left.
 *
 * `FUSE_BLINK_HZ` is the rate at one second remaining and it climbs from there,
 * because the phase is `left²`: the flashing visibly quickens as the blast nears,
 * which is the difference between a warning and a decoration. Shared by the arc and
 * by the blast ring's lift so the two pulse together rather than beating against
 * each other.
 */
function blink(left: number): number {
  return 0.5 + 0.5 * Math.cos(left * left * Math.PI * 2 * FUSE_BLINK_HZ);
}

/** Blinks per second at one second left; faster as the fuse runs down (see `blink`). */
const FUSE_BLINK_HZ = 5;
/**
 * What the standing blast ring is dimmed to when no fuse is lit — the look it has
 * always had. The geometry is painted at the brightness it reaches on a blink and
 * held here, so lighting the fuse has somewhere to go: alpha only goes down from 1.
 */
const FUSE_ZONE_REST = 0.45;

/** Seconds for the gait to spin up from a standstill, or to settle back into one. */
const GAIT_EASE_S = 0.15;
/** Below this amplitude the walker is treated as stopped and snapped back to its stance. */
const GAIT_REST = 0.02;
/** Frame-time ceiling (s) for the amplitude easing, so a stalled tab doesn't jump it. */
const GAIT_MAX_DT = 0.1;

/**
 * View for a robot entity. If its chassis has a registered sprite it is drawn as
 * a (cropped) Sprite; otherwise a coloured Graphics placeholder (shape by
 * chassis, marker by weapon). `body` rotates with heading; the HP bar and
 * selection ring stay upright.
 *
 * **Movement is animated on two channels, both clocked off distance travelled rather
 * than off the wall clock.** A chassis with a movement-cycle sheet (see
 * `robotGaitSprites`) has `update` swap the sprite's texture between the sheet's
 * cells; every chassis, sheet or not, gets the renderer's own half — the body rolling
 * and trembling (`GAIT_BODY`) and a dust trail on the ground behind it (`DUST`). The
 * second channel is the one that survives the 46 px on-field size, which is why a
 * chassis still waiting for its sheet is not a chassis that slides.
 */
export class RobotView {
  readonly container: Container;
  private readonly body: Container;
  private readonly ring: Graphics;
  private readonly spotted: Graphics;
  private readonly stunned: Graphics;
  private readonly stunnedRadius: number;
  /** The kamikaze blast-radius ring, kept so a lit fuse can pulse it; null on any other hull. */
  private readonly blastZone: Graphics | null;
  /** The countdown drawn over a kamikaze whose fuse is burning; repainted every frame. */
  private readonly fuse: Graphics;
  private readonly fuseRadius: number;
  /** The same countdown for an armed service-menu mode; its own layer, its own colour. */
  private readonly overrideMark: Graphics;
  private readonly healthBar: HealthBar;
  private readonly isEnemy: boolean;
  private lastClickAt = 0;

  /** The chassis sprite, kept so the gait can retexture it; null on a Graphics placeholder. */
  private readonly img: Sprite | null;
  /** The movement-cycle cells in cycle order, or null for a chassis with no sheet. */
  private readonly gait: ResolvedSprite[] | null;
  private frame = 0;
  /** The dust on the ground behind this unit, and the Graphics it is drawn into. */
  private readonly trail = new DustTrail();
  private readonly dust: Graphics;
  /** Whether `dust` currently has anything painted in it — see `drawDust`. */
  private dusty = false;
  /** Ground covered (px) since the cycle last reset; the clock for every channel. */
  private travelled = 0;
  private lastX: number;
  private lastY: number;
  /** Gait strength in `[0, 1]`, eased so a stopping walker doesn't freeze mid-lean. */
  private amp = 0;
  private lastNow: number;

  constructor(robot: RobotEntity) {
    const r = gameConfig.robots.radius;
    const local = useGameStore.getState().localSide;
    this.isEnemy = robot.owner !== local;
    this.container = new Container();
    this.container.label = `robot:${robot.id}`;
    // Only the player's own robots are interactive (for click-select). Enemy
    // robots stay pointer-transparent so a right-click on them reaches the stage
    // handler (→ attack order); otherwise the view would swallow the event.
    if (!this.isEnemy) {
      this.container.eventMode = 'static';
      this.container.cursor = 'pointer';
    }

    // Kamikaze blast-radius ring: shown on every bomb-armed robot, on both
    // sides — the payload's kill zone matters whether it's yours or theirs.
    if (robot.weaponType === WeaponType.Bomb && robot.weapon.explosionRadius > 0) {
      // Painted at the alpha it reaches at the *peak of a blink*, then held down to
      // `FUSE_ZONE_REST` by the node's own alpha — which is what leaves the pulse
      // somewhere to go. A Graphics drawn at its resting alpha could only ever be
      // dimmed, since a display object's alpha is capped at 1.
      const blast = new Graphics();
      blast
        .circle(0, 0, robot.weapon.explosionRadius)
        .fill({ color: palette.blast.zone, alpha: 0.05 / FUSE_ZONE_REST })
        .stroke({ width: 1, color: palette.blast.zone, alpha: 0.4 / FUSE_ZONE_REST });
      blast.alpha = FUSE_ZONE_REST;
      this.container.addChild(blast);
      this.blastZone = blast;
    } else {
      this.blastZone = null;
    }

    this.body = new Container();
    this.gait = getRobotGaitTextures(robot.chassis, robot.owner);
    // Cell 0 of a walk cycle is the neutral stance, so a walker with a sheet and one
    // without start from the same pose and the fallback costs nothing visually.
    const sprite = this.gait?.[0] ?? getRobotTexture(robot.chassis, robot.owner);
    // Weapon-module overlay for the central hardpoint (radar/bomb have art);
    // when present it replaces the drawn weapon marker to avoid doubling up.
    const weaponSprite = robot.weaponType && robot.owner ? getWeaponTexture(robot.weaponType, robot.owner) : null;
    let outerRadius = r;

    const tint = teamTint(robot.owner);

    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? gameConfig.grid.tilePx * 1.4;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      img.rotation = def.rotationOffset ?? 0;
      if (tint !== undefined) img.tint = tint;
      this.body.addChild(img);
      this.img = img;

      outerRadius = target / 2;
    } else {
      this.body.addChild(drawBody(robot, r, !weaponSprite));
      this.img = null;
    }

    // Note what is *not* passed here: the team tint. Every module is authored in
    // its weapon's colour (`palette.weapon`) over neutral gunmetal, and
    // multiplying that by a side colour would destroy the one channel that
    // survives the downscale to 30 px — for sides `AI2`/`AI3` specifically, which
    // is exactly where telling a cannon from a jammer matters most. The tinted
    // chassis under it still says whose it is.
    if (weaponSprite) this.body.addChild(weaponModule(weaponSprite));

    this.ring = new Graphics();
    this.ring.circle(0, 0, outerRadius + 5).stroke({ width: 2, color: palette.selection.ring });
    this.ring.visible = false;

    // Detection highlight: rings when this (enemy) robot is currently spotted.
    this.spotted = new Graphics();
    this.spotted.circle(0, 0, outerRadius + 9).stroke({ width: 2, color: palette.vision.spotted });
    this.spotted.visible = false;

    // Knocked out by a directed-energy hit: a caged hull with sparks arcing over
    // it. Shown for both sides — which units are out of the fight right now is
    // the whole point of the weapon, and it has to be readable at a glance from
    // either end of it. Redrawn each frame (see `update`) so it crackles: a
    // static badge is easy to miss in a moving fight, a flickering one is not.
    this.stunnedRadius = outerRadius + 4;
    this.stunned = new Graphics();
    this.stunned.visible = false;

    // The lit fuse: a ring that empties as the second runs out, over a hull that has
    // stopped dead. Shown for both sides, like the knock-out above and for the same
    // reason — `armingTime` exists so that both the attacker and the defender get to
    // act on it, and neither can act on something they cannot see. Repainted every
    // frame (see `drawFuse`) because it is a clock, not a badge.
    this.fuseRadius = outerRadius + 7;
    this.fuse = new Graphics();
    this.fuse.visible = false;
    this.overrideMark = new Graphics();
    this.overrideMark.visible = false;

    this.healthBar = new HealthBar(2 * outerRadius + 6, 4);
    this.healthBar.container.position.set(0, -(outerRadius + 10));

    // The trail goes in first, so it is drawn under everything this unit owns, and
    // into `container` rather than `body`: `body` carries the heading (and the sway
    // added on top of it), while a puff, once laid down, belongs to the ground.
    this.dust = new Graphics();
    this.container.addChild(
      this.dust,
      this.ring,
      this.spotted,
      this.body,
      this.stunned,
      this.fuse,
      this.overrideMark,
      this.healthBar.container,
    );

    if (!this.isEnemy) {
      // Pin the clickable area to the robot's own body — without this, the
      // health bar sitting above it would expand hit-testing past the body
      // and swallow drag-select clicks anywhere near an allied robot.
      this.container.hitArea = new Circle(0, 0, outerRadius + 5);
      this.container.on('pointerdown', (e) => {
        if (e.button !== 0) return; // left-click selects; right-click falls to the stage
        e.stopPropagation(); // don't let the stage start a pan / marquee / deselect
        const store = useGameStore.getState();

        const now = performance.now();
        // Double left-click (no shift): select every player robot sharing this
        // one's weapon type — a quick way to pull together e.g. all cannons.
        if (!e.shiftKey && now - this.lastClickAt < DOUBLE_CLICK_MS) {
          this.lastClickAt = 0; // consume so a third click starts a fresh pair
          // The same manoeuvre the selection dialog offers, and the same function:
          // see `store/selection.ts` for why it is not written out here.
          selectOwnRobotsByWeapon(robot.weaponType);
          return;
        }
        this.lastClickAt = now;

        // A finger has no way to clear a selection by clicking open ground — that
        // gesture is the move order now (see `input/pointer.ts`) — so tapping a
        // robot you already have drops it, the same escape the drone has. After
        // the double-tap branch on purpose: taking it first would make the second
        // tap of a "select all of this type" land on an empty selection.
        if (e.pointerType === 'touch' && store.selectedRobotIds.includes(robot.id)) {
          store.selectRobots([]);
          return;
        }

        if (e.shiftKey) store.toggleRobot(robot.id);
        else store.selectRobots([robot.id]);
      });
    }

    this.lastX = robot.position.x;
    this.lastY = robot.position.y;
    this.lastNow = performance.now();
    this.update(robot, false, true, this.lastNow);
  }

  update(robot: RobotEntity, selected: boolean, visible: boolean, now: number): void {
    this.container.visible = visible;
    if (robot.position) this.container.position.set(robot.position.x, robot.position.y);
    this.body.rotation = robot.heading;
    this.healthBar.set(robot.hp / robot.maxHp);
    this.ring.visible = selected;
    this.spotted.visible = this.isEnemy && visible;

    // "The lights went out": the hull dims and sparks crawl over it.
    const off = (robot.disabled?.left ?? 0) > 0;
    this.stunned.visible = off;
    this.body.alpha = off ? 0.45 : 1;
    if (off) this.drawStunned();

    // Committed to its own blast: the countdown over the hull, and the kill zone it
    // is about to fill brought up out of its resting whisper — the ring is a standing
    // fact on every kamikaze, so it has to change to mean "now".
    const fuseLeft = robot.arming?.left ?? 0;
    this.fuse.visible = fuseLeft > 0;
    if (fuseLeft > 0) this.drawFuse(robot, fuseLeft);
    if (this.blastZone) {
      this.blastZone.alpha = fuseLeft > 0 ? FUSE_ZONE_REST + (1 - FUSE_ZONE_REST) * blink(fuseLeft) : FUSE_ZONE_REST;
    }

    // The limiters are off: the same countdown idiom as the fuse, because it is
    // the same kind of fact — a machine that has committed, with seconds left.
    // Its own layer and its own colour so the two can never be read as each
    // other, and shown to the enemy as well as the owner: a mode the other side
    // cannot see is a mode they cannot answer.
    const armedFor = robot.override?.left ?? 0;
    this.overrideMark.visible = armedFor > 0;
    if (armedFor > 0) this.drawOverrideMark(robot, armedFor);

    // After `body.rotation`, which the sway adds to rather than replaces.
    this.move(robot, visible && !off, now);
  }

  /**
   * Advances everything this unit does *because it is moving*: which cell of its
   * sheet is showing, how far the body is rolled and waddled off its heading, and the
   * dust it leaves behind.
   *
   * All of it is clocked by **ground covered**, so none of it needs separate rules
   * for stopping, for a chassis speed, or for a unit inching along because something
   * is in its way — all three fall out of "no travel, no step". A chassis with no
   * sheet still gets the body and the dust: those two are what make movement legible
   * at 46 px, and they must not wait on art.
   */
  private move(robot: RobotEntity, moving: boolean, now: number): void {
    // Measured even on frames where the unit is fogged or knocked out, and only
    // *spent* when it is moving. Otherwise a march made out of sight is repaid in
    // one lump the moment it is seen again — the cycle would jump to a random phase
    // and the trail would appear as a burst of clouds in one spot.
    const dx = robot.position.x - this.lastX;
    const dy = robot.position.y - this.lastY;
    this.lastX = robot.position.x;
    this.lastY = robot.position.y;

    const dt = Math.min((now - this.lastNow) / 1000, GAIT_MAX_DT);
    this.lastNow = now;

    const step = moving ? Math.hypot(dx, dy) : 0;
    this.travelled += step;

    // Eased, not switched: a unit that stops mid-stride would otherwise freeze at
    // whatever angle the sway had reached and stand there leaning.
    this.amp += ((step > 0 ? 1 : 0) - this.amp) * Math.min(1, dt / GAIT_EASE_S);
    if (this.amp < GAIT_REST) {
      this.amp = 0;
      this.travelled = 0; // rest on cell 0, the stance the sheet is drawn around
    }

    const frames = this.gait;
    const stride = GAIT_STRIDE_PX[robot.chassis];
    // `frames.length` when there is a sheet; four otherwise, so a chassis still
    // waiting for its art rolls through the same phase its sheet would have given it.
    const { frame, sway } = gaitPhase(this.travelled, stride, frames?.length ?? 4);

    if (frames && this.img && frame !== this.frame) {
      this.frame = frame;
      this.img.texture = frames[frame].texture;
    }

    // The sway goes on `body` rather than on the chassis sprite because the weapon
    // module is bolted to the hardpoint *inside* `body`: rolling the hull out from
    // under its own gun would visibly unstick the two. The selection ring, the
    // spotted marker and the HP bar sit outside `body` and stay level, which is
    // right — they are interface, not hull.
    const spec = GAIT_BODY[robot.chassis];
    const roll = sway * this.amp;
    this.body.rotation += roll * spec.sway;
    // `body.position` lives in the container's (unrotated) space, so the sideways
    // direction has to be derived from the heading rather than borrowed from the
    // rotation just applied.
    const tremble = spec.jitter ? Math.sin((this.travelled / stride) * Math.PI * 6) * spec.jitter * this.amp : 0;
    const bob = roll * spec.bob + tremble;
    this.body.position.set(-Math.sin(robot.heading) * bob, Math.cos(robot.heading) * bob);

    this.trail.advance(dt, step, robot.position.x, robot.position.y, robot.heading, DUST[robot.chassis]);
    this.drawDust(robot);
  }

  /**
   * Repaints the trail. Puffs are stored in world space and this Graphics lives in
   * the unit's container, so each one is drawn at its offset *back* to where it was
   * laid down — that subtraction is the whole reason the trail stays on the ground
   * instead of being towed along.
   */
  private drawDust(robot: RobotEntity): void {
    const g = this.dust;
    // A parked unit has an empty trail, and most units on the field are parked most
    // of the time; without this it would still pay a clear() every frame each.
    if (!this.trail.puffs.length) {
      if (this.dusty) g.clear();
      this.dusty = false;
      return;
    }
    this.dusty = true;
    g.clear();
    const spec = DUST[robot.chassis];
    for (const puff of this.trail.puffs) {
      g.circle(puff.x - robot.position.x, puff.y - robot.position.y, puffRadius(puff)).fill({
        color: palette.dust.plume,
        alpha: puffAlpha(puff, spec),
      });
    }
  }

  /**
   * The burning fuse: an arc that unwinds with the seconds left, plus a ring that
   * blinks over the hull.
   *
   * Clocked off `arming.left` rather than off wall time, so the blink *is* the
   * countdown — it accelerates as the fuse shortens, and two peers watching the same
   * bomb see the same thing at the same moment. Deliberately louder than the stun
   * cage: that one says "this unit is out of the fight", this one says "everything
   * inside that circle is about to be hit".
   */
  private drawFuse(robot: RobotEntity, left: number): void {
    const total = robot.weapon.armingTime || left;
    const r = this.fuseRadius;
    const g = this.fuse;
    const b = blink(left);
    g.clear();

    // What is left of the second, wound anticlockwise from twelve o'clock — the
    // direction a countdown empties in.
    const span = Math.PI * 2 * Math.max(0, Math.min(1, left / total));
    const from = -Math.PI / 2;
    g.moveTo(Math.cos(from) * r, Math.sin(from) * r)
      .arc(0, 0, r, from, from - span, true)
      .stroke({ width: 3, color: palette.blast.zone, alpha: 0.55 + 0.45 * b });

    // A full ring under it, faint, so the arc reads as a *fraction* of something
    // rather than as an arbitrary scratch on one side of the hull.
    g.circle(0, 0, r).stroke({ width: 1, color: palette.blast.zone, alpha: 0.2 + 0.2 * b });
  }

  /**
   * The armed mode's countdown: an arc unwinding over the hull in the heat
   * colour, plus a faint full ring under it so the arc reads as a fraction.
   *
   * Clocked off `override.left` and divided by the mode's own duration — never by
   * wall time — so both peers see the same sweep at the same moment, and a
   * two-second `Overload` does not look like a nearly-spent five-second `Shield`.
   */
  private drawOverrideMark(robot: RobotEntity, left: number): void {
    const kind = robot.override?.kind;
    if (!kind) return;
    const total = overrideDuration(kind) || left;
    const r = this.fuseRadius;
    const g = this.overrideMark;
    const b = blink(left);
    g.clear();

    const span = Math.PI * 2 * Math.max(0, Math.min(1, left / total));
    const from = -Math.PI / 2;
    g.moveTo(Math.cos(from) * r, Math.sin(from) * r)
      .arc(0, 0, r, from, from - span, true)
      .stroke({ width: 3, color: palette.fpv.heat, alpha: 0.55 + 0.45 * b });
    g.circle(0, 0, r).stroke({ width: 1, color: palette.fpv.heat, alpha: 0.2 + 0.2 * b });
  }

  /** The crackling cage over a knocked-out hull; re-rolled every frame. */
  private drawStunned(): void {
    const r = this.stunnedRadius;
    const g = this.stunned;
    g.clear();

    // A broken ring, so it never reads as the (solid) selection or spotted ring.
    // Each arc is opened with a `moveTo` to its own start: `arc` draws a joining
    // line from the current point, which would otherwise chain them into a star.
    for (let i = 0; i < 4; i++) {
      const from = (Math.PI / 2) * i + Math.random() * 0.25;
      g.moveTo(Math.cos(from) * r, Math.sin(from) * r).arc(0, 0, r, from, from + Math.PI / 3);
    }
    g.stroke({ width: 2, color: palette.status.disabled, alpha: 0.75 + Math.random() * 0.25 });

    // Two bolts snapping across the hull.
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const jitter = () => (Math.random() - 0.5) * r * 0.7;
      g.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        .lineTo(jitter(), jitter())
        .lineTo(Math.cos(a + Math.PI) * r, Math.sin(a + Math.PI) * r);
    }
    g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 + Math.random() * 0.4 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * A weapon-module sprite centred on the robot's hardpoint (over the chassis).
 * Untinted by design — see the call site.
 */
function weaponModule(sprite: ResolvedSprite): Sprite {
  const { texture, def } = sprite;
  const target = def.targetSize ?? WEAPON_TARGET;
  const dim = Math.max(texture.width, texture.height) || target;
  const img = new Sprite(texture);
  img.anchor.set(0.5);
  img.scale.set(target / dim);
  img.rotation = def.rotationOffset ?? 0;
  return img;
}

/** Dark outline shared by the placeholder hull and the weapon marker drawn on it. */
const OUTLINE = { width: 2, color: 0x0b0e13 } as const;

/** Placeholder chassis body; `drawWeapon` draws the weapon marker (skipped when a module sprite covers it). */
function drawBody(robot: RobotEntity, r: number, drawWeapon: boolean): Graphics {
  const g = new Graphics();
  const color = ownerColor(robot.owner);
  const stroke = OUTLINE;

  switch (robot.chassis) {
    case ChassisType.Wheels:
      g.roundRect(-r, -r, r * 2, r * 2, r * 0.55)
        .fill(color)
        .stroke(stroke);
      break;
    case ChassisType.Legs: {
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.poly(pts).fill(color).stroke(stroke);
      break;
    }
    case ChassisType.Tracks:
    default:
      g.rect(-r, -r, r * 2, r * 2)
        .fill(color)
        .stroke(stroke);
      break;
  }

  if (drawWeapon) drawWeaponMarker(g, robot.weaponType, r);

  g.poly([r + 3, 0, r - 1, -3, r - 1, 3]).fill({ color: 0xffffff, alpha: 0.85 });
  return g;
}

/**
 * The weapon marker on a placeholder hull — the fallback for when a module's art
 * is missing or failed to load.
 *
 * It follows the same two rules the real modules are authored under (see
 * `palette.weapon` and `.docs/sprites/weapons.md`), because the point of a
 * fallback is that the player reads it the same way: **one dominant shape in the
 * weapon's own colour**, no more than three forms, nothing thinner than the dark
 * outline around it. The older version of this drew every marker in the same near
 * black at one or two px, which at this size averaged into an indistinct smudge —
 * precisely the failure the colour code exists to fix.
 */
function drawWeaponMarker(g: Graphics, weapon: WeaponType | undefined, r: number): void {
  switch (weapon) {
    case WeaponType.Cannon:
      // A single brass barrel down the heading — the only marker with a "front".
      g.roundRect(-r * 0.15, -r * 0.2, r * 1.15, r * 0.4, r * 0.12).fill(palette.weapon.cannon).stroke(OUTLINE);
      break;
    case WeaponType.Missiles:
      // Two fat launch tubes, side by side and pointing where the hull points.
      g.roundRect(-r * 0.2, -r * 0.62, r * 0.95, r * 0.42, r * 0.1)
        .roundRect(-r * 0.2, r * 0.2, r * 0.95, r * 0.42, r * 0.1)
        .fill(palette.weapon.missiles)
        .stroke(OUTLINE);
      break;
    case WeaponType.Bomb:
      // The one striped marker in the set: hazard chevrons over the payload.
      g.circle(0, 0, r * 0.55).fill(palette.weapon.bomb).stroke(OUTLINE);
      g.rect(-r * 0.55, -r * 0.14, r * 1.1, r * 0.28)
        .rect(-r * 0.14, -r * 0.55, r * 0.28, r * 1.1)
        .fill(palette.weapon.bombStripe);
      break;
    case WeaponType.Radar:
      // One big pale dish filling most of the hardpoint — a listener, not a gun.
      g.circle(0, 0, r * 0.58).fill(palette.weapon.radar).stroke(OUTLINE);
      break;
    case WeaponType.Ew:
      // A plum antenna cross that broadcasts static. Thick, so it survives at size.
      g.moveTo(-r * 0.6, -r * 0.6)
        .lineTo(r * 0.6, r * 0.6)
        .moveTo(-r * 0.6, r * 0.6)
        .lineTo(r * 0.6, -r * 0.6)
        .stroke({ width: r * 0.28, color: palette.weapon.ew });
      break;
    case WeaponType.Dew:
      // An ice-bright emitter ring with a bolt across it — deliberately unlike the
      // EW cross, since one jams sight and the other knocks a hull out.
      g.circle(0, 0, r * 0.5).stroke({ width: r * 0.24, color: palette.weapon.dew });
      g.moveTo(-r * 0.35, -r * 0.55)
        .lineTo(r * 0.1, 0)
        .lineTo(-r * 0.1, 0)
        .lineTo(r * 0.35, r * 0.55)
        .stroke({ width: r * 0.16, color: palette.weapon.dew });
      break;
    case WeaponType.Fpv:
      // An olive canister perforated by five launch cells — the salvo size is the
      // read, matching what the module art shows.
      g.roundRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1, r * 0.22)
        .fill(palette.weapon.fpv)
        .stroke(OUTLINE);
      g.circle(0, 0, r * 0.16)
        .circle(-r * 0.3, -r * 0.3, r * 0.16)
        .circle(r * 0.3, -r * 0.3, r * 0.16)
        .circle(-r * 0.3, r * 0.3, r * 0.16)
        .circle(r * 0.3, r * 0.3, r * 0.16)
        .fill(0x0b0e13);
      break;
    default:
      break;
  }
}
