import {
  Graphics,
  type Application,
  type FederatedPointerEvent,
} from 'pixi.js';
import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Entity } from '../../engine/ecs/entity';
import type { GameEngine } from '../../engine/game/engine';
import { setGoal } from '../../engine/systems/movement';
import { findById, isEnemy } from '../../engine/systems/targeting';
import { makeAttackTarget, makeIdle } from '../../engine/tasks/taskDefinitions';
import type { GameContext } from '../../engine/game/context';
import type { Vec2 } from '../../types/entities';
import { useGameStore } from '../../store/gameStore';
import { Owner } from '../../types/enums';
import { clamp, distance } from '../../utils/math';
import type { Camera } from '../Camera';

/** Below this drag distance (px) a press is treated as a click, not a drag. */
const CLICK_SLOP = 4;

/** Physical keys (arrows + WASD) that fly the observer drone, mapped to a unit direction. */
const FLY_KEYS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
};

/** True when a keyboard event should drive the observer drone. Modifier combos such as Ctrl+A are reserved for UI shortcuts. */
export function shouldHandleDroneFlightKey(e: KeyboardEvent): boolean {
  if (!(e.code in FLY_KEYS)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return true;
}

/** Land on / take off from an idle robot. */
const POSSESS_KEY = 'KeyF';
/** Fire / detonate the possessed robot. */
const FIRE_KEY = 'KeyE';

/**
 * Playfield input:
 * - Left drag = selection marquee (Shift adds); left click on empty = clear.
 *   (Clicking a robot is handled in RobotView.)
 * - Arrow keys/WASD = fly the observer drone (the camera follows it).
 * - `F` = land on / take off from an idle robot; `E` = fire / detonate it.
 * - Right click on an enemy (robot or base) = order the selection to attack it;
 *   right click on open ground = move the selection there in a compact formation.
 */
export function attachPointerControls(
  app: Application,
  camera: Camera,
  engine: GameEngine,
): () => void {
  const stage = app.stage;
  stage.eventMode = 'static';
  stage.hitArea = app.screen;

  const marqueeGfx = new Graphics();
  marqueeGfx.visible = false;
  stage.addChild(marqueeGfx);

  let selecting = false;
  let additive = false;
  let moved = false;
  let startX = 0;
  let startY = 0;

  const onDown = (e: FederatedPointerEvent) => {
    if (e.button === 2) {
      issueRightClick(camera, engine, e.global.x, e.global.y);
      return;
    }
    if (e.button !== 0) return;
    selecting = true;
    moved = false;
    additive = e.shiftKey;
    startX = e.global.x;
    startY = e.global.y;
  };

  const onMove = (e: FederatedPointerEvent) => {
    if (!selecting) return;
    if (
      Math.abs(e.global.x - startX) + Math.abs(e.global.y - startY) >
      CLICK_SLOP
    )
      moved = true;
    if (moved) drawMarquee(marqueeGfx, startX, startY, e.global.x, e.global.y);
  };

  const onUp = (e: FederatedPointerEvent) => {
    if (selecting) {
      if (moved) {
        selectInBox(
          camera,
          engine,
          startX,
          startY,
          e.global.x,
          e.global.y,
          additive,
        );
        marqueeGfx.visible = false;
        marqueeGfx.clear();
      } else if (!additive && e.button === 0) {
        useGameStore.getState().clearSelection();
      }
    }
    selecting = false;
  };

  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  // Drone flight: held arrow keys/WASD set the drone's direction on the store;
  // the bridge samples it on the fixed step so movement stays deterministic.
  // `F`/`E` are one-shot intents (land-or-take-off / fire). No camera panning:
  // the camera follows the drone (see GameApp.followDrone).
  const pressedKeys = new Set<string>();
  const applyDroneDir = () => {
    let dx = 0;
    let dy = 0;
    for (const code of pressedKeys) {
      dx += FLY_KEYS[code].x;
      dy += FLY_KEYS[code].y;
    }
    const len = Math.hypot(dx, dy);
    useGameStore
      .getState()
      .setDroneInput(len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (useGameStore.getState().status !== 'playing') return;
    if (shouldHandleDroneFlightKey(e)) {
      if (e.code.startsWith('Arrow')) e.preventDefault(); // stop the page from scrolling
      if (!pressedKeys.has(e.code)) {
        pressedKeys.add(e.code);
        applyDroneDir();
      }
      return;
    }
    if (e.repeat) return; // one-shot intents ignore auto-repeat
    if (e.code === POSSESS_KEY) useGameStore.getState().requestDronePossess();
    else if (e.code === FIRE_KEY) useGameStore.getState().requestDroneFire();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (pressedKeys.delete(e.code)) applyDroneDir();
  };
  const onBlur = () => {
    pressedKeys.clear(); // don't leave the drone drifting after alt-tab
    useGameStore.getState().setDroneInput({ x: 0, y: 0 });
  };

  stage.on('pointerdown', onDown);
  stage.on('globalpointermove', onMove);
  stage.on('pointerup', onUp);
  stage.on('pointerupoutside', onUp);
  app.canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    stage.off('pointerdown', onDown);
    stage.off('globalpointermove', onMove);
    stage.off('pointerup', onUp);
    stage.off('pointerupoutside', onUp);
    app.canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    marqueeGfx.destroy();
  };
}

function drawMarquee(
  g: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  g.clear();
  g.rect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0))
    .fill({ color: 0x3b82f6, alpha: 0.15 })
    .stroke({ width: 1, color: 0x3b82f6, alpha: 0.9 });
  g.visible = true;
}

function selectInBox(
  camera: Camera,
  engine: GameEngine,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  additive: boolean,
): void {
  const a = camera.screenToWorld(Math.min(sx0, sx1), Math.min(sy0, sy1));
  const b = camera.screenToWorld(Math.max(sx0, sx1), Math.max(sy0, sy1));

  const inBox = engine.world
    .with('robot', 'position')
    .entities.filter(
      (e) =>
        e.owner === Owner.Player &&
        e.position!.x >= a.x &&
        e.position!.x <= b.x &&
        e.position!.y >= a.y &&
        e.position!.y <= b.y,
    )
    .map((e) => e.id);

  const store = useGameStore.getState();
  store.selectRobots(
    additive ? [...new Set([...store.selectedRobotIds, ...inBox])] : inBox,
  );
}

/** Right click: attack an enemy under the cursor if any, else move the selection there. */
function issueRightClick(
  camera: Camera,
  engine: GameEngine,
  globalX: number,
  globalY: number,
): void {
  const ctx = engine.context;
  if (!ctx) return;
  const robots = useGameStore
    .getState()
    .selectedRobotIds.map((id) => findById(ctx, id))
    .filter(
      (e): e is Entity =>
        e?.robot === true && e.owner === Owner.Player && !!e.position,
    );
  if (robots.length === 0) return;

  const point = camera.screenToWorld(globalX, globalY);
  const target = enemyAt(ctx, point);
  if (target) attackTarget(robots, target);
  else moveTo(ctx, robots, point);
}

/** Orders each selected robot to focus-fire the given enemy target (robot or base). */
function attackTarget(robots: Entity[], target: Entity): void {
  for (const robot of robots) {
    robot.script = makeAttackTarget(target.id);
    robot.targetId = undefined;
  }
}

/** Moves the selection to `point` in a compact grid formation. */
function moveTo(ctx: GameContext, robots: Entity[], point: Vec2): void {
  const cols = Math.ceil(Math.sqrt(robots.length));
  const rows = Math.ceil(robots.length / cols);
  const spacing = gameConfig.grid.tilePx * 1.2;

  robots.forEach((robot, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = (col - (cols - 1) / 2) * spacing;
    const oy = (row - (rows - 1) / 2) * spacing;
    robot.script = makeIdle();
    robot.targetId = undefined;
    setGoal(
      ctx,
      robot,
      clamp(point.x + ox, 0, worldPixelSize.width),
      clamp(point.y + oy, 0, worldPixelSize.height),
    );
  });
}

/** The living enemy robot or base under a world point (player's perspective), or undefined. */
function enemyAt(ctx: GameContext, p: Vec2): Entity | undefined {
  const robot = ctx.world
    .with('robot', 'position')
    .entities.find(
      (e) =>
        (e.hp ?? 0) > 0 &&
        isEnemy(Owner.Player, e.owner) &&
        distance(p.x, p.y, e.position!.x, e.position!.y) <=
          gameConfig.robots.radius + 4,
    );
  if (robot) return robot;

  const { tilePx } = gameConfig.grid;
  return ctx.world.with('base', 'position').entities.find((e) => {
    if ((e.hp ?? 0) <= 0 || !isEnemy(Owner.Player, e.owner)) return false;
    const half =
      ((e.footprint ?? gameConfig.bases.footprintTiles) * tilePx) / 2;
    return (
      Math.abs(p.x - e.position!.x) <= half &&
      Math.abs(p.y - e.position!.y) <= half
    );
  });
}
