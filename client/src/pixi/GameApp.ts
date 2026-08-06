import { Application, Container } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';
import { palette } from '../config/palette';
import type { Entity } from '../engine/ecs/entity';
import { GameEngine } from '../engine/game/engine';
import { isCommandFrom } from '../engine/systems/commands';
import {
  useGameStore,
  type BaseSnapshot,
  type DroneStatus,
  type GameState,
  type PendingOnline,
  type RobotSnapshot,
} from '../store/gameStore';
import type { Command } from '@drone-directive/types/commands';
import { Controller, Owner, TaskType, WeaponType, type MapSize } from '@drone-directive/types/enums';
import type { DroneControl, GameContext } from '../engine/game/context';
import { loadGameAssets, loadSoundAssets, warmGameAssets } from './assets';
import { DESYNC_CHECK_EVERY } from '@drone-directive/protocol';
import { LockstepSession, randomRoomCode, setNetDebug, type TickInput } from '@drone-directive/net';
import { ChatSeat } from '@drone-directive/chat';
import { attachChat } from '../chat/chatBridge';
import { lockstepConfig } from '../config/multiplayer';
import { worldHash } from '../engine/worldHash';
import { whenIdle } from '../utils/whenIdle';
import { attachSelectionAudio } from './audio/selectionAudio';
import { sfx } from './audio/sfx';
import { Camera } from './Camera';
import { GameLoop } from './GameLoop';
import { createGround } from './Grid';
import { createLayers, type Layers } from './layers';
import { attachPointerControls } from './input/pointer';
import { enemyAt, selectionCanAttack } from './input/hitTest';
import { FogView } from './render/FogView';
import { HoverTargetView, type HoverTarget } from './render/HoverTargetView';
import { OrderMarkerView } from './render/OrderMarkerView';
import { RallyView, type RallyMarker } from './render/RallyView';
import { createObstaclesGraphic } from './render/ObstaclesView';
import { WorldRenderer } from './render/WorldRenderer';

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
  private obstacleGfx: Container | null = null;
  /** Last known cursor position in screen px, or null when it is off the canvas / dragging a marquee. */
  private pointerScreen: { x: number; y: number } | null = null;
  /** Mirrors `canvas.style.cursor` so the style is only written when it actually changes. */
  private cursorStyle = '';
  private loop!: GameLoop;
  private detachPointer: (() => void) | null = null;
  private storeUnsub: (() => void) | null = null;
  private selectionAudioUnsub: (() => void) | null = null;
  private readonly busUnsubs: (() => void)[] = [];
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
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    host.appendChild(this.app.canvas);

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

    this.detachPointer = attachPointerControls(this.app, this.camera, this.engine, {
      // No `wake()` needed on either: an order can only be issued inside a match,
      // and the loop is never parked while one exists.
      onOrder: (point, kind) => this.orderMarkerView?.add(point, kind),
      onPointerMove: (screen) => {
        this.pointerScreen = screen;
      },
    });
    this.app.renderer.on('resize', this.onResize);

    // `resizeTo` only listens for *window* resizes, so it misses the host shrinking
    // on its own — which is exactly what happens when the HUD column mounts at match
    // start and takes 260px off the viewport's width. The renderer would keep the
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
  }

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
    this.worldRenderer.sync(selected, (e) => this.isVisibleToLocalSide(e));
    this.fogView?.update(this.engine.context?.fog);
    this.rallyView?.update(this.localRallyMarkers());
    // Wall clock, not sim time: neither effect is simulation state, and both
    // should keep animating while the match is paused.
    const now = performance.now();
    this.orderMarkerView?.update(now);
    const hovered = this.attackHoverTarget(selectedRobotIds);
    this.hoverView?.update(hovered, now);
    this.setCursor(hovered ? 'crosshair' : '');
    // One check covers every way into the menu — first load, Esc, game over, a
    // peer disconnecting — so no transition has to remember to park the loop.
    if (this.idle) this.sleep();
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
    for (const base of this.engine.world.with('base', 'position', 'production')) {
      const rally = base.production!.rally;
      if (rally && base.owner === this.localSide && (base.hp ?? 0) > 0) {
        markers.push({ base: base.position!, rally });
      }
    }
    return markers;
  }

  /**
   * Centre the viewport on the local side's observer drone (this player's eye).
   * While that drone is shot down, the same keys pan the camera freely instead
   * of leaving the view frozen — the player loses the drone's vision, not the
   * ability to look around. Never falls back to *another* side's drone: online
   * that would hand this client a live view of the opponent's scout.
   */
  private updateCamera(): void {
    const drone = this.engine.world.with('drone', 'position').entities.find((d) => d.owner === this.localSide);
    if (drone?.position) {
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
      // Starter robots and the opening drone emit nothing, so this event already
      // means "produced mid-match". The owner filter is what keeps the AI's (and,
      // online, the opponent's) factories out of this player's speakers.
      bus.on('entitySpawned', ({ kind, owner }) => {
        if (kind === 'robot' && owner === this.localSide) sfx.unitReady();
      }),
    );
    this.busUnsubs.push(bus.on('entityDestroyed', () => this.pushSnapshot()));
    this.busUnsubs.push(
      bus.on('sceneChanged', ({ scene }) => {
        store().clearSelection();
        store().setBuildDialogOpen(false); // never carry an open dialog across matches
        if (scene === 'menu') {
          store().setStatus('menu');
          this.clearObstacles();
          this.clearGround();
          // Flush the emptied world to the canvas here rather than waiting for the
          // next tick: this can arrive from a socket callback (peer left, error)
          // while the loop is already parked, and the last frame of the finished
          // match would otherwise stay frozen on screen.
          this.flush();
        } else {
          store().setStatus('playing');
          // The one place both routes into a match pass through, solo and online
          // alike. Deliberately not awaited and not part of the start gate the way
          // the sprites are: `sfx.play` re-checks readiness on every call, so a cue
          // still decoding is skipped for that shot and heard on the next one —
          // there is nothing here to keep the player waiting for.
          void loadSoundAssets('match');
          // Map size can change between matches — rebuild everything sized off
          // the grid so it reflects the size `applyMapSize` just set.
          this.rebuildGround();
          this.rebuildFog();
          this.rebuildObstacles();
        }
        this.pushSnapshot();
      }),
    );
    this.busUnsubs.push(
      // Free-for-all: knocked out is a defeat right away, even though the sim
      // plays on until one side is left (stopping it here would desync a peer).
      bus.on('sideEliminated', ({ owner }) => {
        if (owner !== store().localSide) return;
        store().setStatus('lost');
        store().setBuildDialogOpen(false);
        this.pushSnapshot();
      }),
    );
    this.busUnsubs.push(
      bus.on('gameOver', ({ winner }) => {
        // A defeat may already be on screen from `sideEliminated` — only a win
        // can still change the outcome at this point.
        if (winner === store().localSide) store().setStatus('won');
        else if (store().status !== 'lost') store().setStatus('lost');
        store().setBuildDialogOpen(false); // don't leave it stranded behind the game-over modal
        this.pushSnapshot();
      }),
    );
  }

  /** One fixed step: apply control flags, forward input, advance, snapshot. */
  private step(dt: number): void {
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
      return;
    }

    // A networked match whose `start` handshake has arrived.
    if (this.pendingOnlineStart) {
      const start = this.pendingOnlineStart;
      this.pendingOnlineStart = null;
      this.beginOnlineMatch(start.seed, start.mapSize, start.aiCount);
      return;
    }

    if (store.restartRequested || store.menuRequested) {
      const toMenu = store.menuRequested;
      store.clearRequests();
      this.leaveOnlineIfAny();
      if (toMenu) this.engine.toMenu();
      else {
        // Clear any lingering online flag so a solo restart runs with the bot AI.
        store.updateSettings({ match: { online: false } });
        this.engine.startMatch(useGameStore.getState().settings);
        this.engine.setLocalSide(Owner.Player);
      }
      return;
    }

    // Networked match: advance under lockstep instead of ticking directly.
    if (this.session?.isStarted && store.online.status === 'inMatch') {
      this.stepOnline(dt, store);
      return;
    }

    // Solo / offline live loop.
    this.engine.setPaused(store.paused);
    this.enqueueFrom(Owner.Player, store.drainCommands());
    this.engine.setDroneControl(Owner.Player, {
      dir: store.droneInput,
      possessPulse: store.dronePossessRequested,
      firePulse: store.droneFireRequested,
    });
    store.clearDroneRequests();
    this.engine.tick(dt);
    this.snapshotAfterTick();
  }

  /** Advance one networked tick once both sides' inputs for it have arrived (else stall). */
  private stepOnline(dt: number, store: GameState): void {
    const session = this.session!;
    if (!session.ready(this.netTick)) return void this.noteStall(store);
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
    if (stalledFor >= gameConfig.online.stallNoticeMs && store.online.link === 'ok') {
      store.setOnline({ link: 'stalled' });
    }
  }

  /** A step went through: whatever the hold-up was, it is over. */
  private noteRunning(store: GameState): void {
    this.stalledSince = 0;
    if (store.online.link === 'stalled') store.setOnline({ link: 'ok' });
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
    const drone: DroneControl = {
      dir: { x: store.droneInput.x, y: store.droneInput.y },
      possessPulse: store.dronePossessRequested,
      firePulse: store.droneFireRequested,
    };
    store.clearDroneRequests();
    return { commands, drone, pauseToggle };
  }

  private snapshotAfterTick(): void {
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
    if (req.kind === 'leave') {
      this.leaveOnlineIfAny();
      this.engine.toMenu();
      return;
    }
    this.session?.disconnect();
    this.onlineEnded = false;
    // Decided here rather than read back from the store later: the host's code is
    // generated at connect time, and the chat is labelled with the room it came
    // from so two saved conversations are distinguishable.
    const isHost = req.kind === 'host';
    const roomCode = isHost ? randomRoomCode() : req.roomCode;
    this.session = new LockstepSession(
      {
        onCreated: (code) => useGameStore.getState().setOnline({ status: 'hosting', roomCode: code }),
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
        onError: (_code, message) => this.endOnline(message, true),
        onClose: () => this.endOnline('Connection closed'),
        // A dropped socket is not a dropped match: the relay holds the seat, the
        // session goes back for it, and this client's world is frozen at the same
        // tick the peer's is. All the HUD has to do is stop looking crashed.
        onLinkDown: () => useGameStore.getState().setOnline({ link: 'reconnecting' }),
        onLinkUp: () => {
          useGameStore.getState().setOnline({ link: 'ok' });
          this.wake(); // the loop may have parked while the socket was away
        },
        onDesync: (tick, mine, theirs) => this.reportDesync(tick, mine, theirs),
      },
      lockstepConfig,
    );
    if (req.kind === 'host') this.session.connectHost(roomCode, req.mapSize, req.aiOpponents);
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
    // Nothing else clears `paused`, and a stale `true` from an earlier solo match
    // would freeze this client's world while the peer's kept running.
    store.setPaused(false);
    this.engine.startMatch(useGameStore.getState().settings, seed);
    this.engine.setLocalSide(store.localSide);
    store.setOnline({ status: 'inMatch', link: 'ok' });
  }

  /** End an online match (peer left / error / disconnect) and return to the menu. */
  private endOnline(message: string, isError = false): void {
    if (this.onlineEnded) return;
    this.onlineEnded = true;
    const store = useGameStore.getState();
    const wasInMatch = store.online.status === 'inMatch';
    this.session?.disconnect();
    this.session = null;
    this.resetOnlineRun(store);
    this.engine.toMenu();
    store.setOnline({ status: isError || !wasInMatch ? 'error' : 'ended', roomCode: null, error: message, link: 'ok' });
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
    store.setOnline({ status: 'offline', roomCode: null, error: null, link: 'ok' });
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
    store.setPaused(false);
  }

  /** Fog of war: the local side's own units are always visible; every rival's only once detected. */
  private isVisibleToLocalSide(e: Entity): boolean {
    const side = this.localSide;
    if (e.owner === side || e.owner === undefined || e.owner === Owner.Neutral) return true;
    const intel = this.engine.context?.intel[side];
    if (!intel) return true;
    if (e.robot) return intel.visibleRobotIds.has(e.id);
    if (e.base) return intel.knownBaseIds.has(e.id);
    if (e.drone) return intel.visibleDroneIds.has(e.id);
    return true;
  }

  /** Projects HUD-facing state from the ECS world into the store. */
  private pushSnapshot(): void {
    const store = useGameStore.getState();
    const world = this.engine.world;
    const bases = world.with('base').entities;
    store.setBases(bases.map(toBaseSnapshot));
    store.setRobots(world.with('robot').entities.map(toRobotSnapshot));
    const ctx = this.engine.context;
    if (ctx) {
      store.setSides(
        ctx.roster.map((s) => ({
          owner: s.owner,
          alive: bases.some((b) => b.owner === s.owner && (b.hp ?? 0) > 0),
          bot: s.controller === Controller.Bot,
        })),
      );
      store.setResources({ ...ctx.resources });
      store.setDroneStatus(droneStatusOf(world.with('drone').entities, ctx, store.localSide));
    }
  }

  /** The ground surface is sized off `worldPixelSize`/`gameConfig.grid` — rebuild per match. */
  private rebuildGround(): void {
    this.clearGround();
    this.layers.ground.addChild(createGround());
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

  private rebuildObstacles(): void {
    this.clearObstacles();
    const ctx = this.engine.context;
    if (!ctx) return;
    this.obstacleGfx = createObstaclesGraphic(ctx.terrain);
    this.layers.ground.addChild(this.obstacleGfx);
  }

  private clearObstacles(): void {
    this.obstacleGfx?.destroy();
    this.obstacleGfx = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.session?.disconnect();
    this.session = null;
    this.loop?.stop();
    this.worldRenderer?.destroy();
    this.fogView?.destroy();
    this.fogView = null;
    this.rallyView?.destroy();
    this.rallyView = null;
    this.orderMarkerView?.destroy();
    this.orderMarkerView = null;
    this.hoverView?.destroy();
    this.hoverView = null;
    for (const unsub of this.busUnsubs) unsub();
    this.storeUnsub?.();
    this.storeUnsub = null;
    this.selectionAudioUnsub?.();
    this.selectionAudioUnsub = null;
    this.detachPointer?.();
    this.detachPointer = null;
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
function droneStatusOf(drones: Entity[], ctx: GameContext, side: Owner): DroneStatus {
  const { maxHp, respawnTime } = gameConfig.drone;
  const drone = drones.find((d) => d.owner === side);
  if (!drone) {
    const left = ctx.droneRespawn[side];
    return {
      mode: 'down',
      possessedRobotId: null,
      hp: 0,
      maxHp,
      respawnProgress: respawnTime > 0 ? 1 - left / respawnTime : 1,
    };
  }

  const possessedRobotId = drone.drone?.possessedId ?? null;
  return {
    mode: possessedRobotId ? 'possessing' : 'flying',
    possessedRobotId,
    hp: drone.hp ?? 0,
    maxHp: drone.maxHp ?? maxHp,
    respawnProgress: 0,
  };
}

function toBaseSnapshot(e: Entity): BaseSnapshot {
  return {
    id: e.id,
    owner: e.owner ?? Owner.Neutral,
    hp: e.hp ?? 0,
    maxHp: e.maxHp ?? 1,
    queueLength: e.production?.queue.length ?? 0,
    buildProgress: e.production?.progress ?? 0,
    autoBuild: e.production?.autoBuild ?? null,
    defaultTask: e.production?.defaultTask ?? null,
    rally: e.production?.rally ?? null,
  };
}

function toRobotSnapshot(e: Entity): RobotSnapshot {
  return {
    id: e.id,
    owner: e.owner ?? Owner.Neutral,
    chassis: e.chassis!,
    weapon: e.weaponType!,
    task: e.script?.programId ?? TaskType.Idle,
    hp: e.hp ?? 0,
    maxHp: e.maxHp ?? 1,
  };
}
