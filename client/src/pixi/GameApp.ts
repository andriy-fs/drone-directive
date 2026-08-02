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
import { loadGameAssets } from './assets';
import { DESYNC_CHECK_EVERY } from '@drone-directive/protocol';
import { LockstepSession, randomRoomCode, setNetDebug, type TickInput } from '@drone-directive/net';
import { lockstepConfig } from '../config/multiplayer';
import { worldHash } from '../engine/worldHash';
import { sfx } from './audio/sfx';
import { Camera } from './Camera';
import { GameLoop } from './GameLoop';
import { createGround } from './Grid';
import { createLayers, type Layers } from './layers';
import { attachPointerControls } from './input/pointer';
import { FogView } from './render/FogView';
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
  private obstacleGfx: Container | null = null;
  private loop!: GameLoop;
  private detachPointer: (() => void) | null = null;
  private storeUnsub: (() => void) | null = null;
  private readonly busUnsubs: (() => void)[] = [];
  private destroyed = false;
  private snapshotTick = 0;
  /** Networked-match state (null when solo). */
  private session: LockstepSession | null = null;
  private netTick = 0;
  private pendingOnlineStart: { seed: number; mapSize: MapSize; aiCount: number } | null = null;
  private onlineEnded = false;
  private hostResizeObserver: ResizeObserver | null = null;
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

    await this.app.init({
      resizeTo: host,
      background: palette.background,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    host.appendChild(this.app.canvas);

    await loadGameAssets();

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
    this.camera = new Camera(this.layers.root);
    this.app.stage.addChild(this.camera.view);
    this.camera.setViewport(this.app.screen.width, this.app.screen.height);

    this.engine = new GameEngine();
    this.worldRenderer = new WorldRenderer(this.layers, this.engine.world);
    this.wireBus();

    this.detachPointer = attachPointerControls(this.app, this.camera, this.engine);
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

  /** Menu/lobby: no match to simulate, and nothing queued that would start one. */
  private get idle(): boolean {
    return this.engine.context === null && this.pendingOnlineStart === null;
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

  /** Render pass: move the camera, sync views, redraw fog and rally flags. */
  private render(): void {
    this.updateCamera();
    const { selectedRobotIds, selectedBaseId } = useGameStore.getState();
    const selected = new Set(selectedRobotIds);
    if (selectedBaseId) selected.add(selectedBaseId);
    this.worldRenderer.sync(selected, (e) => this.isVisibleToLocalSide(e));
    this.fogView?.update(this.engine.context?.fog);
    this.rallyView?.update(this.localRallyMarkers());
    // One check covers every way into the menu — first load, Esc, game over, a
    // peer disconnecting — so no transition has to remember to park the loop.
    if (this.idle) this.sleep();
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
        if (weapon === WeaponType.Missiles) sfx.missileShot();
        else sfx.cannonShot();
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

    // Online lobby request (host/join/leave), raised by the UI.
    const pending = store.consumePendingOnline();
    if (pending) this.applyOnlineRequest(pending);

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
    if (!session.ready(this.netTick)) return; // waiting on the peer — both stall the same way

    // A networked match can't be paused, but `paused` survives a previous solo
    // match (nothing clears it), and a stale `true` here would silently freeze
    // this client's world while the peer's kept running.
    this.engine.setPaused(false);

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
    this.engine.tick(dt);

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

  private captureLocalInput(store: GameState): TickInput {
    const commands = store.drainCommands();
    const drone: DroneControl = {
      dir: { x: store.droneInput.x, y: store.droneInput.y },
      possessPulse: store.dronePossessRequested,
      firePulse: store.droneFireRequested,
    };
    store.clearDroneRequests();
    return { commands, drone };
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
    this.session = new LockstepSession(
      {
        onCreated: (roomCode) => useGameStore.getState().setOnline({ status: 'hosting', roomCode }),
        onStart: (seed, mapSize, aiCount) => {
          this.pendingOnlineStart = { seed, mapSize, aiCount };
          this.wake(); // arrives over the socket, with the loop parked on the lobby
        },
        onOpponentLeft: () => this.endOnline('Opponent left the match'),
        onError: (_code, message) => this.endOnline(message, true),
        onClose: () => this.endOnline('Connection closed'),
        onDesync: (tick, mine, theirs) => this.reportDesync(tick, mine, theirs),
      },
      lockstepConfig,
    );
    if (req.kind === 'host') this.session.connectHost(randomRoomCode(), req.mapSize, req.aiOpponents);
    else this.session.connectGuest(req.roomCode);
  }

  /** Start the shared simulation from the relay's seed + map size. */
  private beginOnlineMatch(seed: number, mapSize: MapSize, aiCount: number): void {
    const store = useGameStore.getState();
    // The host chose the roster; the guest adopts it wholesale, or the two peers
    // would build different worlds from the same seed.
    store.updateSettings({ match: { mapSize, aiOpponents: aiCount, online: true } });
    this.netTick = 0;
    this.engine.startMatch(useGameStore.getState().settings, seed);
    this.engine.setLocalSide(store.localSide);
    store.setOnline({ status: 'inMatch' });
  }

  /** End an online match (peer left / error / disconnect) and return to the menu. */
  private endOnline(message: string, isError = false): void {
    if (this.onlineEnded) return;
    this.onlineEnded = true;
    const store = useGameStore.getState();
    const wasInMatch = store.online.status === 'inMatch';
    this.session?.disconnect();
    this.session = null;
    this.netTick = 0;
    this.pendingOnlineStart = null;
    this.engine.toMenu();
    store.setOnline({ status: isError || !wasInMatch ? 'error' : 'ended', roomCode: null, error: message });
  }

  /** Tear down any active online session (used when restarting/leaving to the menu). */
  private leaveOnlineIfAny(): void {
    if (!this.session) return;
    this.onlineEnded = true;
    this.session.disconnect();
    this.session = null;
    this.netTick = 0;
    this.pendingOnlineStart = null;
    useGameStore.getState().setOnline({ status: 'offline', roomCode: null, error: null });
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
    for (const unsub of this.busUnsubs) unsub();
    this.storeUnsub?.();
    this.storeUnsub = null;
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
