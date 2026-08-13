import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { RobotEntity } from '../../engine/ecs/archetypes';
import { useGameStore } from '../../store/gameStore';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import { getRobotTexture, getWeaponTexture, type ResolvedSprite } from '../assets';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { HealthBar } from './HealthBar';
import { ownerColor, teamTint } from './ownerColor';

/**
 * View for a robot entity. If its chassis has a registered sprite it is drawn as
 * a (cropped) Sprite; otherwise a coloured Graphics placeholder (shape by
 * chassis, marker by weapon). `body` rotates with heading; the HP bar and
 * selection ring stay upright.
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
    const sprite = robot.chassis && robot.owner ? getRobotTexture(robot.chassis, robot.owner) : null;
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

      outerRadius = target / 2;
    } else {
      this.body.addChild(drawBody(robot, r, !weaponSprite));
    }

    if (weaponSprite) this.body.addChild(weaponModule(weaponSprite, tint));

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

    this.update(robot, false, true);
  }

  update(robot: RobotEntity, selected: boolean, visible: boolean): void {
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

/** A weapon-module sprite centred on the robot's hardpoint (over the chassis). */
function weaponModule(sprite: ResolvedSprite, tint?: number): Sprite {
  const { texture, def } = sprite;
  const target = def.targetSize ?? gameConfig.grid.tilePx * 0.7;
  const dim = Math.max(texture.width, texture.height) || target;
  const img = new Sprite(texture);
  img.anchor.set(0.5);
  img.scale.set(target / dim);
  img.rotation = def.rotationOffset ?? 0;
  if (tint !== undefined) img.tint = tint;
  return img;
}

/** Placeholder chassis body; `drawWeapon` draws the weapon marker (skipped when a module sprite covers it). */
function drawBody(robot: RobotEntity, r: number, drawWeapon: boolean): Graphics {
  const g = new Graphics();
  const color = ownerColor(robot.owner);
  const stroke = { width: 2, color: 0x0b0e13 } as const;

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

  if (drawWeapon) {
    switch (robot.weaponType) {
      case WeaponType.Cannon:
        g.rect(r * 0.3, -2, r * 0.9, 4).fill(0x0b0e13);
        break;
      case WeaponType.Missiles:
        g.circle(r * 0.5, -4, 2)
          .circle(r * 0.5, 4, 2)
          .fill(0x0b0e13);
        break;
      case WeaponType.Bomb:
        // Warning-red core marking the kamikaze payload.
        g.circle(0, 0, r * 0.42)
          .fill(0xef4444)
          .stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      case WeaponType.Radar:
        // Concentric "dish" arcs signalling the spotter.
        g.circle(0, 0, r * 0.3)
          .circle(0, 0, r * 0.6)
          .stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      case WeaponType.Ew:
        // Crossed jammer mast: an X over the hull signalling the EW aura.
        g.moveTo(-r * 0.45, -r * 0.45)
          .lineTo(r * 0.45, r * 0.45)
          .moveTo(-r * 0.45, r * 0.45)
          .lineTo(r * 0.45, -r * 0.45)
          .stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      case WeaponType.Dew:
        // Emitter coil + a discharge bolt across it — deliberately unlike the
        // EW mast's X, since one jams sight and the other knocks a hull out.
        g.circle(0, 0, r * 0.5)
          .stroke({ width: 1.5, color: 0x0b0e13 })
          .moveTo(-r * 0.3, -r * 0.5)
          .lineTo(r * 0.08, -r * 0.05)
          .lineTo(-r * 0.14, r * 0.05)
          .lineTo(r * 0.28, r * 0.5)
          .stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      default:
        break;
    }
  }

  g.poly([r + 3, 0, r - 1, -3, r - 1, 3]).fill({ color: 0xffffff, alpha: 0.85 });
  return g;
}
