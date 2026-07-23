import { Circle, Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { useGameStore } from '../../store/gameStore';
import { ChassisType, Owner, WeaponType } from '../../types/enums';
import { getRobotTexture, getWeaponTexture, type ResolvedSprite } from '../assets';
import { HealthBar } from './HealthBar';

/**
 * View for a robot entity. If its chassis has a registered sprite it is drawn as
 * a (cropped) Sprite with an owner-coloured disc beneath; otherwise a coloured
 * Graphics placeholder (shape by chassis, marker by weapon). `body` rotates with
 * heading; the HP bar and selection ring stay upright.
 */
export class RobotView {
  readonly container: Container;
  private readonly body: Container;
  private readonly ring: Graphics;
  private readonly spotted: Graphics;
  private readonly healthBar: HealthBar;
  private readonly isEnemy: boolean;

  constructor(robot: Entity) {
    const r = gameConfig.robots.radius;
    this.isEnemy = robot.owner !== Owner.Player;
    this.container = new Container();
    this.container.label = `robot:${robot.id}`;
    // Only the player's own robots are interactive (for click-select). Enemy
    // robots stay pointer-transparent so a right-click on them reaches the stage
    // handler (→ attack order); otherwise the view would swallow the event.
    if (!this.isEnemy) {
      this.container.eventMode = 'static';
      this.container.cursor = 'pointer';
    }

    // Vision-zone ring: the robot's own detection radius, shown for the
    // player's own units only (an enemy's sight range stays hidden intel).
    if (!this.isEnemy && (robot.sightRange ?? 0) > 0) {
      const zone = new Graphics();
      zone
        .circle(0, 0, robot.sightRange!)
        .fill({ color: palette.vision.zone, alpha: 0.03 })
        .stroke({ width: 1, color: palette.vision.zone, alpha: 0.35 });
      this.container.addChild(zone);
    }

    this.body = new Container();
    const sprite = robot.chassis && robot.owner ? getRobotTexture(robot.chassis, robot.owner) : null;
    // Weapon-module overlay for the central hardpoint (radar/bomb have art);
    // when present it replaces the drawn weapon marker to avoid doubling up.
    const weaponSprite =
      robot.weaponType && robot.owner ? getWeaponTexture(robot.weaponType, robot.owner) : null;
    let ownerDisc: Graphics | null = null;
    let outerRadius = r;

    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? gameConfig.grid.tilePx * 1.4;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      img.rotation = def.rotationOffset ?? 0;
      this.body.addChild(img);

      outerRadius = target / 2;
      const discColor = robot.owner === Owner.Player ? palette.owner.player : palette.owner.ai;
      ownerDisc = new Graphics();
      ownerDisc.circle(0, 0, outerRadius).fill({ color: discColor, alpha: 0.28 });
    } else {
      this.body.addChild(drawBody(robot, r, !weaponSprite));
    }

    if (weaponSprite) this.body.addChild(weaponModule(weaponSprite));

    this.ring = new Graphics();
    this.ring.circle(0, 0, outerRadius + 5).stroke({ width: 2, color: 0xfde047 });
    this.ring.visible = false;

    // Detection highlight: rings when this (enemy) robot is currently spotted.
    this.spotted = new Graphics();
    this.spotted.circle(0, 0, outerRadius + 9).stroke({ width: 2, color: palette.vision.spotted });
    this.spotted.visible = false;

    this.healthBar = new HealthBar(2 * outerRadius + 6, 4);
    this.healthBar.container.position.set(0, -(outerRadius + 10));

    if (ownerDisc) this.container.addChild(ownerDisc);
    this.container.addChild(this.ring, this.spotted, this.body, this.healthBar.container);

    if (!this.isEnemy) {
      // Pin the clickable area to the robot's own body — without this, the (much
      // larger) vision-zone circle above would expand hit-testing to its radius
      // and swallow drag-select clicks anywhere near an allied robot.
      this.container.hitArea = new Circle(0, 0, outerRadius + 5);
      this.container.on('pointerdown', (e) => {
        if (e.button !== 0) return; // left-click selects; right-click falls to the stage
        e.stopPropagation(); // don't let the stage start a pan / marquee / deselect
        const store = useGameStore.getState();
        if (e.shiftKey) store.toggleRobot(robot.id);
        else store.selectRobots([robot.id]);
      });
    }

    this.update(robot, false, true);
  }

  update(robot: Entity, selected: boolean, visible: boolean): void {
    this.container.visible = visible;
    if (robot.position) this.container.position.set(robot.position.x, robot.position.y);
    this.body.rotation = robot.heading ?? 0;
    this.healthBar.set((robot.hp ?? 0) / (robot.maxHp ?? 1));
    this.ring.visible = selected;
    this.spotted.visible = this.isEnemy && visible;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** A weapon-module sprite centred on the robot's hardpoint (over the chassis). */
function weaponModule(sprite: ResolvedSprite): Sprite {
  const { texture, def } = sprite;
  const target = def.targetSize ?? gameConfig.grid.tilePx * 0.7;
  const dim = Math.max(texture.width, texture.height) || target;
  const img = new Sprite(texture);
  img.anchor.set(0.5);
  img.scale.set(target / dim);
  img.rotation = def.rotationOffset ?? 0;
  return img;
}

/** Placeholder chassis body; `drawWeapon` draws the weapon marker (skipped when a module sprite covers it). */
function drawBody(robot: Entity, r: number, drawWeapon: boolean): Graphics {
  const g = new Graphics();
  const color = robot.owner === Owner.Player ? palette.owner.player : palette.owner.ai;
  const stroke = { width: 2, color: 0x0b0e13 } as const;

  switch (robot.chassis) {
    case ChassisType.Wheels:
      g.roundRect(-r, -r, r * 2, r * 2, r * 0.55).fill(color).stroke(stroke);
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
      g.rect(-r, -r, r * 2, r * 2).fill(color).stroke(stroke);
      break;
  }

  if (drawWeapon) {
    switch (robot.weaponType) {
      case WeaponType.Cannon:
        g.rect(r * 0.3, -2, r * 0.9, 4).fill(0x0b0e13);
        break;
      case WeaponType.Missiles:
        g.circle(r * 0.5, -4, 2).circle(r * 0.5, 4, 2).fill(0x0b0e13);
        break;
      case WeaponType.Bomb:
        // Warning-red core marking the kamikaze payload.
        g.circle(0, 0, r * 0.42).fill(0xef4444).stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      case WeaponType.Radar:
        // Concentric "dish" arcs signalling the spotter.
        g.circle(0, 0, r * 0.3).circle(0, 0, r * 0.6).stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      case WeaponType.Ew:
        // Crossed jammer mast: an X over the hull signalling the EW aura.
        g.moveTo(-r * 0.45, -r * 0.45)
          .lineTo(r * 0.45, r * 0.45)
          .moveTo(-r * 0.45, r * 0.45)
          .lineTo(r * 0.45, -r * 0.45)
          .stroke({ width: 1.5, color: 0x0b0e13 });
        break;
      default:
        break;
    }
  }

  g.poly([r + 3, 0, r - 1, -3, r - 1, 3]).fill({ color: 0xffffff, alpha: 0.85 });
  return g;
}
