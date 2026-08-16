import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { RobotEntity } from '../../engine/ecs/archetypes';
import { useGameStore } from '../../store/gameStore';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import { LEGS_GAIT_STRIDE_PX, WEAPON_TARGET } from '../../config/sprites';
import { getRobotGaitTextures, getRobotTexture, getWeaponTexture, type ResolvedSprite } from '../assets';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { gaitPhase } from './gait';
import { HealthBar } from './HealthBar';
import { ownerColor, teamTint } from './ownerColor';

/** Body roll at the peak of a stride, in radians (~2.6°). */
const GAIT_SWAY_RAD = 0.045;
/** Sideways waddle at the peak of a stride, in px, perpendicular to the heading. */
const GAIT_BOB_PX = 0.9;
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
 * A chassis with a **walk-cycle sheet** (only `legs` — see `robotGaitSprites`) also
 * animates: `update` swaps the sprite's texture between the sheet's cells and rolls
 * the body, both clocked off distance travelled rather than off the wall clock.
 */
export class RobotView {
  readonly container: Container;
  private readonly body: Container;
  private readonly ring: Graphics;
  private readonly spotted: Graphics;
  private readonly stunned: Graphics;
  private readonly stunnedRadius: number;
  private readonly healthBar: HealthBar;
  private readonly isEnemy: boolean;
  private lastClickAt = 0;

  /** The chassis sprite, kept so the gait can retexture it; null on a Graphics placeholder. */
  private readonly img: Sprite | null;
  /** The walk-cycle cells in cycle order, or null for a chassis that doesn't walk. */
  private readonly gait: ResolvedSprite[] | null;
  private frame = 0;
  /** Ground covered (px) since the cycle last reset; the gait's only clock. */
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
      const blast = new Graphics();
      blast
        .circle(0, 0, robot.weapon.explosionRadius)
        .fill({ color: palette.blast.zone, alpha: 0.05 })
        .stroke({ width: 1, color: palette.blast.zone, alpha: 0.4 });
      this.container.addChild(blast);
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

    this.healthBar = new HealthBar(2 * outerRadius + 6, 4);
    this.healthBar.container.position.set(0, -(outerRadius + 10));

    this.container.addChild(this.ring, this.spotted, this.body, this.stunned, this.healthBar.container);

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
          store.selectRobots(
            store.robots.filter((r) => r.owner === local && r.weapon === robot.weaponType).map((r) => r.id),
          );
          return;
        }
        this.lastClickAt = now;

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

    // After `body.rotation`, which the sway adds to rather than replaces.
    if (this.gait) this.walk(robot, visible && !off, now);
  }

  /**
   * Advances the walk cycle: which cell of the sheet is showing, and how far the
   * body is rolled and waddled off its heading.
   *
   * The cycle is clocked by **ground covered**, so it needs no separate rules for
   * stopping, for a chassis speed, or for a walker inching along because something
   * is in its way — all three fall out of "no travel, no step".
   *
   * The sway goes on `body` rather than on the chassis sprite because the weapon
   * module is bolted to the hardpoint *inside* `body`: rolling the hull out from
   * under its own gun would visibly unstick the two. The selection ring, the spotted
   * marker and the HP bar sit outside `body` and stay level, which is right — they
   * are interface, not hull.
   */
  private walk(robot: RobotEntity, stepping: boolean, now: number): void {
    const frames = this.gait;
    const img = this.img;
    if (!frames || !img) return;

    // Measured even on frames where the walker is fogged or knocked out, and only
    // *spent* when it is stepping. Otherwise a march made out of sight is repaid in
    // one lump the moment it is seen again, and the gait jumps to a random phase.
    const dx = robot.position.x - this.lastX;
    const dy = robot.position.y - this.lastY;
    this.lastX = robot.position.x;
    this.lastY = robot.position.y;

    const dt = Math.min((now - this.lastNow) / 1000, GAIT_MAX_DT);
    this.lastNow = now;

    const step = stepping ? Math.hypot(dx, dy) : 0;
    this.travelled += step;

    // Eased, not switched: a walker that stops mid-stride would otherwise freeze at
    // whatever angle the sway had reached and stand there leaning.
    this.amp += ((step > 0 ? 1 : 0) - this.amp) * Math.min(1, dt / GAIT_EASE_S);
    if (this.amp < GAIT_REST) {
      this.amp = 0;
      this.travelled = 0; // rest on cell 0, the stance the sheet is drawn around
    }

    const { frame, sway } = gaitPhase(this.travelled, LEGS_GAIT_STRIDE_PX, frames.length);
    if (frame !== this.frame) {
      this.frame = frame;
      img.texture = frames[frame].texture;
    }

    const roll = sway * this.amp;
    this.body.rotation += roll * GAIT_SWAY_RAD;
    // `body.position` lives in the container's (unrotated) space, so the sideways
    // direction has to be derived from the heading rather than borrowed from the
    // rotation just applied.
    const bob = roll * GAIT_BOB_PX;
    this.body.position.set(-Math.sin(robot.heading) * bob, Math.cos(robot.heading) * bob);
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
