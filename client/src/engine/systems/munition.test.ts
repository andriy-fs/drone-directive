import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnMunition, spawnRobot } from '../ecs/factory';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { munitionSystem } from './munition';
import { raiseShield } from './shield';
import { applyDisable } from '../status';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;
const { damage } = gameConfig.robots.weapons.fpv;

/** One strike drone, launched at `target` from `from` and aimed straight at it. */
function launch(ctx: GameContext, target: Entity, from = { x: 200, y: 200 }, carrierId = 'carrier'): Entity {
  return spawnMunition(ctx.world, Owner.Player, from, 0, target.id, damage, carrierId, WeaponType.Fpv);
}

/** Runs the system until the world holds no munitions, or `ticks` have passed. */
function flyOut(ctx: GameContext, ticks = 400): number {
  for (let i = 0; i < ticks; i++) {
    if (ctx.world.with('munition').entities.length === 0) return i;
    munitionSystem(ctx, DT);
  }
  return ticks;
}

describe('munitionSystem — reaching the target', () => {
  it('deals its damage once and is gone', () => {
    const ctx = makeCtx(1);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const hp = foe.hp!;
    launch(ctx, foe);

    flyOut(ctx);

    expect(hp - foe.hp!).toBe(damage);
    expect(ctx.world.with('munition').entities.length).toBe(0);
  });

  it('blames the launcher, not itself, so the victim has something to shoot back at', () => {
    const ctx = makeCtx(1);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Fpv);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    launch(ctx, foe, carrier.position!, carrier.id);

    flyOut(ctx);

    // The munition is destroyed on impact, so naming *it* would leave the victim
    // returning fire at nothing.
    expect(foe.threat?.attackerId).toBe(carrier.id);
    expect(ctx.world.entities.some((e) => e.id === carrier.id)).toBe(true);
  });

  it('flies over a mountain that would stop a shell', () => {
    const ctx = makeCtx(1);
    const { width, height } = gameConfig.grid;
    // Every tile blocked: terrain must not enter into it at all.
    ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(true));
    ctx.obstacles = ctx.sightBlockers;
    ctx.navObstacles = ctx.sightBlockers;
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const hp = foe.hp!;
    launch(ctx, foe);

    flyOut(ctx);

    expect(hp - foe.hp!).toBe(damage);
  });

  it('hits a base at its footprint edge, and goes through the dome first', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 20, 20);
    raiseShield(ctx, base);
    const domeHp = base.shield!.hp;
    const baseHp = base.hp!;
    launch(ctx, base, { x: base.position!.x - 400, y: base.position!.y });

    flyOut(ctx);

    expect(base.hp).toBe(baseHp); // the building itself was never touched
    expect(domeHp - base.shield!.hp).toBe(damage);
  });
});

describe('munitionSystem — the five ways it dies', () => {
  it('falls when its flight time runs out, dealing nothing', () => {
    const ctx = makeCtx(1);
    // Further than speed × flightTime (240 × 7 = 1680 px).
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 2400, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const hp = foe.hp!;
    launch(ctx, foe);

    const ticks = flyOut(ctx);

    expect(foe.hp).toBe(hp);
    // Gone on the tick its ttl expires, not a moment later — give or take the one
    // extra step that `7 - 210 × (1/30)` leaving a float residue above zero costs.
    const nominal = gameConfig.munition.flightTime / DT;
    expect(ticks).toBeGreaterThanOrEqual(nominal);
    expect(ticks).toBeLessThanOrEqual(nominal + 1);
  });

  it('falls inside an enemy jammer bubble without dealing damage', () => {
    const ctx = makeCtx(1);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 600, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnRobot(ctx.world, Owner.AI, { x: 400, y: 200 }, ChassisType.Wheels, WeaponType.Ew);
    const hp = foe.hp!;
    launch(ctx, foe);

    flyOut(ctx);

    expect(foe.hp).toBe(hp);
  });

  it('is untouched by its own side jammer', () => {
    const ctx = makeCtx(1);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 600, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnRobot(ctx.world, Owner.Player, { x: 400, y: 200 }, ChassisType.Wheels, WeaponType.Ew);
    const hp = foe.hp!;
    launch(ctx, foe);

    flyOut(ctx);

    expect(hp - foe.hp!).toBe(damage);
  });

  it('gets through a jammer whose electronics are knocked out', () => {
    const ctx = makeCtx(1);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 600, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const jammer = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 200 }, ChassisType.Wheels, WeaponType.Ew);
    applyDisable(jammer, 8);
    const hp = foe.hp!;
    launch(ctx, foe);

    flyOut(ctx);

    expect(hp - foe.hp!).toBe(damage);
  });

  it('falls when its target dies before it arrives — it never re-picks one', () => {
    const ctx = makeCtx(1);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 1200, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const bystander = spawnRobot(ctx.world, Owner.AI, { x: 260, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const bystanderHp = bystander.hp!;
    launch(ctx, foe);

    munitionSystem(ctx, DT);
    foe.hp = 0;
    flyOut(ctx);

    // Neither the dead target nor the perfectly good one it flew straight past.
    expect(bystander.hp).toBe(bystanderHp);
    expect(ctx.world.with('munition').entities.length).toBe(0);
  });

  it('is removed the tick anti-air zeroes its hp, before it can land its hit', () => {
    const ctx = makeCtx(1);
    // Close enough to reach the target on the very next step if it survived.
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 210, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const hp = foe.hp!;
    const m = launch(ctx, foe);
    m.hp = 0;

    munitionSystem(ctx, DT);

    expect(foe.hp).toBe(hp);
    expect(ctx.world.with('munition').entities.length).toBe(0);
  });
});
