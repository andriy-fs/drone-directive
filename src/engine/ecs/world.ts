import { World } from 'miniplex';
import type { Entity } from './entity';

/** The ECS world for a match. Entities are added/removed as the game runs. */
export type EcsWorld = World<Entity>;

export function createEcsWorld(): EcsWorld {
  return new World<Entity>();
}

/** Removes every entity (used when (re)starting a match or returning to menu). */
export function clearWorld(world: EcsWorld): void {
  world.clear();
}
