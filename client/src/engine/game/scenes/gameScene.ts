import { gameConfig } from '../../../config/gameConfig';
import type { Vec2 } from '../../../types/entities';
import { ChassisType, Owner, WeaponType } from '../../../types/enums';
import { spawnBase, spawnDrone, spawnRobot } from '../../ecs/factory';
import { clearWorld } from '../../ecs/world';
import { aiSystem } from '../../systems/ai';
import { combatSystem } from '../../systems/combat';
import { commandsSystem } from '../../systems/commands';
import { droneSystem } from '../../systems/drone';
import { economySystem } from '../../systems/economy';
import { explosionSystem } from '../../systems/explosion';
import { fogSystem } from '../../systems/fog';
import { movementSystem } from '../../systems/movement';
import { refreshNavObstacles } from '../../navGrid';
import { productionSystem } from '../../systems/production';
import { reapSystem } from '../../systems/reap';
import { separationSystem } from '../../systems/separation';
import { taskSystem } from '../../systems/task';
import { visionSystem } from '../../systems/vision';
import type { GameContext } from '../context';
import type { Scene } from '../scene';

const STARTER_SPECS: { chassis: ChassisType; weapon: WeaponType }[] = [
  { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
  { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles },
  { chassis: ChassisType.Legs, weapon: WeaponType.Cannon },
  { chassis: ChassisType.Tracks, weapon: WeaponType.Missiles },
];

/** The live match: builds the world on enter, runs the system pipeline each tick. */
export class GameScene implements Scene {
  readonly name = 'game';
  private over = false;
  private readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  enter(): void {
    const { world } = this.ctx;
    clearWorld(world);

    for (const p of gameConfig.bases.placements) spawnBase(world, p.owner, p.tx, p.ty);

    const counts = gameConfig.difficulty[this.ctx.difficulty];
    spawnStarters(this.ctx, Owner.Player, counts.player, 1);
    spawnStarters(this.ctx, Owner.AI, counts.ai, -1);

    // Bases are impassable: stamp their footprints into the pathfinding grid.
    refreshNavObstacles(this.ctx);

    // Apply pre-game base setup to the player base.
    const playerBase = world
      .with('base', 'production')
      .entities.find((e) => e.owner === Owner.Player);
    if (playerBase?.production) {
      playerBase.production.autoBuild = this.ctx.settings.base.autoBuild;
      playerBase.production.defaultTask = this.ctx.settings.base.defaultProgram;
    }

    // The observer drone starts docked on the player base "roof" (its centre).
    if (playerBase?.position) spawnDrone(world, Owner.Player, playerBase.position);

    this.ctx.bus.emit('sceneChanged', { scene: 'game' });
  }

  update(dt: number): void {
    if (this.over) return;
    const ctx = this.ctx;

    commandsSystem(ctx);
    economySystem(ctx, dt);
    aiSystem(ctx, dt);
    productionSystem(ctx, dt);
    visionSystem(ctx);
    taskSystem(ctx, dt);
    // After task: the drone overrides a possessed robot's target/steering so its
    // fire stays manual and it flies free of the pathfinder.
    droneSystem(ctx, dt);
    movementSystem(ctx, dt);
    separationSystem(ctx);
    combatSystem(ctx, dt);
    reapSystem(ctx);
    explosionSystem(ctx, dt);
    // Fog last: reveal from settled positions this tick.
    fogSystem(ctx);

    this.checkGameOver();
  }

  exit(): void {
    /* nothing */
  }

  private checkGameOver(): void {
    const bases = this.ctx.world.with('base').entities;
    const aiAlive = bases.some((b) => b.owner === Owner.AI && (b.hp ?? 0) > 0);
    const playerAlive = bases.some((b) => b.owner === Owner.Player && (b.hp ?? 0) > 0);
    if (aiAlive && playerAlive) return;

    this.over = true;
    const winner = !aiAlive ? Owner.Player : Owner.AI;
    this.ctx.bus.emit('gameOver', { winner });
  }
}

/** Places `count` starter robots just outside a base, toward the field. */
function spawnStarters(ctx: GameContext, owner: Owner, count: number, dirX: number): void {
  const fp = gameConfig.bases.footprintTiles;
  const placement =
    gameConfig.bases.placements.find((p) => p.owner === owner) ?? gameConfig.bases.placements[0];
  const bcx = placement.tx + Math.floor(fp / 2);
  const bcy = placement.ty + Math.floor(fp / 2);
  const { tilePx } = gameConfig.grid;

  for (let i = 0; i < count; i++) {
    const tx = bcx + dirX * (2 + i);
    const ty = bcy + (i % 2 === 0 ? 0 : 1);
    const pos: Vec2 = { x: (tx + 0.5) * tilePx, y: (ty + 0.5) * tilePx };
    const spec = STARTER_SPECS[i % STARTER_SPECS.length];
    spawnRobot(ctx.world, owner, pos, spec.chassis, spec.weapon);
  }
}
