import { Application, Container } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';
import { palette } from '../config/palette';
import type { Entity } from '../engine/ecs/entity';
import { GameEngine } from '../engine/game/engine';
import { isCommandFrom } from '../engine/systems/commands';
import { useGameStore, type BaseSnapshot, type GameState, type PendingOnline, type RobotSnapshot } from '../store/gameStore';
import type { Command } from '../types/commands';
import { Owner, TaskType, WeaponType, type MapSize } from '../types/enums';
import type { DroneControl } from '../engine/game/context';
import { loadGameAssets } from './assets';
import { randomRoomCode } from './net/config';
import { LockstepSession, type TickInput } from './net/LockstepSession';
import { sfx } from './audio/sfx';
import { Camera } from './Camera';
import { GameLoop } from './GameLoop';
import { createGrid, createGround } from './Grid';
import { createLayers, type Layers } from './layers';
import { attachPointerControls } from './input/pointer';
import { FogView } from './render/FogView';
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
  private obstacleGfx: Container | null = null;
  private loop!: GameLoop;
  private detachPointer: (() => void) | null = null;
  private readonly busUnsubs: (() => void)[] = [];
  private destroyed = false;
  private snapshotTick = 0;
  /** Networked-match state (null when solo). */
  private session: LockstepSession | null = null;
  private netTick = 0;
  private pendingOnlineStart: { seed: number; mapSize: MapSize } | null = null;
  private onlineEnded = false;
  private readonly onResize = (width: number, height: number) => this.camera.setViewport(width, height);

  /** The side this client plays/views (Player offline & host; AI for the online guest). */
  private get localSide(): Owner {
    return useGameStore.getState().localSide;
  }

  constructor() {
    this.app = new Application();
  }

  async init(host: HTMLElement): Promise<void> {
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
    this.layers.ground.addChild(createGround(), createGrid());
    this.fogView = new FogView();
    this.layers.fog.addChild(this.fogView.container);
    this.camera = new Camera(this.layers.root);
    this.app.stage.addChild(this.camera.view);
    this.camera.setViewport(this.app.screen.width, this.app.screen.height);

    this.engine = new GameEngine();
    this.worldRenderer = new WorldRenderer(this.layers, this.engine.world);
    this.wireBus();

    this.detachPointer = attachPointerControls(this.app, this.camera, this.engine);
    this.app.renderer.on('resize', this.onResize);

    this.loop = new GameLoop(
      (dt) => this.step(dt),
      () => this.render(),
    );
    this.loop.start(this.app.ticker);
  }

  /** Render pass: follow the drone with the camera, sync views, redraw fog. */
  private render(): void {
    this.followDrone();
    this.worldRenderer.sync(new Set(useGameStore.getState().selectedRobotIds), (e) => this.isVisibleToLocalSide(e));
    this.fogView?.update(this.engine.context?.fog);
  }

  /** Keep the viewport centred on the local side's observer drone (this player's eye). */
  private followDrone(): void {
    const drones = this.engine.world.with('drone', 'position').entities;
    const drone = drones.find((d) => d.owner === this.localSide) ?? drones[0];
    if (drone?.position) this.camera.centerOn(drone.position.x, drone.position.y);
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
    this.busUnsubs.push(bus.on('entitySpawned', () => this.pushSnapshot()));
    this.busUnsubs.push(bus.on('entityDestroyed', () => this.pushSnapshot()));
    this.busUnsubs.push(
      bus.on('sceneChanged', ({ scene }) => {
        store().clearSelection();
        store().setBuildDialogOpen(false); // never carry an open dialog across matches
        if (scene === 'menu') {
          store().setStatus('menu');
          this.clearObstacles();
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
      bus.on('gameOver', ({ winner }) => {
        store().setStatus(winner === store().localSide ? 'won' : 'lost');
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
      this.beginOnlineMatch(start.seed, start.mapSize);
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

    const side = store.localSide;
    const { local, peer } = session.take(this.netTick);
    // Every command applies by entity id on both peers (no relabeling) — that keeps
    // the shared world identical; only presentation differs by `localSide`. Each
    // batch is screened against the side that sent it, so neither client can order
    // the other's units (see isCommandFrom). Both peers screen the same batches
    // against the same pre-tick world, so the filter stays deterministic.
    this.enqueueFrom(side, local.commands);
    this.enqueueFrom(otherSide(side), peer.commands);
    this.engine.setDroneControl(side, local.drone);
    this.engine.setDroneControl(otherSide(side), peer.drone);
    this.engine.tick(dt);

    // Sample fresh local input and schedule it INPUT_DELAY ticks ahead (heartbeat even if empty).
    session.scheduleLocal(this.netTick + session.inputDelay, this.captureLocalInput(store));
    this.netTick += 1;
    this.snapshotAfterTick();
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

  /** Act on a lobby request: open a host/guest session, or leave an active one. */
  private applyOnlineRequest(req: PendingOnline): void {
    if (req.kind === 'leave') {
      this.leaveOnlineIfAny();
      this.engine.toMenu();
      return;
    }
    this.session?.disconnect();
    this.onlineEnded = false;
    this.session = new LockstepSession({
      onCreated: (roomCode) => useGameStore.getState().setOnline({ status: 'hosting', roomCode }),
      onStart: (seed, mapSize) => {
        this.pendingOnlineStart = { seed, mapSize };
      },
      onOpponentLeft: () => this.endOnline('Opponent left the match'),
      onError: (_code, message) => this.endOnline(message, true),
      onClose: () => this.endOnline('Connection closed'),
    });
    if (req.kind === 'host') this.session.connectHost(randomRoomCode(), req.mapSize);
    else this.session.connectGuest(req.roomCode);
  }

  /** Start the shared simulation from the relay's seed + map size. */
  private beginOnlineMatch(seed: number, mapSize: MapSize): void {
    const store = useGameStore.getState();
    store.updateSettings({ match: { mapSize, online: true } });
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

  /** Fog of war: the local side's own units are always visible; the enemy's only once detected. */
  private isVisibleToLocalSide(e: Entity): boolean {
    const side = this.localSide;
    if (e.owner !== otherSide(side)) return true;
    const intel = side === Owner.Player ? this.engine.context?.intel.player : this.engine.context?.intel.ai;
    if (!intel) return true;
    if (e.robot) return intel.visibleRobotIds.has(e.id);
    if (e.base) return intel.knownBaseIds.has(e.id);
    return true;
  }

  /** Projects HUD-facing state from the ECS world into the store. */
  private pushSnapshot(): void {
    const store = useGameStore.getState();
    const world = this.engine.world;
    store.setBases(world.with('base').entities.map(toBaseSnapshot));
    store.setRobots(world.with('robot').entities.map(toRobotSnapshot));
    const ctx = this.engine.context;
    if (ctx) {
      store.setResources({ ...ctx.resources });
      const drones = world.with('drone').entities;
      const drone = drones.find((d) => d.owner === store.localSide) ?? drones[0];
      const possessedRobotId = drone?.drone?.possessedId ?? null;
      store.setDroneStatus({
        mode: possessedRobotId ? 'possessing' : 'flying',
        possessedRobotId,
      });
    }
  }

  /** Ground fill + grid lines are sized off `worldPixelSize`/`gameConfig.grid` — rebuild per match. */
  private rebuildGround(): void {
    for (const child of this.layers.ground.removeChildren()) child.destroy({ children: true });
    this.layers.ground.addChild(createGround(), createGrid());
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
    this.obstacleGfx = createObstaclesGraphic(ctx.obstacles);
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
    for (const unsub of this.busUnsubs) unsub();
    this.detachPointer?.();
    this.detachPointer = null;
    this.clearObstacles();
    this.app.renderer?.off('resize', this.onResize);
    this.app.destroy({ removeView: true }, { children: true });
  }
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
  };
}

function otherSide(side: Owner): Owner {
  return side === Owner.Player ? Owner.AI : Owner.Player;
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
