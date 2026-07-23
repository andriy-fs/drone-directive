import type { Container } from 'pixi.js';
import type { Query } from 'miniplex';
import type { Entity } from '../../engine/ecs/entity';
import type { EcsWorld } from '../../engine/ecs/world';
import type { Layers } from '../layers';
import { BaseView } from './BaseView';
import { DroneView } from './DroneView';
import { ExplosionView } from './ExplosionView';
import { ProjectileView } from './ProjectileView';
import { RobotView } from './RobotView';

interface View {
  container: Container;
  destroy(): void;
}

/**
 * Bridges the ECS world to the Pixi scene graph. View lifecycle is driven by
 * miniplex reactive queries (`onEntityAdded` / `onEntityRemoved`); a per-frame
 * `sync()` updates transforms/HP/selection from the live components.
 */
export class WorldRenderer {
  private readonly bases: Query<Entity>;
  private readonly robots: Query<Entity>;
  private readonly projectiles: Query<Entity>;
  private readonly explosions: Query<Entity>;
  private readonly drones: Query<Entity>;

  private readonly baseViews = new Map<string, BaseView>();
  private readonly robotViews = new Map<string, RobotView>();
  private readonly projectileViews = new Map<string, ProjectileView>();
  private readonly explosionViews = new Map<string, ExplosionView>();
  private readonly droneViews = new Map<string, DroneView>();
  private readonly unsubs: (() => void)[] = [];

  constructor(layers: Layers, world: EcsWorld) {
    // miniplex narrows query types to `With<Entity, ...>`; we treat them as
    // Query<Entity> (all components are optional on Entity, so it's safe to read).
    this.bases = world.with('base', 'position') as unknown as Query<Entity>;
    this.robots = world.with('robot', 'position') as unknown as Query<Entity>;
    this.projectiles = world.with('projectile', 'position') as unknown as Query<Entity>;
    this.explosions = world.with('explosion', 'position') as unknown as Query<Entity>;
    this.drones = world.with('drone', 'position') as unknown as Query<Entity>;

    this.bind(this.bases, this.baseViews, (e) => new BaseView(e), layers.units);
    this.bind(this.robots, this.robotViews, (e) => new RobotView(e), layers.units);
    this.bind(this.projectiles, this.projectileViews, (e) => new ProjectileView(e), layers.projectiles);
    this.bind(this.explosions, this.explosionViews, (e) => new ExplosionView(e), layers.fx);
    this.bind(this.drones, this.droneViews, (e) => new DroneView(e), layers.overlay);
  }

  /**
   * Per-frame transform/HP/selection update. `isVisible` gates robot/base
   * views for fog of war — an enemy view stays created (so it snaps back
   * instantly once known again) but is hidden while not detected.
   */
  sync(selectedIds: Set<string>, isVisible: (e: Entity) => boolean): void {
    for (const e of this.robots) this.robotViews.get(e.id)?.update(e, selectedIds.has(e.id), isVisible(e));
    for (const e of this.bases) this.baseViews.get(e.id)?.update(e, isVisible(e));
    for (const e of this.projectiles) this.projectileViews.get(e.id)?.update(e);
    for (const e of this.explosions) this.explosionViews.get(e.id)?.update(e);
    for (const e of this.drones) this.droneViews.get(e.id)?.update(e);
  }

  private bind<V extends View>(
    query: Query<Entity>,
    map: Map<string, V>,
    create: (e: Entity) => V,
    layer: Container,
  ): void {
    const add = (e: Entity) => {
      if (map.has(e.id)) return;
      const view = create(e);
      map.set(e.id, view);
      layer.addChild(view.container);
    };
    const remove = (e: Entity) => {
      const view = map.get(e.id);
      if (view) {
        view.destroy();
        map.delete(e.id);
      }
    };
    for (const e of query) add(e); // seed any pre-existing entities
    this.unsubs.push(query.onEntityAdded.subscribe(add));
    this.unsubs.push(query.onEntityRemoved.subscribe(remove));
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    for (const v of this.baseViews.values()) v.destroy();
    for (const v of this.robotViews.values()) v.destroy();
    for (const v of this.projectileViews.values()) v.destroy();
    for (const v of this.explosionViews.values()) v.destroy();
    for (const v of this.droneViews.values()) v.destroy();
    this.baseViews.clear();
    this.robotViews.clear();
    this.projectileViews.clear();
    this.explosionViews.clear();
    this.droneViews.clear();
  }
}
