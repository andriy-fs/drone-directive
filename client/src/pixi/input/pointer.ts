import { Graphics, type Application, type FederatedPointerEvent } from 'pixi.js';
import type { Entity } from '../../engine/ecs/entity';
import type { GameEngine } from '../../engine/game/engine';
import { baseFootprintContains, findById } from '../../engine/systems/targeting';
import type { Vec2 } from '@drone-directive/types/entities';
import { useGameStore } from '../../store/gameStore';
import { isTypingTarget } from '../../utils/isTypingTarget';
import { vecLength } from '../../utils/math';
import type { Camera } from '../Camera';
import type { OrderMarkerKind } from '../render/OrderMarkerView';
import { enemyAt, ownBaseAt } from './hitTest';

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
 * What the input layer reports back for the sake of on-screen feedback. Kept as
 * callbacks rather than views so this file never learns what the feedback looks
 * like: `GameApp` owns the graphics and decides what to do with a cursor position.
 */
export interface PointerHooks {
  /** An order was just issued at `point` — the marker's cue. */
  onOrder: (point: Vec2, kind: OrderMarkerKind) => void;
  /**
   * Where the cursor is, in screen pixels, or `null` when it left the canvas or
   * is dragging a marquee (no attack preview under a selection box).
   */
  onPointerMove: (screen: Vec2 | null) => void;
}

/**
 * Playfield input:
 * - Left drag = selection marquee (Shift adds); left click on your own base
 *   selects it, left click on empty ground clears the selection.
 *   (Clicking a robot is handled in RobotView.)
 * - Arrow keys/WASD = fly the observer drone (the camera follows it).
 * - `F` = land on / take off from an idle robot; `E` = fire / detonate it.
 * - Right click with a base selected = set that base's rally point (right click
 *   on the base itself clears it); the robot selection is untouched.
 * - Right click on an enemy (robot or base) = order the selection to attack it;
 *   right click on open ground = move the selection there in a compact formation.
 */
export function attachPointerControls(
  app: Application,
  camera: Camera,
  engine: GameEngine,
  hooks: PointerHooks,
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
      issueRightClick(camera, engine, e.global.x, e.global.y, hooks.onOrder);
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
    if (selecting && Math.abs(e.global.x - startX) + Math.abs(e.global.y - startY) > CLICK_SLOP) moved = true;
    // A marquee is being dragged: the player is picking units, not aiming at one.
    hooks.onPointerMove(selecting && moved ? null : { x: e.global.x, y: e.global.y });
    if (!selecting) return;
    if (moved) drawMarquee(marqueeGfx, startX, startY, e.global.x, e.global.y);
  };

  const onLeave = () => hooks.onPointerMove(null);

  const onUp = (e: FederatedPointerEvent) => {
    if (selecting) {
      if (moved) {
        selectInBox(camera, engine, startX, startY, e.global.x, e.global.y, additive);
        marqueeGfx.visible = false;
        marqueeGfx.clear();
      } else if (!additive && e.button === 0) {
        // Base selection lives here rather than in BaseView: a click there would
        // still bubble to this handler and be wiped by the clear below, and
        // stopping propagation would turn the base into dead marquee space.
        selectBaseOrClear(camera, engine, e.global.x, e.global.y);
      }
    }
    selecting = false;
    // The marquee suppressed the hover preview; hand the cursor back without
    // waiting for the player to jiggle the mouse.
    hooks.onPointerMove({ x: e.global.x, y: e.global.y });
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
    const len = vecLength(dx, dy);
    useGameStore.getState().setDroneInput(len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // "wasd" typed into the chat panel is a word, not a flight path — and `E`
    // would detonate a possessed robot mid-sentence.
    if (isTypingTarget(e.target)) return;
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
  app.canvas.addEventListener('pointerleave', onLeave);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    stage.off('pointerdown', onDown);
    stage.off('globalpointermove', onMove);
    stage.off('pointerup', onUp);
    stage.off('pointerupoutside', onUp);
    app.canvas.removeEventListener('contextmenu', onContextMenu);
    app.canvas.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    marqueeGfx.destroy();
  };
}

function drawMarquee(g: Graphics, x0: number, y0: number, x1: number, y1: number): void {
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

  const store = useGameStore.getState();
  const side = store.localSide;
  const inBox = engine.world
    .with('robot', 'position')
    .entities.filter(
      (e) =>
        e.owner === side &&
        e.position!.x >= a.x &&
        e.position!.x <= b.x &&
        e.position!.y >= a.y &&
        e.position!.y <= b.y,
    )
    .map((e) => e.id);

  store.selectRobots(additive ? [...new Set([...store.selectedRobotIds, ...inBox])] : inBox);
}

/** Plain left click: select your own base if it's under the cursor, else deselect. */
function selectBaseOrClear(camera: Camera, engine: GameEngine, globalX: number, globalY: number): void {
  const ctx = engine.context;
  const store = useGameStore.getState();
  if (!ctx) {
    store.clearSelection();
    return;
  }
  const base = ownBaseAt(ctx, camera.screenToWorld(globalX, globalY), store.localSide);
  if (base) store.selectBase(base.id);
  else store.clearSelection();
}

/**
 * Right click: with your base selected, plant (or, on the base itself, clear)
 * its rally point. Otherwise attack an enemy under the cursor if any, else move
 * the selection there.
 *
 * `onOrder` fires only past the empty-selection guard, so a click that ordered
 * nobody leaves no marker on screen. The rally branch returns before it: that
 * gesture already draws its own flag.
 */
function issueRightClick(
  camera: Camera,
  engine: GameEngine,
  globalX: number,
  globalY: number,
  onOrder: PointerHooks['onOrder'],
): void {
  const ctx = engine.context;
  if (!ctx) return;
  const store = useGameStore.getState();
  const side = store.localSide;

  if (store.selectedBaseId) {
    const base = findById(ctx, store.selectedBaseId);
    if (base?.base && base.owner === side && (base.hp ?? 0) > 0) {
      const p = camera.screenToWorld(globalX, globalY);
      // Right-clicking the base itself is the cancel gesture.
      const point = baseFootprintContains(base, p) ? null : p;
      store.enqueueCommand({ kind: 'SetRallyPoint', baseId: base.id, point });
      return;
    }
    store.selectBase(null); // the base is gone — fall back to ordering robots
  }

  const robotIds = store.selectedRobotIds
    .map((id) => findById(ctx, id))
    .filter((e): e is Entity => e?.robot === true && e.owner === side && (e.hp ?? 0) > 0 && !!e.position)
    .map((e) => e.id);
  if (robotIds.length === 0) return;

  const point = camera.screenToWorld(globalX, globalY);
  const target = enemyAt(ctx, point, side);
  // Route through the command queue (not direct entity mutation) so both peers
  // apply the order on the same tick in networked matches.
  if (target) {
    store.enqueueCommand({ kind: 'AttackTarget', robotIds, targetId: target.id });
    // Marked on the target, not on the click: the point that matters is what is
    // about to be shot at, and it is rarely exactly under the cursor.
    onOrder(target.position ?? point, 'attack');
  } else {
    store.enqueueCommand({ kind: 'MoveRobots', robotIds, point });
    onOrder(point, 'move');
  }
}
