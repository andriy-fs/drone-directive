import { gameConfig } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { ChassisType, Controller, Difficulty, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnDrone, spawnRobot } from '../../ecs/factory';
import { isAlive } from '../../ecs/guards';
import { bases } from '../../ecs/queries';
import { clearWorld } from '../../ecs/world';
import { resetIds } from '../../../utils/id';
import { aiSystem } from '../../systems/ai';
import { combatSystem } from '../../systems/combat';
import { commandsSystem } from '../../systems/commands';
import { droneSystem } from '../../systems/drone';
import { droneRespawnSystem } from '../../systems/droneRespawn';
import { economySystem } from '../../systems/economy';
import { explosionSystem } from '../../systems/explosion';
import { fogSystem } from '../../systems/fog';
import { movementSystem } from '../../systems/movement';
import { munitionSystem } from '../../systems/munition';
import { refreshNavObstacles } from '../../navGrid';
import { productionSystem } from '../../systems/production';
import { reapSystem } from '../../systems/reap';
import { regenSystem } from '../../systems/regen';
import { separationSystem } from '../../systems/separation';
import { shieldSystem } from '../../systems/shield';
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
  /** Sides already announced as knocked out, so `sideEliminated` fires once each. */
  private readonly eliminated = new Set<Owner>();
  private readonly ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  enter(): void {
    const { world } = this.ctx;
    clearWorld(world);
    // Restart entity ids from 0 so both networked peers assign identical ids.
    resetIds();

    for (const p of gameConfig.bases.placements) spawnBase(world, p.owner, p.tx, p.ty);

    // Online matches ignore the asymmetric Easy/Hard presets (those only make sense
    // against the bots) and give both human sides the symmetric Normal player count.
    const counts = gameConfig.difficulty[this.ctx.online ? Difficulty.Normal : this.ctx.difficulty];
    for (const side of this.ctx.roster) {
      const isBot = side.controller === Controller.Bot;
      spawnStarters(this.ctx, side.owner, isBot ? counts.ai : counts.player);
    }

    // Bases are impassable: stamp their footprints into the pathfinding grid.
    refreshNavObstacles(this.ctx);

    // Apply pre-game base setup to the player base. Skipped online: both peers must
    // build an identical world, and each client only knows its own local settings —
    // online players configure their base in-match via the (networked) command queue.
    const playerBase = bases(world).entities.find((e) => e.owner === Owner.Player);
    if (!this.ctx.online && playerBase) {
      playerBase.production.autoBuild = this.ctx.settings.base.autoBuild;
      playerBase.production.defaultTask = this.ctx.settings.base.defaultProgram;
    }

    // Every side gets an observer drone — a human pilots theirs by hand (online,
    // through the lockstep channel), a bot flies its own from `systems/aiDrone.ts`.
    // The drone is the same entity either way; only who writes its `DroneControl`
    // differs, which is what keeps the eye a symmetric advantage.
    for (const side of this.ctx.roster) {
      const base = bases(world).entities.find((b) => b.owner === side.owner);
      if (base) spawnDrone(world, side.owner, base.position);
    }

    this.ctx.bus.emit('sceneChanged', { scene: 'game' });
  }

  update(dt: number): void {
    if (this.over) return;
    const ctx = this.ctx;

    commandsSystem(ctx);
    economySystem(ctx, dt);
    // Bot sides come from the roster, so this is a no-op in a pure 1v1 online
    // match. Bots run inside the deterministic pipeline on *every* peer — they
    // read only the world, the shared rng and their own state, so no bot input
    // ever crosses the wire.
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
    // Straight after combat: anti-air fire that connected this tick has already
    // taken the hp off, so a strike drone shot down on approach is removed before
    // it can cover its last few pixels and land its damage anyway.
    munitionSystem(ctx, dt);
    // Between combat and reap, deliberately: combat has already handed this
    // tick's damage to the domes, so one beaten to zero shatters on the very
    // tick it was broken — and doing it *before* reap means a base finished off
    // by the spill-through still shows its dome coming apart, instead of the
    // whole thing vanishing silently with the entity.
    shieldSystem(ctx, dt);
    reapSystem(ctx);
    // Also after reap: everything at hp<=0 has already been removed, so passive
    // repair can never pull something back from the dead before reap sees it.
    regenSystem(ctx, dt);
    // After reap: a drone shot down this tick is already gone, so the respawn
    // clock sees the side is missing its eye on the very tick it lost it.
    droneRespawnSystem(ctx, dt);
    explosionSystem(ctx, dt);
    // Fog last: reveal from settled positions this tick.
    fogSystem(ctx);

    this.checkGameOver();
  }

  exit(): void {
    /* nothing */
  }

  /**
   * Free-for-all: a side is out once its base falls, and the match ends when at
   * most one is left standing. Elimination is announced per side (`sideEliminated`)
   * so the UI can call a defeat the moment the local player is knocked out —
   * the simulation deliberately keeps running until a winner exists, because
   * stopping early on one peer would desync a networked match.
   */
  private checkGameOver(): void {
    const standing = bases(this.ctx.world).entities;
    const alive: Owner[] = [];
    for (const side of this.ctx.roster) {
      if (standing.some((b) => b.owner === side.owner && isAlive(b))) alive.push(side.owner);
      else if (!this.eliminated.has(side.owner)) {
        this.eliminated.add(side.owner);
        this.ctx.bus.emit('sideEliminated', { owner: side.owner });
      }
    }
    if (alive.length > 1) return;

    this.over = true;
    // No survivor at all (simultaneous last kills) → nobody wins.
    this.ctx.bus.emit('gameOver', { winner: alive[0] ?? null });
  }
}

/** Places `count` starter robots just outside a base, toward the field. */
function spawnStarters(ctx: GameContext, owner: Owner, count: number): void {
  const fp = gameConfig.bases.footprintTiles;
  const placement = gameConfig.bases.placements.find((p) => p.owner === owner) ?? gameConfig.bases.placements[0];
  const bcx = placement.tx + Math.floor(fp / 2);
  const bcy = placement.ty + Math.floor(fp / 2);
  const { tilePx } = gameConfig.grid;
  // Line them up on the inward side of the base — the enemy corner varies per
  // match, so this is derived rather than passed in.
  const dirX = bcx < gameConfig.grid.width / 2 ? 1 : -1;

  for (let i = 0; i < count; i++) {
    const tx = bcx + dirX * (2 + i);
    const ty = bcy + (i % 2 === 0 ? 0 : 1);
    const pos: Vec2 = { x: (tx + 0.5) * tilePx, y: (ty + 0.5) * tilePx };
    const spec = STARTER_SPECS[i % STARTER_SPECS.length];
    spawnRobot(ctx.world, owner, pos, spec.chassis, spec.weapon);
  }
}
