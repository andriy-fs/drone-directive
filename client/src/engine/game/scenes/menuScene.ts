import { clearWorld, type EcsWorld } from '../../ecs/world';
import type { GameBus } from '../eventBus';
import type { Scene } from '../scene';

/** Title screen: no simulation. Clears the world so nothing renders behind menus. */
export class MenuScene implements Scene {
  readonly name = 'menu';
  private readonly world: EcsWorld;
  private readonly bus: GameBus;

  constructor(world: EcsWorld, bus: GameBus) {
    this.world = world;
    this.bus = bus;
  }

  enter(): void {
    clearWorld(this.world);
    this.bus.emit('sceneChanged', { scene: 'menu' });
  }

  update(): void {
    /* idle */
  }

  exit(): void {
    /* nothing */
  }
}
