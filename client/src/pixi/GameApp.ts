import { Application, Container } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';
import { palette } from '../config/palette';
import type { Entity } from '../engine/ecs/entity';
import { GameEngine } from '../engine/game/engine';
import { playerAutoBuildSuppressed } from '../engine/systems/production';
import { useGameStore, type BaseSnapshot, type RobotSnapshot } from '../store/gameStore';
import { Owner, TaskType, WeaponType } from '../types/enums';
import { loadGameAssets } from './assets';
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
  private readonly onResize = (width: number, height: number) => this.camera.setViewport(width, height);

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
    this.worldRenderer.sync(new Set(useGameStore.getState().selectedRobotIds), (e) => this.isVisibleToPlayer(e));
    this.fogView?.update(this.engine.context?.fog);
  }

  /** Keep the viewport centred on the observer drone (the player's eye). */
  private followDrone(): void {
    const drone = this.engine.world.with('drone', 'position').entities[0];
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
        store().setStatus(winner === Owner.Player ? 'won' : 'lost');
        this.pushSnapshot();
      }),
    );
  }

  /** One fixed step: apply control flags, forward commands, advance, snapshot. */
  private step(dt: number): void {
    const store = useGameStore.getState();

    if (store.restartRequested || store.menuRequested) {
      const toMenu = store.menuRequested;
      store.clearRequests();
      if (toMenu) this.engine.toMenu();
      else this.engine.startMatch(store.settings);
      return;
    }

    this.engine.setPaused(store.paused);
    for (const command of store.drainCommands()) this.engine.enqueueCommand(command);
    this.engine.setDroneControl({
      dir: store.droneInput,
      possessPulse: store.dronePossessRequested,
      firePulse: store.droneFireRequested,
    });
    store.clearDroneRequests();
    this.engine.tick(dt);

    this.snapshotTick += 1;
    if (this.snapshotTick >= gameConfig.hud.snapshotEveryTicks) {
      this.snapshotTick = 0;
      this.pushSnapshot();
    }
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
      const drone = world.with('drone').entities[0];
      const possessedRobotId = drone?.drone?.possessedId ?? null;
      store.setDroneStatus({
        mode: possessedRobotId ? 'possessing' : 'flying',
        possessedRobotId,
        autoBuildSuppressed: playerAutoBuildSuppressed(ctx),
      });
    }
  }

  /** Fog of war: the player's own units are always visible; AI units/bases only once detected. */
  private isVisibleToPlayer(e: Entity): boolean {
    if (e.owner !== Owner.AI) return true;
    const intel = this.engine.context?.intel.player;
    if (!intel) return true;
    if (e.robot) return intel.visibleRobotIds.has(e.id);
    if (e.base) return intel.knownBaseIds.has(e.id);
    return true;
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
