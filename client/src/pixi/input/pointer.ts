import { Graphics, type Application, type FederatedPointerEvent } from 'pixi.js';
import { isAlive } from '../../engine/ecs/guards';
import { robots } from '../../engine/ecs/queries';
import type { GameEngine } from '../../engine/game/engine';
import {
  baseById,
  baseFootprintContains,
  livingDroneById,
  livingRobotById,
  possessedRobotOf,
} from '../../engine/systems/targeting';
import type { Vec2 } from '@drone-directive/types/entities';
import { useGameStore } from '../../store/gameStore';
import { GameStatus } from '../../store/enums';
import { isTypingTarget } from '../../utils/isTypingTarget';
import { vecLength } from '../../utils/math';
import type { Camera } from '../Camera';
import type { OrderMarkerKind } from '../render/OrderMarkerView';
import { enemyAt, ownBaseAt } from './hitTest';

/** Below this drag distance (px) a press is treated as a click, not a drag. */
const CLICK_SLOP = 4;

/** Physical keys (arrows + WASD) that move something, mapped to a unit direction. */
const MOVE_KEYS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
};

/** True when a keyboard event should move the camera (or the ridden hull). Modifier combos such as Ctrl+A are reserved for UI shortcuts. */
export function shouldHandleMoveKey(e: KeyboardEvent): boolean {
  if (!(e.code in MOVE_KEYS)) return false;
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
 * The handle `attachPointerControls` hands back. `cancelSelection` exists for one
 * caller: a pinch (see `input/zoom.ts`) begins as an ordinary one-finger press,
 * so by the time the second finger lands a marquee is already open and has to be
 * dropped without selecting anything.
 */
export interface PointerControls {
  detach: () => void;
  cancelSelection: () => void;
}

/**
 * Playfield input:
 * - Left drag = selection marquee (Shift adds); left click on your own base
 *   selects it, left click on empty ground clears the selection.
 *   (Clicking a robot is handled in RobotView, your own drone in DroneView.)
 * - Arrow keys/WASD = fly the observer drone (the camera follows it).
 * - `F` = land on / take off from an idle robot; `E` = fire / detonate it.
 * - Right click with a base selected = set that base's rally point (right click
 *   on the base itself clears it); the robot selection is untouched.
 * - Right click with your observer drone selected = fly it there. Both of the
 *   drone's control channels stay live: this one and the flight keys above,
 *   which are unchanged (see `engine/systems/drone.ts`).
 * - Right click on an enemy (robot or base) = order the selection to attack it;
 *   right click on open ground = move the selection there in a compact formation.
 *
 * **The mouse goes dead while a drone is riding a hull.** The top view is hidden
 * then (see `pixi/render/fpv/`), so a marquee would box units nobody can see and a
 * right click would send the selection at a point somewhere off the monitor — the
 * pointer is over a world that is no longer on screen. The keyboard is untouched:
 * flying, `F` and `E` are what the pilot has, and that is the trade the mode is
 * making. There is no separate exit gesture, because cutting the view loose from
 * the drone already bails the pilot out of the hull (`store/gameStore.ts`).
 */
export function attachPointerControls(
  app: Application,
  camera: Camera,
  engine: GameEngine,
  hooks: PointerHooks,
): PointerControls {
  const stage = app.stage;
  stage.eventMode = 'static';
  stage.hitArea = app.screen;

  /**
   * Whether this side's drone is currently inside a hull — asked of the world, not
   * of the store's `droneStatus`, which is a throttled snapshot and would leave a
   * few ticks in which a click still ordered units the player can no longer see.
   */
  const possessing = (): boolean => {
    const ctx = engine.context;
    return !!ctx && possessedRobotOf(ctx, useGameStore.getState().localSide) !== undefined;
  };

  const marqueeGfx = new Graphics();
  marqueeGfx.visible = false;
  stage.addChild(marqueeGfx);

  let selecting = false;
  let additive = false;
  let moved = false;
  let startX = 0;
  let startY = 0;

  const onDown = (e: FederatedPointerEvent) => {
    if (possessing()) return;
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
    if (possessing()) {
      // `F` can land mid-drag, and the marquee it opened is drawn on the stage —
      // above the monitor. Drop it here rather than in the key handler: this is the
      // one place that runs on every route into the possessed state.
      cancelSelection();
      hooks.onPointerMove(null);
      return;
    }
    if (selecting && Math.abs(e.global.x - startX) + Math.abs(e.global.y - startY) > CLICK_SLOP) moved = true;
    // A marquee is being dragged: the player is picking units, not aiming at one.
    hooks.onPointerMove(selecting && moved ? null : { x: e.global.x, y: e.global.y });
    if (!selecting) return;
    if (moved) drawMarquee(marqueeGfx, startX, startY, e.global.x, e.global.y);
  };

  const onLeave = () => hooks.onPointerMove(null);

  const onUp = (e: FederatedPointerEvent) => {
    if (possessing()) {
      cancelSelection();
      hooks.onPointerMove(null);
      return;
    }
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

  // Held arrow keys/WASD, summed into one vector on the store. This layer does not
  // decide what that vector *means* — the bridge does, off the one condition that
  // settles it: free, it pans the camera; riding a hull, it is that machine's
  // throttle and yaw, sampled on the fixed step so it stays deterministic
  // (GameApp.updateCamera / GameApp.localDroneControl).
  //
  // `F`/`E` are one-shot intents (land-or-take-off / fire).
  const pressedKeys = new Set<string>();
  const applyStick = () => {
    let dx = 0;
    let dy = 0;
    for (const code of pressedKeys) {
      dx += MOVE_KEYS[code].x;
      dy += MOVE_KEYS[code].y;
    }
    const len = vecLength(dx, dy);
    useGameStore.getState().setStickInput(len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // "wasd" typed into the chat panel is a word, not a flight path — and `E`
    // would detonate a possessed robot mid-sentence.
    if (isTypingTarget(e.target)) return;
    if (useGameStore.getState().status !== GameStatus.Playing) return;
    if (shouldHandleMoveKey(e)) {
      if (e.code.startsWith('Arrow')) e.preventDefault(); // stop the page from scrolling
      if (!pressedKeys.has(e.code)) {
        pressedKeys.add(e.code);
        applyStick();
      }
      return;
    }
    if (e.repeat) return; // one-shot intents ignore auto-repeat
    // These act on the eye the player has picked up, like every other order in the
    // game — landing on a robot, or firing from one, is something you do *with* a
    // drone, and without a selection there is no drone in hand. The old rule asked
    // whether the camera was glued to it, which was a question about the viewport
    // standing in for a question about intent.
    if (useGameStore.getState().selectedDroneId === null) return;
    if (e.code === POSSESS_KEY) useGameStore.getState().requestDronePossess();
    else if (e.code === FIRE_KEY) useGameStore.getState().requestDroneFire();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (pressedKeys.delete(e.code)) applyStick();
  };
  const onBlur = () => {
    pressedKeys.clear(); // don't leave the camera drifting after alt-tab
    useGameStore.getState().setStickInput({ x: 0, y: 0 });
  };

  const cancelSelection = () => {
    if (!selecting) return;
    selecting = false;
    moved = false;
    marqueeGfx.visible = false;
    marqueeGfx.clear();
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

  const detach = () => {
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

  return { detach, cancelSelection };
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
  const inBox = robots(engine.world)
    .entities.filter(
      (e) =>
        e.owner === side &&
        e.position.x >= a.x &&
        e.position.x <= b.x &&
        e.position.y >= a.y &&
        e.position.y <= b.y,
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
 * its rally point. With the observer drone selected, send it there. Otherwise
 * attack an enemy under the cursor if any, else move the selection there.
 *
 * The three selections are mutually exclusive in the store, so the branches are
 * an ordered chain rather than a decision: whichever slot is filled is the one
 * this click is for.
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
    const base = baseById(ctx, store.selectedBaseId);
    if (base && base.owner === side && isAlive(base)) {
      const p = camera.screenToWorld(globalX, globalY);
      // Right-clicking the base itself is the cancel gesture.
      const point = baseFootprintContains(base, p) ? null : p;
      store.enqueueCommand({ kind: 'SetRallyPoint', baseId: base.id, point });
      return;
    }
    store.selectBase(null); // the base is gone — fall back to ordering robots
  }

  if (store.selectedDroneId) {
    const drone = livingDroneById(ctx, store.selectedDroneId);
    if (drone && drone.owner === side) {
      const p = camera.screenToWorld(globalX, globalY);
      // No attack branch, unlike the robot case below: the eye is unarmed, so a
      // right click on an enemy means "go and look at that", and flying to where
      // it stands is exactly that order.
      store.enqueueCommand({ kind: 'MoveDrone', droneId: drone.id, point: p });
      onOrder(p, 'move');
      return;
    }
    store.selectDrone(null); // shot down between the click and this tick
  }

  const robotIds = store.selectedRobotIds
    .map((id) => livingRobotById(ctx, id))
    .filter((e) => e !== undefined)
    .filter((e) => e.owner === side)
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
