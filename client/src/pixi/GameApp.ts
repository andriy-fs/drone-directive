import { Application, Container, UPDATE_PRIORITY } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';
import { palette } from '../config/palette';
import type { BaseEntity, DroneEntity, RobotEntity } from '../engine/ecs/archetypes';
import type { Entity } from '../engine/ecs/entity';
import { isAlive } from '../engine/ecs/guards';
import { bases as basesQuery, drones as dronesQuery, robots as robotsQuery } from '../engine/ecs/queries';
import { GameEngine } from '../engine/game/engine';
import { isCommandFrom } from '../engine/systems/commands';
import { canActivateShield, isShielded } from '../engine/systems/shield';
import { possessedRobotOf } from '../engine/systems/targeting';
import { useGameStore } from '../store/gameStore';
import {
  ClientVersion,
  DroneMode,
  GameStatus,
  OnlineLink,
  OnlineRequest,
  OnlineStatus,
  OutcomePhase,
} from '../store/enums';
import type {
  BaseShieldSnapshot,
  BaseSnapshot,
  DroneStatus,
  GameState,
  PendingOnline,
  RobotSnapshot,
} from '../store/types';
import { selectOnlineLink } from '../store/selectors';
import type { Command } from '@drone-directive/types/commands';
import { Controller, Owner, WeaponType, type MapSize } from '@drone-directive/types/enums';
import type { DroneControl, GameContext } from '../engine/game/context';
import { loadGameAssets, loadSoundAssets, warmGameAssets } from './assets';
import { DESYNC_CHECK_EVERY } from '@drone-directive/protocol';
import { ErrorCode, LockstepSession, randomRoomCode, setNetDebug, type TickInput } from '@drone-directive/net';
import { ChatSeat } from '@drone-directive/chat';
import { attachChat } from '../chat/chatBridge';
import { lockstepConfig } from '../config/multiplayer';
import { worldHash } from '../engine/worldHash';
import { whenIdle } from '../utils/whenIdle';
import { attachSelectionAudio } from './audio/selectionAudio';
import { attachRadio, type RadioDirector } from './radio/radioDirector';
import { sfx } from './audio/sfx';
import { music } from './audio/music';
import { Camera } from './Camera';
import { GameLoop } from './GameLoop';
import { createGround } from './Grid';
import { createLayers, type Layers } from './layers';
import { attachPointerControls } from './input/pointer';
import { attachZoomControls } from './input/zoom';
import { enemyAt, selectionCanAttack } from './input/hitTest';
import { FogView } from './render/FogView';
import { HoverTargetView, type HoverTarget } from './render/HoverTargetView';
import { OrderMarkerView } from './render/OrderMarkerView';
import { RallyView, type RallyMarker } from './render/RallyView';
import { createTerrainView } from './render/terrain/TerrainView';
import { CritterView } from './render/CritterView';
import { FpvView } from './render/fpv/FpvView';
import { perfFlags } from './perf/perfFlags';
import { PerfHud } from './perf/PerfHud';
import { graphicsQuality } from './quality';
import { WorldRenderer } from './render/WorldRenderer';

/**
 * The end-of-match reveal, in milliseconds — the retro three-beat every RTS of
 * the era used: hold on the killing blow, fade the world out, then the card.
 *
 * `hold` is long enough for a base's 1.6 s death blast to be most of the way
 * through (`gameConfig.fx.baseExplosionDuration`), which is the whole reason the
 * beat exists; the two are worth keeping in step. The reveal itself has no timer
 * here — the art and the panel animate themselves in CSS once the phase lands.
 */
const OUTCOME_HOLD_MS = 1400;
const OUTCOME_VEIL_MS = 900;

/**
 * The single boundary object React touches (via useGameApp). Owns the Pixi
 * Application, the GameEngine, and the renderer; bridges engine ↔ store:
 * commands/flags flow in, throttled snapshots + bus events flow out.
 */
export class GameApp {
  readonly app: Application;
  camera!: Camera;
  layers!: Layers;
  private engine!: GameEngine;
  private worldRenderer!: WorldRenderer;
  private fogView: FogView | null = null;
  private rallyView: RallyView | null = null;
  private orderMarkerView: OrderMarkerView | null = null;
  private hoverView: HoverTargetView | null = null;
  /**
   * The second renderer: the wireframe seen from inside a possessed hull. Not one
   * of the world layers — it lives on the stage beside `camera.view`, because it
   * *replaces* the top view rather than drawing into it.
   */
  private fpvView: FpvView | null = null;
  private obstacleGfx: Container | null = null;
  /** What was asked of the context at boot — the fallback when it cannot be read back. */
  private readonly requestedAntialias = perfFlags.antialias && graphicsQuality.antialias();
  /**
   * The mountain plateaus' decorative wildlife. Rebuilt with the terrain it stands on
   * and torn down with it — see `render/CritterView.ts`.
   */
  private critterView: CritterView | null = null;
  /** Frame-time readout — see `perf/perfFlags.ts`. Null unless `?perf=1`. */
  private perfHud: PerfHud | null = null;
  private qualityUnsub: (() => void) | null = null;
  /** Last known cursor position in screen px, or null when it is off the canvas / dragging a marquee. */
  private pointerScreen: { x: number; y: number } | null = null;
  /** Mirrors `canvas.style.cursor` so the style is only written when it actually changes. */
  private cursorStyle = '';
  private loop!: GameLoop;
  private detachPointer: (() => void) | null = null;
  private detachZoom: (() => void) | null = null;
  private storeUnsub: (() => void) | null = null;
  private selectionAudioUnsub: (() => void) | null = null;
  private radio: RadioDirector | null = null;
  private readonly busUnsubs: (() => void)[] = [];
  /** Pending steps of the end-of-match reveal, so a restart can cancel them. */
  private readonly outcomeTimers: number[] = [];
  private destroyed = false;
  private snapshotTick = 0;
  /** Networked-match state (null when solo). */
  private session: LockstepSession | null = null;
  private netTick = 0;
  private pendingOnlineStart: { seed: number; mapSize: MapSize; aiCount: number } | null = null;
  private onlineEnded = false;
  /**
   * The shared pause, as both peers compute it: flipped by the `pauseToggle`
   * pulses riding on the tick both of them are applying. Derived from the input
   * stream rather than from the store, which is what makes it the same on both
   * clients — the store only mirrors it for the HUD.
   */
  private onlinePaused = false;
  /** When the current lockstep stall began (`0` while the match is advancing). */
  private stalledSince = 0;
  /**
   * A rolling count of recent networked steps and how many of them stalled, for
   * the perf readout. A stall costs no frame time at all — the loop renders
   * straight through it — so the frame timings cannot distinguish "the world is
   * waiting on the peer" from "the world is running fine", and those two need
   * completely different fixes.
   */
  private stepWindow = 0;
  private stallWindow = 0;
  private hostResizeObserver: ResizeObserver | null = null;
  /**
   * Whether the sprite textures are decoded and a world may be built. Starts
   * false: `init` only *warms* the sprites, and a match started ahead of them
   * would keep Graphics placeholders for the rest of the page's life (see
   * `loadGameAssets`).
   */
  private assetsReady = false;
  /** Whether the full-priority sprite load has been asked for; see `requestAssets`. */
  private assetsRequested = false;
  private readonly onResize = (width: number, height: number) => this.camera.setViewport(width, height);

  /** The side this client plays/views (Player offline & host; AI for the online guest). */
  private get localSide(): Owner {
    return useGameStore.getState().localSide;
  }

  constructor() {
    this.app = new Application();
  }

  async init(host: HTMLElement): Promise<void> {
    // The net package reads no bundler globals of its own, so tell it whether to
    // narrate the input it drops.
    setNetDebug(import.meta.env.DEV);

    // Nothing on the title screen is drawn from a sprite, so the atlas is warmed
    // at low priority and never awaited here. Full priority is claimed only when
    // a match is actually asked for (`requestAssets`, off the gate in `step`) —
    // calling `Assets.load` now would pause the background loader and put the
    // sprites right back in front of the backdrop, which is the whole problem.
    warmGameAssets();

    // The menu tier only — a handful of files for the cues that can sound before a
    // match exists. Deferred to idle rather than started here: the backdrop is the
    // one thing the player is actually looking at, and the AudioContext is
    // suspended until the first pointer press anyway.
    whenIdle(() => void loadSoundAssets('menu'));

    await this.app.init({
      resizeTo: host,
      background: palette.background,
      // Pinned, not left to auto-detection. The terrain and ground meshes ship
      // GLSL programs with no WGSL counterpart, so a fall-through to WebGPU would
      // find them without a `gpuProgram` and silently drop the whole field. WebGL
      // is already first in Pixi's default order — this makes that load-bearing
      // rather than incidental. Adding WebGPU means adding `gpuProgram` to
      // `render/terrain/terrainShaders.ts` and `render/GroundMesh.ts`.
      preference: 'webgl',
      // Both come from the player's graphics-quality setting; the perf harness can
      // only force antialias *off*, never on, so a measurement run never quietly
      // upgrades what the player chose.
      antialias: this.requestedAntialias,
      autoDensity: true,
      resolution: graphicsQuality.resolution(),
    });
    host.appendChild(this.app.canvas);
    if (perfFlags.hud) this.perfHud = new PerfHud(host);

    // The resolution half of the setting applies live; antialias cannot (context
    // creation flag), and the settings dialog tells the player so.
    this.qualityUnsub = graphicsQuality.onResolutionChange((resolution) => {
      // One `resize` rather than assigning `renderer.resolution` — the setter
      // re-resizes the render texture from its *own* current dimensions, so it
      // reads whatever it just wrote. Passing the screen size explicitly, in CSS
      // pixels, leaves nothing to infer.
      const { width, height } = this.app.screen;
      this.app.renderer.resize(width, height, resolution);
    });

    this.layers = createLayers();
    // No ground until a match exists — it is sized off that match's grid, and
    // drawing it under the title screen is what used to burn a frame's worth of
    // full-viewport tiling every rAF while the player read the menu.
    this.fogView = new FogView();
    this.layers.fog.addChild(this.fogView.container);
    // Above the fog: a rally point is the player's own order, not something the
    // map has to reveal. No per-match state, so it is never rebuilt.
    this.rallyView = new RallyView();
    this.layers.overlay.addChild(this.rallyView.container);
    // Order feedback shares the overlay for the same reason, and like the rally
    // flags it holds no per-match state, so neither is ever rebuilt.
    this.orderMarkerView = new OrderMarkerView();
    this.layers.overlay.addChild(this.orderMarkerView.container);
    this.hoverView = new HoverTargetView();
    this.layers.overlay.addChild(this.hoverView.container);
    this.camera = new Camera(this.layers.root);
    this.app.stage.addChild(this.camera.view);
    this.camera.setViewport(this.app.screen.width, this.app.screen.height);

    this.engine = new GameEngine();
    this.worldRenderer = new WorldRenderer(this.layers, this.engine.world);
    this.wireBus();
    // Selection never reaches the bus (it is store-only state), so its sounds
    // come off a store subscription rather than out of `wireBus`.
    this.selectionAudioUnsub = attachSelectionAudio(this.engine.world);
    // The radio keeps its own subscriptions rather than joining `wireBus`: it has
    // a dozen handlers, its own pacing state and a per-tick pump, and folding that
    // into the audio/snapshot wiring would bury all three.
    this.radio = attachRadio(this.engine.bus, this.engine.world, (owner, baseId) =>
      this.hearsBase(owner, baseId),
    );

    const pointer = attachPointerControls(this.app, this.camera, this.engine, {
      // No `wake()` needed on either: an order can only be issued inside a match,
      // and the loop is never parked while one exists.
      onOrder: (point, kind) => this.orderMarkerView?.add(point, kind),
      onPointerMove: (screen) => {
        this.pointerScreen = screen;
      },
    });
    this.detachPointer = pointer.detach;
    // Zoom is camera-only state the simulation never hears about, so it needs
    // nothing from the engine — just the pointer's marquee, to call off the one
    // it opened when the pinch's first finger landed.
    this.detachZoom = attachZoomControls(this.app, this.camera, {
      onPinchStart: pointer.cancelSelection,
    });

    // Added to the stage *after* the pointer's marquee graphic, so nothing belonging
    // to the top view can draw over the monitor. Starts hidden; `syncFpv` owns the
    // switch from here on.
    this.fpvView = new FpvView();
    // `app.screen` is a live rectangle, so the monitor pass is bounded to the
    // viewport once and tracks every resize from here on. Without it Pixi would
    // measure the target's global bounds — and the wireframe terrain's bounds are
    // the whole map, in world coordinates.
    this.fpvView.attachTo(this.app.screen);
    this.app.stage.addChild(this.fpvView.container);

    this.app.renderer.on('resize', this.onResize);

    // `resizeTo` only listens for *window* resizes, so it misses the host shrinking
    // on its own — which is exactly what happens when the HUD column mounts at match
    // start and takes 300px off the viewport's width. The renderer would keep the
    // menu-width screen for the whole match: the canvas overhangs its clipped host,
    // and the camera clamps against a viewport wider than what is actually on screen,
    // so the drone flies into that hidden strip near the right edge of the map. Height
    // never changes with the sidebar, which is why only horizontal panning broke.
    this.hostResizeObserver = new ResizeObserver(() => this.app.queueResize());
    this.hostResizeObserver.observe(host);

    // Everything `step()` has to consume while no match is running arrives as a
    // store flag, so the parked loop can be woken from here instead of polled.
    this.storeUnsub = useGameStore.subscribe((s, prev) => {
      if (s.restartRequested !== prev.restartRequested || s.menuRequested !== prev.menuRequested) this.wake();
      else if (s.pendingOnline !== prev.pendingOnline) this.wake();
    });

    this.loop = new GameLoop(
      (dt) => this.step(dt),
      () => this.render(),
    );
    this.loop.start(this.app.ticker);

    // Runs *after* Pixi's own draw, which `Application` adds at LOW — so this is
    // the first point in the frame where every millisecond the main thread owed
    // has been paid. Only wired under `?perf=1`: it exists to answer one
    // question, and an idle game should not pay for it. See `frameBusyMs`.
    if (this.perfHud) {
      this.app.ticker.add(this.measureFrameBusy, this, UPDATE_PRIORITY.UTILITY);
    }
  }

  /**
   * Whether the live WebGL context actually has MSAA.
   *
   * Read back from the context rather than reported from the setting that asked for
   * it, because the two can disagree: `antialias` is a context-creation flag, so a
   * setting changed since boot has not taken effect, and a driver is free to refuse
   * the request outright. A performance readout that repeated the *intent* would be
   * confidently wrong in exactly the runs someone is comparing.
   *
   * Falls back to what was requested if the attributes cannot be read, which is the
   * best available answer rather than a silent `false`.
   */
  private contextAntialias(): boolean {
    const gl = (this.app.renderer as { gl?: WebGL2RenderingContext }).gl;
    return gl?.getContextAttributes()?.antialias ?? this.requestedAntialias;
  }

  /**
   * Main-thread time the whole frame took, draw included — measured from the top
   * of `GameLoop.onTick` to after Pixi has submitted.
   *
   * Read against the frame *interval*: when the two are close the thread is
   * saturated and the work is real; when the interval is far larger the thread
   * spent the difference doing nothing, and the frame rate is being set by
   * something outside this process — vsync, the compositor, or another program
   * competing for the GPU. The game's own `sim` and `render` figures cannot tell
   * those apart, because Pixi's draw lands between them and the next frame.
   */
  private frameBusyMs = 0;
  private readonly measureFrameBusy = (): void => {
    this.frameBusyMs = performance.now() - this.loop.frameStartedAt;
  };

  /**
   * Claim the sprites at full priority, once. Called the first time a match is
   * actually asked for: until then they trickle in via `warmGameAssets`, and
   * `Assets.load` here promotes whatever is left of that queue and awaits the
   * same promise, so nothing is fetched twice.
   *
   * `loadGameAssets` swallows its own failures, so a 404 in the set still flips
   * `assetsReady` — a broken asset must degrade to a placeholder, never wedge the
   * gate shut.
   */
  private requestAssets(): void {
    if (this.assetsRequested) return;
    this.assetsRequested = true;
    void loadGameAssets().then(() => {
      this.assetsReady = true;
      // The loop is only woken by store flags *changing*, and the request that is
      // waiting on this has not changed since it was raised.
      this.wake();
    });
  }

  /**
   * A start request `step` has seen but is holding back until the sprites land.
   *
   * Reading the store from a getter is fine here — the flags are one-shot and
   * `step` is the only thing that clears them.
   */
  private get startHeld(): boolean {
    if (this.assetsReady) return false;
    const store = useGameStore.getState();
    if (store.menuRequested) return false; // leaving to the menu builds no world
    return store.restartRequested || this.pendingOnlineStart !== null;
  }

  /**
   * Menu/lobby: no match to simulate, and **nothing asked for that a step has yet
   * to consume**.
   *
   * That second half is not belt-and-braces, it is the whole point. The loop is
   * only ever woken by a store flag **changing** (see the subscription in `init`),
   * and `requestRestart` writes `true` over `true` — so a request parked before it
   * was consumed is stranded for good, and pressing Start again does nothing at
   * all. `GameLoop.park` guards this by refusing until one fixed step has run
   * since the resume, but one step is not enough once `step` can *hold* a request
   * instead of consuming it: at 60 Hz against a 30 Hz sim every other frame
   * renders without stepping, so the frame right after a held step parks on a
   * request that is still outstanding. Same trap as
   * `.docs/tasks/menu-start-restart-idle-loop.md`, reached from the other side.
   *
   * Keyed off the flags rather than off `startHeld` for exactly that reason:
   * "waiting for sprites" is a shorter interval than "not consumed yet", and it
   * was the gap between the two that the bug lived in.
   */
  private get idle(): boolean {
    if (this.engine.context !== null || this.pendingOnlineStart !== null) return false;
    const { restartRequested, menuRequested } = useGameStore.getState();
    return !restartRequested && !menuRequested;
  }

  /**
   * Park the render/simulation loop after one last frame. The title screen has no
   * world to draw and nothing to advance, so an idle tab should cost nothing —
   * `wake()` brings it back the moment something needs a tick.
   *
   * `GameLoop.park()` refuses until a fixed step has run since the last wake, so
   * a request that woke the loop is always given a tick to be consumed in — no
   * caller has to enumerate the pending flags to know it is safe to park.
   */
  private sleep(): void {
    if (this.loop.park()) this.app.render();
  }

  private wake(): void {
    if (this.destroyed) return;
    this.loop.resume();
  }

  /**
   * Sync the views and get them on screen even if the loop is already parked —
   * `sleep()` only flushes the frame it parks on, so a world change arriving off
   * the ticker (a peer disconnecting, say) would otherwise sit invisible behind
   * the last frame the canvas happens to be holding.
   */
  private flush(): void {
    const parked = !this.loop.running;
    this.render();
    if (parked) this.app.render();
  }

  /** Render pass: move the camera, sync views, redraw fog, rally flags and order feedback. */
  private render(): void {
    this.updateCamera();
    const { selectedRobotIds, selectedBaseId } = useGameStore.getState();
    const selected = new Set(selectedRobotIds);
    if (selectedBaseId) selected.add(selectedBaseId);
    // Wall clock, not sim time: none of what it drives is simulation state, and
    // all of it should keep animating while the match is paused. Read once and
    // shared, so every pulse on screen — the dome, the order marker, the hover
    // reticle — is in the same phase.
    const now = performance.now();
    if (this.perfHud) {
      const ctx = this.engine.context;
      this.perfHud.sample(
        this.app.ticker.deltaMS,
        {
          sim: this.loop.simMs,
          render: this.loop.renderMs,
          busy: this.frameBusyMs,
          resolution: this.app.renderer.resolution,
          antialias: this.contextAntialias(),
          steps: this.loop.steps,
        },
        {
          inMatch: !!ctx,
          paused: useGameStore.getState().paused,
          robots: ctx ? robotsQuery(this.engine.world).entities.length : 0,
          stalled: this.session?.isStarted && this.stepWindow > 0 ? this.stallWindow / this.stepWindow : null,
        },
      );
    }
    this.worldRenderer.sync(selected, (e) => this.isVisibleToLocalSide(e), now);
    if (perfFlags.fog) this.fogView?.update(this.engine.context?.fog);
    this.rallyView?.update(this.localRallyMarkers());
    this.critterView?.update(now);
    this.orderMarkerView?.update(now);
    const hovered = this.attackHoverTarget(selectedRobotIds);
    this.hoverView?.update(hovered, now);
    this.setCursor(hovered ? 'crosshair' : '');
    this.syncFpv(now);
    // One check covers every way into the menu — first load, Esc, game over, a
    // peer disconnecting — so no transition has to remember to park the loop.
    if (this.idle) this.sleep();
  }

  /**
   * Show the wireframe view, or the top view, depending on whether this side's
   * drone is currently riding a hull.
   *
   * **Derived every frame from the world, never latched.** The state that decides
   * this is `drone.possessedId`, which the simulation writes and — crucially — also
   * *clears* on its own: `droneSystem` drops it the tick the hull under the pilot
   * dies. A boolean set on entry and cleared on exit would have to enumerate every
   * way out (release, death, game over, leaving to the menu, a peer disconnecting,
   * a restart) and would strand the player inside a machine that no longer exists
   * the first time one of them was missed. Asking the world costs one small scan
   * and cannot be wrong.
   *
   * It runs from `render()`, so `flush()` — the one-frame draw for a world change
   * arriving while the loop is parked — gets it for free.
   *
   * The top view keeps syncing behind the monitor. That is deliberate rather than
   * an oversight: `RobotView`'s gait and dust are clocked off ground covered and
   * `ShieldDomeView` infers hits from a per-frame compare, so a view skipped for
   * the length of a possession would come back with a visible discontinuity in it.
   * Pixi skips *drawing* a hidden container, which is where the cost actually was.
   */
  private syncFpv(now: number): void {
    const view = this.fpvView;
    if (!view) return;
    const ctx = this.engine.context;
    const robot = ctx ? possessedRobotOf(ctx, this.localSide) : undefined;

    this.camera.view.visible = !robot;
    view.container.visible = !!robot;
    if (!robot) return;

    view.render({
      robot,
      world: this.engine.world,
      ctx: ctx ?? null,
      fog: ctx?.fog,
      isVisible: (e) => this.isVisibleToLocalSide(e),
      width: this.app.screen.width,
      height: this.app.screen.height,
      now,
    });
  }

  /**
   * The enemy under the cursor that the current selection could attack, or null.
   *
   * Recomputed every frame rather than on pointer movement: the cursor can stand
   * still while a robot drives out from under it, and the highlight has to follow
   * the target, not the mouse. The fog check is the one thing this adds over the
   * right-click path — an order may be given at a remembered position, but drawing
   * a bracket around an enemy this side cannot see would hand out free intel.
   */
  private attackHoverTarget(selectedRobotIds: readonly string[]): HoverTarget | null {
    const ctx = this.engine.context;
    if (!ctx || !this.pointerScreen || selectedRobotIds.length === 0) return null;

    const side = this.localSide;
    const p = this.camera.screenToWorld(this.pointerScreen.x, this.pointerScreen.y);
    const target = enemyAt(ctx, p, side);
    if (!target?.position || !this.isVisibleToLocalSide(target)) return null;
    if (!selectionCanAttack(ctx, selectedRobotIds, side, target)) return null;

    const halfSize = target.base
      ? ((target.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx) / 2
      : gameConfig.robots.radius;
    return { pos: target.position, halfSize };
  }

  /** Swap the canvas cursor, touching the DOM only when it actually changes. */
  private setCursor(style: string): void {
    if (this.cursorStyle === style) return;
    this.cursorStyle = style;
    this.app.canvas.style.cursor = style;
  }

  /**
   * Rally flags to draw — the local side's only. Both peers hold every base's
   * `production.rally`, so this filter is what keeps the opponent's gathering
   * point off this client's screen.
   */
  private localRallyMarkers(): RallyMarker[] {
    const markers: RallyMarker[] = [];
    for (const base of basesQuery(this.engine.world)) {
      const rally = base.production.rally;
      if (rally && base.owner === this.localSide && isAlive(base)) {
        markers.push({ base: base.position, rally });
      }
    }
    return markers;
  }

  /**
   * Centre the viewport on the local side's observer drone (this player's eye),
   * as long as the player has the view synced to it. Unsynced — or with the
   * drone shot down — the same keys pan the camera freely instead of leaving the
   * view frozen: the player loses the drone's vision, not the ability to look
   * around. Never falls back to *another* side's drone: online that would hand
   * this client a live view of the opponent's scout.
   *
   * The sync flag is what keeps a rebuilt drone from yanking the player home.
   * It is dropped when the drone dies (see `wireBus`), so the replacement that
   * rolls out over the base 30 s later appears without moving the viewport, and
   * the player decides when to go back to it.
   */
  private updateCamera(): void {
    const drone = dronesQuery(this.engine.world).entities.find((d) => d.owner === this.localSide);
    if (drone && useGameStore.getState().viewSyncedToDrone) {
      this.camera.centerOn(drone.position.x, drone.position.y);
      return;
    }

    const dir = useGameStore.getState().droneInput;
    if (dir.x === 0 && dir.y === 0) return;
    // Camera-only, so a real frame delta is fine here — nothing about panning
    // feeds the simulation, which keeps running on its own fixed step.
    const frameDt = Math.min(this.app.ticker.deltaMS / 1000, gameConfig.maxFrameDt);
    const step = gameConfig.camera.keyboardPanSpeed * frameDt;
    this.camera.panByWorld(dir.x * step, dir.y * step);
  }

  /**
   * Put the viewport back on the drone for a new match. The sync flag survives
   * the end of a match (it is plain store state), so without this a player whose
   * drone was down when the last one finished would open the next one looking at
   * an empty corner of a world they have not seen yet. The zoom goes back with
   * it, for the same reason: it is a view setting, not a preference, and a match
   * should not open at whatever scale the last fight happened to end on.
   */
  private resetView(store: GameState): void {
    this.camera.resetZoom();
    store.setViewSync(true);
    store.clearDroneReadyNotice();
  }

  /** Subscribe app-layer observers (audio + store sync) to discrete engine events. */
  private wireBus(): void {
    const bus = this.engine.bus;
    const store = useGameStore.getState;
    this.busUnsubs.push(
      bus.on('projectileFired', ({ weapon }) => {
        // One case per weapon with a cue of its own; the cannon report is the
        // fallback for everything else (a `bomb` never gets here — it detonates
        // rather than firing).
        switch (weapon) {
          case WeaponType.Missiles:
            sfx.missileShot();
            break;
          case WeaponType.Dew:
            sfx.dewShot();
            break;
          case WeaponType.Fpv:
            sfx.fpvShot();
            break;
          default:
            sfx.cannonShot();
            break;
        }
      }),
    );
    this.busUnsubs.push(bus.on('entityDestroyed', () => sfx.explosion()));
    // A stale base selection would keep aiming rally orders at a corpse instead
    // of falling back to moving robots.
    this.busUnsubs.push(
      bus.on('entityDestroyed', ({ id }) => {
        if (store().selectedBaseId === id) store().selectBase(null);
      }),
    );
    this.busUnsubs.push(bus.on('entitySpawned', () => this.pushSnapshot()));
    this.busUnsubs.push(
      // The opening drone emits nothing, and no side starts with robots, so this
      // event already means "produced mid-match". The owner filter keeps the AI's (and,
      // online, the opponent's) factories out of this player's speakers.
      bus.on('entitySpawned', ({ kind, owner }) => {
        if (kind === 'robot' && owner === this.localSide) sfx.unitReady();
      }),
    );
    // The two halves of "your eye was shot down, and here is the new one".
    //
    // Dropping the sync on death is what stops the replacement — which always
    // rolls out over the base — from hauling the player back from wherever they
    // were fighting. The notice then says a drone is up again, and the player
    // chooses the moment to fly it. Same filter as the factory pip above: the
    // opponent's eye is not this client's business.
    //
    // The opening drone is spawned straight into the world by `gameScene` with
    // no event, so a `drone` spawn reaching here always means "rebuilt mid-match".
    this.busUnsubs.push(
      bus.on('entityDestroyed', ({ kind, owner }) => {
        if (kind === 'drone' && owner === this.localSide) store().setViewSync(false);
      }),
    );
    this.busUnsubs.push(
      bus.on('entitySpawned', ({ kind, owner }) => {
        if (kind === 'drone' && owner === this.localSide) store().noteDroneReady();
      }),
    );
    this.busUnsubs.push(bus.on('entityDestroyed', () => this.pushSnapshot()));
    // The dome's three moments. Gated on *knowledge* rather than ownership,
    // unlike the factory pip above: a dome is a large thing happening on screen,
    // so once its base has been found, hearing it come up and hearing it fail is
    // information the player has already earned.
    this.busUnsubs.push(
      bus.on('shieldRaised', ({ owner, baseId }) => {
        if (this.hearsBase(owner, baseId)) sfx.shieldUp();
      }),
    );
    this.busUnsubs.push(
      bus.on('shieldEnded', ({ owner, baseId, shattered }) => {
        if (!this.hearsBase(owner, baseId)) return;
        if (shattered) sfx.shieldBreak();
        else sfx.shieldDown();
      }),
    );
    // Raising and losing a dome both change what the Command tile offers, and
    // neither waits for the next throttled push to be worth showing.
    this.busUnsubs.push(bus.on('shieldRaised', () => this.pushSnapshot()));
    this.busUnsubs.push(bus.on('shieldEnded', () => this.pushSnapshot()));
    this.busUnsubs.push(
      bus.on('sceneChanged', ({ scene }) => {
        store().clearSelection();
        store().setBuildDialogOpen(false); // never carry an open dialog across matches
        if (scene === 'menu') {
          store().setStatus(GameStatus.Menu);
          // The menu bed is `MainMenu`'s to start; this only lets go of the
          // match one. The two fades overlap into a crossfade either way round.
          music.stop('match');
          // Whichever outcome was playing goes with it — leaving to the menu is
          // one of the two ways out of the game-over screen.
          music.stop('victory');
          music.stop('defeat');
          this.clearOutcome();
          this.clearObstacles();
          this.clearGround();
          this.fpvView?.setTerrain(null);
          // Flush the emptied world to the canvas here rather than waiting for the
          // next tick: this can arrive from a socket callback (peer left, error)
          // while the loop is already parked, and the last frame of the finished
          // match would otherwise stay frozen on screen.
          this.flush();
        } else {
          store().setStatus(GameStatus.Playing);
          // The one place both routes into a match pass through, solo and online
          // alike. Deliberately not awaited and not part of the start gate the way
          // the sprites are: `sfx.play` re-checks readiness on every call, so a cue
          // still decoding is skipped for that shot and heard on the next one —
          // there is nothing here to keep the player waiting for.
          void loadSoundAssets('match');
          // The match bed, on the same signal and for the same reason: this is
          // the one point both routes into a match pass through. It keeps
          // playing through pause, and stops only when an outcome stinger fades
          // it out from under itself — see `music.playOnce`.
          music.play('match');
          // The other way out of the game-over screen: Play Again re-enters here,
          // and neither the track nor the veil that was on screen may follow the
          // player into the next match.
          music.stop('victory');
          music.stop('defeat');
          this.clearOutcome();
          // Warm both stingers now so the one that fires at game over is already
          // decoded. Same reasoning as `loadSoundAssets` above, and free after
          // the first match — the fetch is memoized, and skipped entirely when
          // music is off.
          music.prefetch('victory');
          music.prefetch('defeat');
          // Map size can change between matches — rebuild everything sized off
          // the grid so it reflects the size `applyMapSize` just set.
          this.rebuildGround();
          this.rebuildFog();
          this.rebuildObstacles();
          this.rebuildFpvTerrain();
        }
        this.pushSnapshot();
      }),
    );
    this.busUnsubs.push(
      // Free-for-all: knocked out is a defeat right away, even though the sim
      // plays on until one side is left (stopping it here would desync a peer).
      bus.on('sideEliminated', ({ owner }) => {
        if (owner !== store().localSide) return;
        store().setStatus(GameStatus.Lost);
        store().setBuildDialogOpen(false);
        music.playOnce('defeat');
        this.beginOutcome();
        this.pushSnapshot();
      }),
    );
    this.busUnsubs.push(
      bus.on('gameOver', ({ winner }) => {
        // A defeat may already be on screen from `sideEliminated` — only a win
        // can still change the outcome at this point.
        if (winner === store().localSide) store().setStatus(GameStatus.Won);
        else if (store().status !== GameStatus.Lost) store().setStatus(GameStatus.Lost);
        store().setBuildDialogOpen(false); // don't leave it stranded behind the game-over modal
        // Matches the status above, including the case it defers to: a defeat
        // already announced by `sideEliminated` is already playing, and
        // `playOnce` is a no-op the second time.
        music.playOnce(winner === store().localSide ? 'victory' : 'defeat');
        this.beginOutcome();
        this.pushSnapshot();
      }),
    );
  }

  /**
   * Start the end-of-match reveal: hold on the burning wreck, fade the world to
   * black, then bring the outcome card up out of it.
   *
   * **Wall-clock timers, not simulation ticks, and that is the point.** The
   * engine has already decided the match and both peers agree; nothing here
   * touches the world, so a lockstep session must not be made to wait on one
   * player's rendering. Deferring the `gameOver` emit itself would have put this
   * delay inside the deterministic pipeline for no gain.
   *
   * See `.docs/tasks/outcome-transition.md`.
   */
  private beginOutcome(): void {
    // A free-for-all knock-out raises the defeat twice — `sideEliminated` and
    // then `gameOver` — and must be revealed once.
    if (useGameStore.getState().outcomePhase !== OutcomePhase.None) return;
    // Whoever asked for less motion gets the result, not the show. The CSS has
    // its own guard for the fades; this one is for the delay, which is the part
    // no media query can cancel.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      useGameStore.getState().setOutcomePhase(OutcomePhase.Reveal);
      return;
    }
    useGameStore.getState().setOutcomePhase(OutcomePhase.Hold);
    this.outcomeTimers.push(
      window.setTimeout(() => useGameStore.getState().setOutcomePhase(OutcomePhase.Veil), OUTCOME_HOLD_MS),
      window.setTimeout(
        () => useGameStore.getState().setOutcomePhase(OutcomePhase.Reveal),
        OUTCOME_HOLD_MS + OUTCOME_VEIL_MS,
      ),
    );
  }

  /** Drop the reveal and any step of it still pending (restart, menu, teardown). */
  private clearOutcome(): void {
    for (const timer of this.outcomeTimers) window.clearTimeout(timer);
    this.outcomeTimers.length = 0;
    if (useGameStore.getState().outcomePhase !== OutcomePhase.None) {
      useGameStore.getState().setOutcomePhase(OutcomePhase.None);
    }
  }

  /**
   * One fixed step: apply control flags, forward input, advance, snapshot.
   *
   * Returns whether the step was consumed (see `UpdateFn`). `false` comes from
   * exactly one place — a lockstep stall in `stepOnline` — so the loop keeps
   * that step's budget and catches up when the peer's input arrives. Every
   * other early exit is not a stall and must cost its step, or the menu and
   * match-start behaviour would change.
   */
  private step(dt: number): boolean {
    const store = useGameStore.getState();

    // Online lobby request (host/join/leave), raised by the UI. Not gated below:
    // talking to the relay draws nothing.
    const pending = store.consumePendingOnline();
    if (pending) this.applyOnlineRequest(pending);

    // Building a world before its textures exist would leave every unit on its
    // Graphics placeholder permanently (see `loadGameAssets`). Neither the flag
    // nor `pendingOnlineStart` is consumed here, so the request simply waits for
    // a later step — and `idle` knows not to park the loop while it does.
    if (this.startHeld) {
      this.requestAssets();
      return true;
    }

    // A networked match whose `start` handshake has arrived.
    if (this.pendingOnlineStart) {
      const start = this.pendingOnlineStart;
      this.pendingOnlineStart = null;
      this.beginOnlineMatch(start.seed, start.mapSize, start.aiCount);
      return true;
    }

    if (store.restartRequested || store.menuRequested) {
      const toMenu = store.menuRequested;
      store.clearRequests();
      this.leaveOnlineIfAny();
      if (toMenu) this.engine.toMenu();
      else {
        // Clear any lingering online flag so a solo restart runs with the bot AI.
        store.updateSettings({ match: { online: false } });
        this.resetView(store);
        // `?seed=` pins the battlefield so two runs are comparable; without it the
        // context seeds from the clock, which is what solo play normally wants.
        this.engine.startMatch(useGameStore.getState().settings, perfFlags.seed ?? undefined);
        this.engine.setLocalSide(Owner.Player);
      }
      return true;
    }

    // Networked match: advance under lockstep instead of ticking directly.
    // The session is read into a local so the guard below narrows it for
    // `stepOnline`, which needs it non-null for the whole tick.
    const session = this.session;
    if (session?.isStarted && store.online.status === OnlineStatus.InMatch) {
      return this.stepOnline(session, dt, store);
    }

    // Solo / offline live loop.
    this.engine.setPaused(store.paused);
    this.enqueueFrom(Owner.Player, store.drainCommands());
    this.engine.setDroneControl(Owner.Player, this.localDroneControl(store));
    store.clearDroneRequests();
    this.engine.tick(dt);
    this.snapshotAfterTick();
    return true;
  }

  /**
   * Advance one networked tick once both sides' inputs for it have arrived —
   * else stall, returning `false` so the loop keeps the step's budget.
   */
  private stepOnline(session: LockstepSession, dt: number, store: GameState): boolean {
    // Halved rather than reset, so the ratio keeps a memory of the recent past
    // instead of restarting from whatever the last few steps happened to do.
    if (++this.stepWindow > 120) {
      this.stepWindow >>= 1;
      this.stallWindow >>= 1;
    }
    if (!session.ready(this.netTick)) {
      this.stallWindow++;
      this.noteStall(store);
      return false;
    }
    this.noteRunning(store);

    const side = store.localSide;
    const remote = this.remoteSide(side);
    const { local, peer } = session.take(this.netTick);
    // Every command applies by entity id on both peers (no relabeling) — that keeps
    // the shared world identical; only presentation differs by `localSide`. Each
    // batch is screened against the side that sent it, so neither client can order
    // the other's units (see isCommandFrom). Both peers screen the same batches
    // against the same pre-tick world, so the filter stays deterministic.
    //
    // Enqueue in *roster* order, not local-first: each peer holds a different
    // side, so "mine then theirs" would queue the same two batches in opposite
    // orders on the two clients. Commands only ever touch their own side's
    // entities today, so that happens to commute — but relying on it is one
    // refactor away from a desync nobody can reproduce.
    const batches = [
      { owner: side, input: local },
      { owner: remote, input: peer },
    ].sort((a, b) => this.seat(a.owner) - this.seat(b.owner));
    for (const batch of batches) this.enqueueFrom(batch.owner, batch.input.commands);
    this.engine.setDroneControl(side, local.drone);
    this.engine.setDroneControl(remote, peer.drone);
    // Both pulses, so two players pausing on the same tick cancel out identically
    // on both clients — and the flip lands on this tick in both worlds, which is
    // the whole reason the pause travels as input instead of as a message.
    this.applyPauseToggles(local.pauseToggle, peer.pauseToggle);
    this.engine.tick(dt); // a no-op while paused: the world stops, the tick stream does not

    // Desync probe: hash the world every so often so the peers can notice they
    // have parted instead of quietly showing each other different battles.
    if (this.netTick % DESYNC_CHECK_EVERY === 0) {
      session.recordHash(this.netTick, worldHash(this.engine.world));
    }

    // Sample fresh local input and schedule it INPUT_DELAY ticks ahead (heartbeat even if empty).
    session.scheduleLocal(this.netTick + session.inputDelay, this.captureLocalInput(store));
    this.netTick += 1;
    this.snapshotAfterTick();
    return true;
  }

  /**
   * Flip the shared pause once per pulse and hand the result to the engine (whose
   * `tick` then does nothing until it is lifted). The store is told too, but only
   * so the HUD can draw the overlay: what the two simulations obey is this flag,
   * computed from the same two bits on both clients.
   */
  private applyPauseToggles(local: boolean, peer: boolean): void {
    const paused = this.onlinePaused !== (local !== peer);
    if (paused !== this.onlinePaused) {
      this.onlinePaused = paused;
      useGameStore.getState().setPaused(paused);
    }
    this.engine.setPaused(paused);
  }

  /**
   * The step could not run: neither side's world advances without the other's
   * input for this tick, so this is a wait rather than a fault — announced once
   * it has lasted long enough to be worth mentioning, and abandoned only when it
   * has lasted long enough that nobody is coming back. A peer whose tab was
   * backgrounded stops sending without ever closing its socket, and that is the
   * only thing this ceiling exists for.
   */
  private noteStall(store: GameState): void {
    const now = performance.now();
    if (this.stalledSince === 0) this.stalledSince = now;
    const stalledFor = now - this.stalledSince;
    if (stalledFor >= gameConfig.online.stallTimeoutMs) {
      this.endOnline('The opponent stopped responding');
      return;
    }
    // `reconnecting` is our own socket and outranks this: it says more about the
    // same silence, and the session clears it when the seat is back.
    if (stalledFor >= gameConfig.online.stallNoticeMs && selectOnlineLink(store) === OnlineLink.Ok) {
      store.setOnlineLink(OnlineLink.Stalled);
    }
  }

  /** A step went through: whatever the hold-up was, it is over. */
  private noteRunning(store: GameState): void {
    this.stalledSince = 0;
    // Only our own stall is ours to clear — `reconnecting` belongs to the session,
    // which lifts it when the seat is actually back.
    if (selectOnlineLink(store) === OnlineLink.Stalled) store.setOnlineLink(OnlineLink.Ok);
  }

  /** A side's index in the roster — the same on every peer, so it orders anything canonically. */
  private seat(owner: Owner): number {
    return this.engine.context?.roster.findIndex((s) => s.owner === owner) ?? 0;
  }

  /**
   * The side the peer is playing: the other human seat in the roster. Bots are
   * simulated locally on both peers, so they never own an input stream.
   */
  private remoteSide(local: Owner): Owner {
    const humans = this.engine.context?.roster.filter((s) => s.controller === Controller.Human) ?? [];
    return humans.find((s) => s.owner !== local)?.owner ?? Owner.AI;
  }

  /** Forward `side`'s commands to the engine, dropping any that act on units it doesn't own. */
  private enqueueFrom(side: Owner, commands: Command[]): void {
    const ctx = this.engine.context;
    if (!ctx) return; // no match running — nothing these could act on
    for (const command of commands) {
      if (isCommandFrom(ctx, command, side)) this.engine.enqueueCommand(command);
    }
  }

  /**
   * This client's input for one tick. While the match is paused everything but
   * the pause request itself is dropped on the floor: a stopped world is a break,
   * not free thinking time in which to queue up orders. Each peer decides that
   * about its own input, so the two never have to agree on it — nothing here can
   * make the simulations differ.
   */
  private captureLocalInput(store: GameState): TickInput {
    const pauseToggle = store.consumePauseToggle();
    if (this.onlinePaused) {
      store.drainCommands();
      store.clearDroneRequests();
      return { commands: [], drone: { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false }, pauseToggle };
    }
    const commands = store.drainCommands();
    const drone = this.localDroneControl(store);
    store.clearDroneRequests();
    return { commands, drone, pauseToggle };
  }

  /**
   * The local side's stick for one tick, read off the store.
   *
   * `droneInput` does double duty: with the view synced it flies the drone, and
   * with it loose the very same vector pans the camera (`updateCamera`). So the
   * unsynced case has to send a zero stick, or the player would be walking the
   * drone across the map every time they looked around. Deterministic either
   * way — the input is authored here and goes on the wire already zeroed, so
   * both peers step the same world.
   *
   * The pulses pass through untouched: while unsynced the input layer stops
   * raising them (see `input/pointer.ts`), which leaves the release queued by
   * `setViewSync` as the only one that can still arrive.
   */
  private localDroneControl(store: GameState): DroneControl {
    const synced = store.viewSyncedToDrone;
    return {
      dir: synced ? { x: store.droneInput.x, y: store.droneInput.y } : { x: 0, y: 0 },
      possessPulse: store.dronePossessRequested,
      firePulse: store.droneFireRequested,
    };
  }

  private snapshotAfterTick(): void {
    // The radio's queue drains here rather than on its own timer: this is the
    // one hook both the solo and the online tick paths already share, and it
    // stops when the world does — a paused match should not keep narrating.
    this.radio?.pump();
    this.snapshotTick += 1;
    if (this.snapshotTick >= gameConfig.hud.snapshotEveryTicks) {
      this.snapshotTick = 0;
      this.pushSnapshot();
    }
  }

  /**
   * The two simulations have parted. Nothing can be salvaged — the peers are now
   * playing different battles — so say so loudly rather than let the match drift
   * on showing each player a different world.
   */
  private reportDesync(tick: number, mine: number, theirs: number): void {
    const side = this.localSide;
    console.error(
      `[desync] world diverged at tick ${tick} — local (${side}) hash ${mine.toString(16)}, peer ${theirs.toString(16)}. ` +
        `Everything after this tick differs between the two clients.`,
    );
    this.endOnline(`Desync at tick ${tick} — the two clients stopped simulating the same match.`, true);
  }

  /** Act on a lobby request: open a host/guest session, or leave an active one. */
  private applyOnlineRequest(req: PendingOnline): void {
    if (req.kind === OnlineRequest.Leave) {
      this.leaveOnlineIfAny();
      this.engine.toMenu();
      return;
    }
    this.session?.disconnect();
    this.onlineEnded = false;
    // Decided here rather than read back from the store later: the host's code is
    // generated at connect time, and the chat is labelled with the room it came
    // from so two saved conversations are distinguishable.
    const isHost = req.kind === OnlineRequest.Host;
    const roomCode = isHost ? randomRoomCode() : req.roomCode;
    this.session = new LockstepSession(
      {
        onCreated: (code) => useGameStore.getState().setOnlineHosting(code),
        onStart: (seed, mapSize, aiCount, chatId) => {
          this.pendingOnlineStart = { seed, mapSize, aiCount };
          // Attached here and torn down nowhere below: `endOnline` and
          // `leaveOnlineIfAny` drop `this.session` only. That asymmetry is the
          // client half of "chat outlives the match" — the moment the opponent
          // leaves is exactly when the players want to say something.
          attachChat(chatId, isHost ? ChatSeat.Host : ChatSeat.Guest, roomCode);
          this.wake(); // arrives over the socket, with the loop parked on the lobby
        },
        onOpponentLeft: () => this.endOnline('Opponent left the match'),
        // The relay is the authority on the protocol, and this is the only place
        // its verdict reaches us. Latching it here is what makes the block work
        // for a desktop client, whose bundled `version.json` can only ever agree
        // with itself (see ui/hooks/useUpdateCheck).
        onError: (code, message) => {
          if (code === ErrorCode.VersionMismatch) {
            useGameStore.getState().reportClientVersion(ClientVersion.OnlineBlocked);
          }
          this.endOnline(message, true);
        },
        onClose: () => this.endOnline('Connection closed'),
        // A dropped socket is not a dropped match: the relay holds the seat, the
        // session goes back for it, and this client's world is frozen at the same
        // tick the peer's is. All the HUD has to do is stop looking crashed.
        onLinkDown: () => useGameStore.getState().setOnlineLink(OnlineLink.Reconnecting),
        onLinkUp: () => {
          useGameStore.getState().setOnlineLink(OnlineLink.Ok);
          this.wake(); // the loop may have parked while the socket was away
        },
        onDesync: (tick, mine, theirs) => this.reportDesync(tick, mine, theirs),
      },
      lockstepConfig,
    );
    if (req.kind === OnlineRequest.Host) this.session.connectHost(roomCode, req.mapSize, req.aiOpponents);
    else this.session.connectGuest(roomCode);
  }

  /** Start the shared simulation from the relay's seed + map size. */
  private beginOnlineMatch(seed: number, mapSize: MapSize, aiCount: number): void {
    const store = useGameStore.getState();
    // The host chose the roster; the guest adopts it wholesale, or the two peers
    // would build different worlds from the same seed.
    store.updateSettings({ match: { mapSize, aiOpponents: aiCount, online: true } });
    this.netTick = 0;
    this.onlinePaused = false;
    this.stalledSince = 0;
    this.stepWindow = 0;
    this.stallWindow = 0;
    // Nothing else clears `paused`, and a stale `true` from an earlier solo match
    // would freeze this client's world while the peer's kept running.
    store.setPaused(false);
    this.resetView(store);
    this.engine.startMatch(useGameStore.getState().settings, seed);
    this.engine.setLocalSide(store.localSide);
    this.applyOnlineBaseSetup(store);
    store.setOnlineInMatch();
  }

  /**
   * Hand the title screen's base setup to a networked match.
   *
   * `gameScene` deliberately skips it online: it applies the *local* settings
   * directly to the world, and each client only knows its own, so two peers
   * would build different worlds from the same seed. The setup is per-player
   * though, not part of the handshake, so it travels the way every other base
   * change does — on the command queue, screened against the side that sent it
   * and applied at the same tick on both peers.
   *
   * Two commands, because the two settings are independent: the directive goes
   * as a `SetDefaultTask` unconditionally (`null` included — that is a real
   * setting, "robots roll out with no program"), and the auto-build order only
   * when there is one. It used to ride solely inside `SetAutoBuild.order.task`,
   * which meant a player who chose a directive but no auto-production silently
   * lost it online.
   */
  private applyOnlineBaseSetup(store: GameState): void {
    const { autoBuild, defaultProgram } = useGameStore.getState().settings.base;
    const base = basesQuery(this.engine.world).entities.find((e) => e.owner === store.localSide);
    if (!base) return;
    store.enqueueCommand({ kind: 'SetDefaultTask', baseId: base.id, task: defaultProgram });
    // The order keeps its own `task` too: `productionSystem` prefers it over the
    // base default, which is exactly what happens offline, where `gameScene`
    // applies both settings.
    if (autoBuild) {
      store.enqueueCommand({ kind: 'SetAutoBuild', baseId: base.id, order: { ...autoBuild, task: defaultProgram } });
    }
  }

  /** End an online match (peer left / error / disconnect) and return to the menu. */
  private endOnline(message: string, isError = false): void {
    if (this.onlineEnded) return;
    this.onlineEnded = true;
    const store = useGameStore.getState();
    const wasInMatch = store.online.status === OnlineStatus.InMatch;
    this.session?.disconnect();
    this.session = null;
    this.resetOnlineRun(store);
    this.engine.toMenu();
    // Never having got into the match makes any ending a failure: there is no
    // match to have "just finished", only a lobby that did not become one.
    store.setOnlineFinished(message, isError || !wasInMatch);
  }

  /**
   * Tear down any active online session (used when restarting/leaving to the menu).
   *
   * The store reset is unconditional even though the teardown is not: a match that
   * ended on its own (`endOnline` — peer left, error, desync) has already dropped
   * the session while leaving `online.status` at `ended`/`error` for the lobby to
   * report. Returning early on a null session used to leave that status stuck, and
   * `MainMenu` keeps the lobby mounted for any non-`offline` status — a full-screen
   * `.dialog-frame` over the menu that swallows every click until a page reload.
   */
  private leaveOnlineIfAny(): void {
    const store = useGameStore.getState();
    if (this.session) {
      this.onlineEnded = true;
      this.session.disconnect();
      this.session = null;
      this.resetOnlineRun(store);
    }
    store.setOnlineOffline();
  }

  /**
   * Forget everything that only means something inside a networked match. The
   * pause especially: it belongs to the two simulations that just stopped
   * existing, and leaving it set would hand the next solo match a frozen world.
   */
  private resetOnlineRun(store: GameState): void {
    this.netTick = 0;
    this.pendingOnlineStart = null;
    this.onlinePaused = false;
    this.stalledSince = 0;
    this.stepWindow = 0;
    this.stallWindow = 0;
    store.setPaused(false);
  }

  /**
   * Whether a base's own events are audible here: ours always, anyone else's
   * only once we have found their base. Bases are discovered permanently, so
   * this never flickers — unlike unit visibility.
   */
  private hearsBase(owner: Owner, baseId: string): boolean {
    if (owner === this.localSide) return true;
    return this.engine.context?.intel[this.localSide].knownBaseIds.has(baseId) ?? false;
  }

  /** Fog of war: the local side's own units are always visible; every rival's only once detected. */
  private isVisibleToLocalSide(e: Entity): boolean {
    const side = this.localSide;
    if (e.owner === side || e.owner === undefined || e.owner === Owner.Neutral) return true;
    const intel = this.engine.context?.intel[side];
    if (!intel) return true;
    if (e.robot) return intel.visibleRobotIds.has(e.id);
    if (e.base) return intel.knownBaseIds.has(e.id);
    if (e.drone || e.munition) return intel.visibleAirIds.has(e.id);
    return true;
  }

  /** Projects HUD-facing state from the ECS world into the store. */
  private pushSnapshot(): void {
    const store = useGameStore.getState();
    const world = this.engine.world;
    const bases = basesQuery(world).entities;
    store.setRobots(robotsQuery(world).entities.map(toRobotSnapshot));
    const ctx = this.engine.context;
    // Bases need the context: the dome's `threatNear` is read off this side's
    // intel, which only exists while a match does.
    store.setBases(ctx ? bases.map((b) => toBaseSnapshot(b, ctx, store.localSide)) : []);
    if (ctx) {
      store.setSides(
        ctx.roster.map((s) => ({
          owner: s.owner,
          alive: bases.some((b) => b.owner === s.owner && isAlive(b)),
          bot: s.controller === Controller.Bot,
        })),
      );
      store.setResources({ ...ctx.resources });
      store.setDroneStatus(droneStatusOf(dronesQuery(world).entities, ctx, store.localSide));
    }
  }

  /**
   * The ground surface is sized off `worldPixelSize`/`gameConfig.grid` — rebuild
   * per match. Takes the match's terrain: the decal scatter has to avoid blocked
   * tiles and the bases' clear margins.
   */
  private rebuildGround(): void {
    this.clearGround();
    const ctx = this.engine.context;
    if (!ctx) return;
    this.layers.ground.addChild(createGround(ctx.terrain));
  }

  /** Drop the ground surface (and anything else on its layer) — no match, nothing to stand on. */
  private clearGround(): void {
    for (const child of this.layers.ground.removeChildren()) child.destroy({ children: true });
  }

  /** Fresh fog mask sized for the current match's grid, with its redraw cache reset. */
  private rebuildFog(): void {
    this.fogView?.destroy();
    this.fogView = new FogView();
    this.layers.fog.addChild(this.fogView.container);
  }

  /**
   * The terrain field, drawn as landforms over the ground (see `TerrainView`).
   * Kept on the ground layer, and therefore under the fog: unexplored terrain must
   * stay hidden, cast shadows and crater ejecta included.
   */
  private rebuildObstacles(): void {
    this.clearObstacles();
    const ctx = this.engine.context;
    if (!ctx || !perfFlags.terrain) return;
    this.obstacleGfx = createTerrainView(ctx.terrain);
    this.layers.ground.addChild(this.obstacleGfx);
    // Above the terrain and still on the `ground` layer, which is what puts the
    // creatures under the fog: unexplored ones must stay hidden along with the rock
    // they stand on. Inside the `?terrain=0` guard deliberately — they are decoration
    // *on* the terrain, so a switch that removes the landform removes them too.
    if (perfFlags.critters) {
      this.critterView = new CritterView(ctx.terrain);
      this.layers.ground.addChild(this.critterView.container);
    }
  }

  /**
   * The wireframe view's static half — the relief, its line buffer and its fog
   * mask, all sized off this match's grid. Its own method rather than a line inside
   * `rebuildObstacles` because that one returns early under `?terrain=0`, and a
   * measurement switch for the top view has no business emptying the monitor.
   */
  private rebuildFpvTerrain(): void {
    this.fpvView?.setTerrain(this.engine.context?.terrain ?? null);
  }

  private clearObstacles(): void {
    // `children: true` because the terrain view is a stack of sub-layers now, not
    // one flat container — destroying only the root would strand the rest.
    this.obstacleGfx?.destroy({ children: true });
    this.obstacleGfx = null;
    this.critterView?.destroy();
    this.critterView = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.session?.disconnect();
    this.session = null;
    this.loop?.stop();
    this.app.ticker.remove(this.measureFrameBusy, this);
    this.worldRenderer?.destroy();
    this.fogView?.destroy();
    this.fogView = null;
    this.rallyView?.destroy();
    this.rallyView = null;
    this.orderMarkerView?.destroy();
    this.orderMarkerView = null;
    this.hoverView?.destroy();
    this.hoverView = null;
    this.fpvView?.destroy();
    this.fpvView = null;
    this.perfHud?.destroy();
    this.perfHud = null;
    this.qualityUnsub?.();
    this.qualityUnsub = null;
    // Before the bus goes: a pending reveal step would otherwise fire into a
    // store whose app no longer exists.
    this.clearOutcome();
    for (const unsub of this.busUnsubs) unsub();
    this.storeUnsub?.();
    this.storeUnsub = null;
    this.selectionAudioUnsub?.();
    this.selectionAudioUnsub = null;
    this.radio?.destroy();
    this.radio = null;
    this.detachPointer?.();
    this.detachPointer = null;
    this.detachZoom?.();
    this.detachZoom = null;
    this.clearObstacles();
    this.hostResizeObserver?.disconnect();
    this.hostResizeObserver = null;
    this.app.renderer?.off('resize', this.onResize);
    this.app.destroy({ removeView: true }, { children: true });
  }
}

/**
 * HUD view of the local side's eye: its health while it flies, or how far along
 * its replacement is once it has been shot down.
 */
function droneStatusOf(drones: DroneEntity[], ctx: GameContext, side: Owner): DroneStatus {
  const { maxHp, respawnTime } = gameConfig.drone;
  const drone = drones.find((d) => d.owner === side);
  if (!drone) {
    const left = ctx.droneRespawn[side];
    return {
      mode: DroneMode.Down,
      possessedRobotId: null,
      hp: 0,
      maxHp,
      respawnProgress: respawnTime > 0 ? 1 - left / respawnTime : 1,
    };
  }

  const possessedRobotId = drone.drone.possessedId ?? null;
  return {
    mode: possessedRobotId ? DroneMode.Possessing : DroneMode.Flying,
    possessedRobotId,
    hp: drone.hp,
    maxHp: drone.maxHp,
    respawnProgress: 0,
  };
}

function toBaseSnapshot(e: BaseEntity, ctx: GameContext, localSide: Owner): BaseSnapshot {
  return {
    id: e.id,
    owner: e.owner,
    hp: e.hp,
    maxHp: e.maxHp,
    queueLength: e.production.queue.length,
    buildProgress: e.production.progress,
    autoBuild: e.production.autoBuild,
    defaultTask: e.production.defaultTask,
    rally: e.production.rally,
    shield: baseShieldOf(e, ctx, localSide),
  };
}

function baseShieldOf(e: BaseEntity, ctx: GameContext, localSide: Owner): BaseShieldSnapshot {
  return {
    active: isShielded(e),
    hp: e.shield?.hp ?? 0,
    maxHp: gameConfig.bases.shield.hp,
    secondsLeft: e.shield?.left ?? 0,
    spent: !!e.shieldSpent,
    // Own base only: this comes straight off `ctx.intel[owner]`, that side's
    // private knowledge of the battlefield, and the store is not the place to
    // keep a rival's.
    threatNear: e.owner === localSide && canActivateShield(ctx, e),
  };
}

function toRobotSnapshot(e: RobotEntity): RobotSnapshot {
  return {
    id: e.id,
    owner: e.owner,
    chassis: e.chassis,
    weapon: e.weaponType,
    task: e.script.programId,
    hp: e.hp,
    maxHp: e.maxHp,
    formation: e.script.blackboard.formation?.type ?? null,
  };
}
