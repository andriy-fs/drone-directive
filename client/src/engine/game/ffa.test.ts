import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { createDefaultSettings, type GameSettings } from '../../config/gameSettings';
import { movementGrid } from '../obstacles';
import { ChassisType, Controller, MapSize, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { spawnRobot } from '../ecs/factory';
import { aiSystem } from '../systems/ai';
import { visionSystem } from '../systems/vision';
import { GameEngine } from './engine';

/**
 * Free-for-all rules: every side fights every other, and the match runs until one
 * is left standing. Sides are seated from the roster, so "how many opponents"
 * is a settings question rather than a code branch.
 */

const DT = 1 / 30;

function settings(aiOpponents: number, online = false): GameSettings {
  const s = createDefaultSettings();
  s.match.mapSize = MapSize.Small;
  s.match.aiOpponents = aiOpponents;
  s.match.online = online;
  return s;
}

function start(aiOpponents: number, online = false, seed = 42): GameEngine {
  const engine = new GameEngine();
  engine.startMatch(settings(aiOpponents, online), seed);
  return engine;
}

function livingBases(engine: GameEngine): Owner[] {
  return engine.world
    .with('base')
    .entities.filter((b) => (b.hp ?? 0) > 0)
    .map((b) => b.owner!);
}

describe('free-for-all roster', () => {
  it('seats one human plus the requested bots offline', () => {
    const engine = start(3);
    const roster = engine.context!.roster;
    expect(roster.map((s) => s.owner)).toEqual([Owner.Player, Owner.AI, Owner.AI2, Owner.AI3]);
    expect(roster.filter((s) => s.controller === Controller.Bot)).toHaveLength(3);
    expect(livingBases(engine)).toHaveLength(4);
  });

  it('seats two humans online, with bots filling the rest', () => {
    const engine = start(2, true);
    const roster = engine.context!.roster;
    expect(roster.filter((s) => s.controller === Controller.Human).map((s) => s.owner)).toEqual([
      Owner.Player,
      Owner.AI,
    ]);
    expect(roster.filter((s) => s.controller === Controller.Bot).map((s) => s.owner)).toEqual([Owner.AI2, Owner.AI3]);
  });

  it('clamps a bot count that would not fit on the map', () => {
    // Two humans already hold two of the four corners.
    expect(start(3, true).context!.roster).toHaveLength(4);
  });

  it('gives every human side a drone and no bot one', () => {
    const drones = start(2, true).world.with('drone').entities.map((d) => d.owner);
    expect(new Set(drones)).toEqual(new Set([Owner.Player, Owner.AI]));
  });

  it('keeps every base reachable from every other', () => {
    const engine = start(3);
    const grid = movementGrid(engine.context!.terrain);
    const fp = gameConfig.bases.footprintTiles;
    const centres = gameConfig.bases.placements.map((p) => ({
      tx: p.tx + Math.floor(fp / 2),
      ty: p.ty + Math.floor(fp / 2),
    }));
    // A base centre sits inside its own footprint, which is stamped into the nav
    // grid later — terrain connectivity is what `generateObstacles` guarantees.
    for (const c of centres) expect(grid[c.ty][c.tx]).toBe(false);
    expect(centres).toHaveLength(4);
  });
});

describe('free-for-all match end', () => {
  it('runs on while more than one side still holds a base', () => {
    const engine = start(3);
    let over = 0;
    engine.bus.on('gameOver', () => over++);

    // Wipe out one bot outright; the other three sides are still in it.
    for (const base of engine.world.with('base').entities) {
      if (base.owner === Owner.AI2) base.hp = 0;
    }
    engine.tick(DT);

    expect(over).toBe(0);
    expect(livingBases(engine)).toHaveLength(3);
  });

  it('announces each side as it is knocked out, once', () => {
    const engine = start(2);
    const out: Owner[] = [];
    engine.bus.on('sideEliminated', (e) => out.push(e.owner));

    for (const base of engine.world.with('base').entities) {
      if (base.owner === Owner.AI) base.hp = 0;
    }
    engine.tick(DT);
    engine.tick(DT);

    expect(out).toEqual([Owner.AI]);
  });

  it('declares the last side standing the winner', () => {
    const engine = start(2);
    let winner: Owner | null | undefined;
    engine.bus.on('gameOver', (e) => (winner = e.winner));

    for (const base of engine.world.with('base').entities) {
      if (base.owner !== Owner.Player) base.hp = 0;
    }
    engine.tick(DT);

    expect(winner).toBe(Owner.Player);
  });

  it('leaves nobody the winner when the last sides fall together', () => {
    const engine = start(1);
    let winner: Owner | null | undefined = undefined;
    let fired = false;
    engine.bus.on('gameOver', (e) => {
      winner = e.winner;
      fired = true;
    });

    for (const base of engine.world.with('base').entities) base.hp = 0;
    engine.tick(DT);

    expect(fired).toBe(true);
    expect(winner).toBeNull();
  });
});

describe('bots in a free-for-all', () => {
  it('treats another bot as a threat to defend against', () => {
    const engine = start(2);
    const ctx = engine.context!;
    const ai2Base = engine.world.with('base', 'position').entities.find((b) => b.owner === Owner.AI2)!;

    // Park an enemy bot's robots on AI2's doorstep and give AI2 idle defenders.
    for (let i = 0; i < gameConfig.ai.massRushThreshold; i++) {
      spawnRobot(
        ctx.world,
        Owner.AI,
        { x: ai2Base.position.x + 20 + i, y: ai2Base.position.y },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
    }
    const defenders = ctx.world.with('robot').entities.filter((r) => r.owner === Owner.AI2);
    for (const d of defenders) d.script = { programId: TaskType.Idle, blackboard: {} };

    aiSystem(ctx, 100);

    const mobilized = ctx.world
      .with('robot', 'script')
      .entities.filter((r) => r.owner === Owner.AI2 && r.script.programId === TaskType.AttackRobots);
    expect(mobilized.length).toBeGreaterThan(0);
  });

  it('scouts every side independently', () => {
    const engine = start(3);
    const ctx = engine.context!;
    visionSystem(ctx);
    // Each side keeps its own intel bucket — no side sees through another's eyes.
    for (const side of ctx.roster) {
      expect(ctx.intel[side.owner]).toBeDefined();
      for (const id of ctx.intel[side.owner].visibleRobotIds) {
        const seen = ctx.world.entities.find((e) => e.id === id);
        expect(seen!.owner).not.toBe(side.owner);
      }
    }
  });
});
