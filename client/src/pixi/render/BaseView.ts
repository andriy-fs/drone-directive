import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import { BASE_CYCLE_MS, BASE_PAD_OFFSET, BASE_WEAPON_TARGET } from '../../config/sprites';
import type { BaseEntity } from '../../engine/ecs/archetypes';
import { useGameStore } from '../../store/gameStore';
import { getBaseGaitTextures, getBaseTexture, getBaseWeaponTexture, type ResolvedSprite } from '../assets';
import { runAfterTouch } from '../input/afterTouch';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { HealthBar } from './HealthBar';
import { cellAt } from './cycle';
import { idleScan, recoilPx, reloadFill, reloadTint, SCAN_PERIOD_S } from './launcher';
import { ownerColor, teamTint } from './ownerColor';
import { hashUnit } from './terrain/hash';

/**
 * View for a base entity: its faction sprite (or an owner-tinted square + cross
 * placeholder if no art is loaded), the built-in missile battery's launcher, an
 * HP bar above it and a selection outline, positioned at the base's world-space
 * centre. Double-clicking your own base opens the build & program dialog (same
 * one as the HUD button) — with a finger, a second tap on a base you already have
 * selected does it; selecting it in the first place is handled by the stage
 * handler in `input/pointer.ts`, not here.
 *
 * The sprite is a **four-cell idle cycle** where the art exists (`baseGaitSprites`)
 * — running lights, a turning radar dish, chevrons marching out of the production
 * bay, breathing vents — clocked off the frame's wall clock rather than off travel,
 * since a base never moves. Art falls back in two steps: sheet → still sprite →
 * Graphics placeholder.
 */
export class BaseView {
  readonly container: Container;
  private readonly healthBar: HealthBar;
  private readonly ring: Graphics;
  /** The launcher's mount: parked on the pad, rotated to where the battery is aiming. */
  private readonly launcher: Container;
  /** What is drawn on that mount — the art if it exists, the fallback turntable if not. */
  private readonly launcherArt: Container;
  /** The idle-cycle cells in cycle order, or null when this base has no sheet. */
  private readonly frames: ResolvedSprite[] | null;
  /** The sprite the cycle swaps textures on; null when the art fell back to Graphics. */
  private readonly img: Sprite | null = null;
  /**
   * Where in the cycle this base starts, in `[0, 1)`. Hashed from its own position so
   * two bases on screen do not blink in lockstep — which would read as one global
   * pulse rather than as each building running its own machinery.
   */
  private readonly phase: number;
  private frame = 0;
  private lastClickAt = 0;
  /**
   * The battery's countdown as of the last frame. A countdown that went *up* is the
   * only evidence a shot was fired that the renderer needs — cheaper than a bus
   * subscription, and it cannot drift out of step with the simulation.
   */
  private lastCooldownLeft = 0;
  /** When the battery last fired (ms, frame clock), for the recoil. */
  private lastShotAt = Number.NEGATIVE_INFINITY;
  /** Bearing as of the last frame; a change in it means the battery is tracking something. */
  private lastHeading = 0;
  /** Until when (ms) the launcher is treated as engaged, so it holds its bearing. */
  private engagedUntil = 0;
  /** How much of the idle scan is dialled in, `[0, 1]` — eased, so re-aiming doesn't snap. */
  private scanWeight = 0;
  private lastNow = 0;

  constructor(base: BaseEntity) {
    this.container = new Container();
    this.container.label = `base:${base.id}`;

    const size = base.footprint * gameConfig.grid.tilePx;
    const half = size / 2;

    // Selection outline, under the body — same colour as a robot's ring.
    this.ring = new Graphics();
    this.ring
      .rect(-half - 3, -half - 3, size + 6, size + 6)
      .stroke({ width: 2, color: palette.selection.ring });
    this.ring.visible = false;
    this.container.addChild(this.ring);

    this.frames = base.owner ? getBaseGaitTextures(base.owner) : null;
    // Cell 0 is the rest pose, so it is also the right thing to show on the first
    // frame — and it is what the still sprite is cut from.
    const sprite = this.frames?.[0] ?? (base.owner ? getBaseTexture(base.owner) : null);
    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? size;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      const tint = teamTint(base.owner);
      if (tint !== undefined) img.tint = tint;
      this.container.addChild(img);
      this.img = img;
    } else {
      this.container.addChild(drawBody(base, size, half));
    }

    // Same pure hash the terrain decals are placed by, read off the footprint's
    // tile so it is stable for the life of the match.
    const tile = gameConfig.grid.tilePx;
    this.phase = base.position
      ? hashUnit(Math.round(base.position.x / tile), Math.round(base.position.y / tile), 0x1d)
      : 0;

    // The launcher, above the body: the only thing on screen that says *where*
    // the base's fire is coming from. A shot with no visible source reads as a
    // bug, so the barrels track the current target every tick.
    //
    // It is parked on the pad rather than at the origin, because the pad in the art
    // is not the centre of the frame — see `BASE_PAD_OFFSET`. The mount carries the
    // bearing, the art inside it carries the recoil, so the two never fight over the
    // same transform.
    this.launcher = new Container();
    const pad = base.owner ? BASE_PAD_OFFSET[base.owner] : undefined;
    if (pad) this.launcher.position.set(pad.x, pad.y);
    this.launcherArt = launcherArtFor(base);
    this.launcher.addChild(this.launcherArt);
    this.container.addChild(this.launcher);

    this.healthBar = new HealthBar(size);
    this.healthBar.container.position.set(0, -half - 12);

    this.container.addChild(this.healthBar.container);
    if (base.position) this.container.position.set(base.position.x, base.position.y);

    // Only the local side's base is interactive. The enemy base stays
    // pointer-transparent so a right-click on it still reaches the stage handler
    // (→ attack order); otherwise the view would swallow the event.
    if (base.owner === useGameStore.getState().localSide) {
      this.container.eventMode = 'static';
      this.container.cursor = 'pointer';
      // Pin hit-testing to the footprint so the HP bar above it doesn't extend
      // the clickable area over open ground.
      this.container.hitArea = new Rectangle(-half, -half, size, size);
      this.container.on('pointerdown', (e) => {
        if (e.button !== 0) return; // right-click falls through to the stage (move order)

        // A finger gets no double-tap. It gets the idiom the robot and the drone
        // already use — tap what you are already holding — which is free here
        // because a base selection is dropped by tapping open ground, not by
        // tapping the base again (see `input/pointer.ts`, `handleTap`). The
        // browser's own double-tap gesture then has nothing to race, and the
        // 350 ms window stops being something a player has to hit.
        //
        // The open waits for the lift, or Headless UI would read this very tap's
        // `touchend` as a tap outside the dialog and close it — see
        // `runAfterTouch`, which also drops it if the press turns into a drag.
        if (e.pointerType === 'touch') {
          if (useGameStore.getState().selectedBaseId !== base.id) return; // first tap: the stage selects
          runAfterTouch(e, () => useGameStore.getState().setBuildDialogOpen(true));
          // Deliberately bubbles all the same: the stage still owns the marquee a
          // drag from here opens, and re-selecting an already-selected base is a
          // no-op.
          return;
        }

        const now = performance.now();
        if (now - this.lastClickAt < DOUBLE_CLICK_MS) {
          this.lastClickAt = 0; // consume so a third click starts a fresh pair
          e.stopPropagation(); // don't start a marquee underneath the dialog
          useGameStore.getState().setBuildDialogOpen(true);
          return;
        }
        this.lastClickAt = now;
        // A single click deliberately bubbles: box-select and deselect keep
        // working when a drag starts on top of the base.
      });
    }

    this.update(base, true, false, performance.now());
  }

  update(base: BaseEntity, visible: boolean, selected: boolean, now: number): void {
    this.container.visible = visible;
    this.ring.visible = selected;
    this.healthBar.set(base.hp / base.maxHp);
    this.aimLauncher(base, now);

    // Swap only on a cell change: assigning the same texture every frame would ask
    // Pixi to rebind it 60 times a second for nothing (the guard `RobotView` uses).
    if (!this.frames || !this.img) return;
    const frame = cellAt(now, BASE_CYCLE_MS, this.phase, this.frames.length);
    if (frame !== this.frame) {
      this.frame = frame;
      this.img.texture = this.frames[frame].texture;
    }
  }

  /**
   * Point the launcher, rock it back if it just fired, and dim it while it reloads —
   * the three cues that separate a working battery from a decal on the roof. All of
   * it is read off simulation state that is already identical on both peers
   * (`heading`, `weapon.cooldownLeft`); nothing here is written back.
   */
  private aimLauncher(base: BaseEntity, now: number): void {
    const dt = this.lastNow ? Math.min((now - this.lastNow) / 1000, SCAN_MAX_DT) : 0;
    this.lastNow = now;

    const { cooldownLeft, cooldown } = base.weapon;
    // The countdown only ever runs down, so a rise in it is a shot leaving the tube.
    if (cooldownLeft > this.lastCooldownLeft) this.lastShotAt = now;
    this.lastCooldownLeft = cooldownLeft;

    // Two independent signs of a live engagement, because either alone has a hole in
    // it: a battery holding fire on a stationary target keeps swinging (heading), and
    // one whose target stopped moving is still reloading (countdown).
    if (cooldownLeft > 0 || base.heading !== this.lastHeading) this.engagedUntil = now + ENGAGED_HOLD_MS;
    this.lastHeading = base.heading;

    const scanning = now > this.engagedUntil;
    const target = scanning ? 1 : 0;
    const step = dt / SCAN_EASE_S;
    this.scanWeight =
      target > this.scanWeight ? Math.min(target, this.scanWeight + step) : Math.max(target, this.scanWeight - step);

    // The phase offset is the same hash the idle cycle uses, so two bases neither
    // blink nor sweep in lockstep.
    const scan = this.scanWeight > 0 ? idleScan(now / 1000 + this.phase * SCAN_PERIOD_S) * this.scanWeight : 0;
    this.launcher.rotation = base.heading + scan;
    this.launcherArt.x = -recoilPx((now - this.lastShotAt) / 1000);
    this.launcherArt.tint = reloadTint(reloadFill(cooldownLeft, cooldown));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * Seconds the launcher holds its last bearing after the shooting stops, before it
 * starts searching again. Comfortably longer than the battery's own 1.6 s reload, so
 * a base trading shots with something never breaks off mid-fight.
 */
const ENGAGED_HOLD_MS = 3000;
/** Seconds to dial the idle scan in or out — long enough that re-aiming reads as intent. */
const SCAN_EASE_S = 0.4;
/** Frame-time ceiling (s) for that easing, so a stalled tab doesn't jump it (as `RobotView` does). */
const SCAN_MAX_DT = 0.1;

/**
 * The launcher on the pad: the faction's art where it exists, the turntable this
 * view has always drawn where it does not. Same two-step fallback as the building
 * under it — a base whose art has not loaded still shows where its fire comes from.
 */
function launcherArtFor(base: BaseEntity): Container {
  const art = base.owner ? getBaseWeaponTexture(base.owner) : null;
  if (!art) return fallbackTurret();

  const { texture, def } = art;
  const target = def.targetSize ?? BASE_WEAPON_TARGET;
  const dim = Math.max(texture.width, texture.height) || target;
  const img = new Sprite(texture);
  img.anchor.set(0.5);
  img.scale.set(target / dim);
  // Authored barrels-up, like every barrelled module; the mount supplies the bearing.
  img.rotation = def.rotationOffset ?? 0;
  return img;
}

/**
 * The missile battery's launcher as geometry: a turntable with a twin barrel pointing
 * along +x, so the mount's `rotation = heading` (the `atan2` the resolver stores) aims
 * it. Small on purpose — it marks the base's one weapon without competing with the
 * art, and it is drawn at the same ~17 px sweep the art occupies.
 */
function fallbackTurret(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 7).fill({ color: palette.turret.body }).stroke({ width: 1.5, color: palette.turret.edge });
  g.rect(2, -4, 14, 2.5).rect(2, 1.5, 14, 2.5).fill({ color: palette.turret.edge });
  return g;
}

/** Owner-tinted square + cross placeholder, used when no base sprite is loaded. */
function drawBody(base: BaseEntity, size: number, half: number): Graphics {
  const inset = 4;
  const color = ownerColor(base.owner);
  const body = new Graphics();
  body
    .rect(-half + inset, -half + inset, size - inset * 2, size - inset * 2)
    .fill({ color, alpha: 0.85 })
    .stroke({ width: 2, color: palette.owner.neutral });
  body
    .moveTo(-half + inset, -half + inset)
    .lineTo(half - inset, half - inset)
    .moveTo(half - inset, -half + inset)
    .lineTo(-half + inset, half - inset)
    .stroke({ width: 1, color: 0x000000, alpha: 0.25 });
  return body;
}
