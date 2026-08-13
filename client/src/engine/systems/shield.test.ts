import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { EffectKind } from '../ecs/entity';
import { spawnBase, spawnProjectile, spawnRobot } from '../ecs/factory';
import type { BaseEntity } from '../ecs/archetypes';
import type { GameContext } from '../game/context';
import { applyDamage, combatSystem } from './combat';
import { regenSystem } from './regen';
import { canActivateShield, canRaiseShield, isShielded, raiseShield, shieldSystem } from './shield';
import { makeCtx } from './testkit';
import { visionSystem } from './vision';

const DT = gameConfig.fixedDt;
const DOME = gameConfig.bases.shield;
const CANNON = gameConfig.robots.weapons.cannon.damage;
const MISSILE = gameConfig.robots.weapons.missiles.damage;

/** Clear the generated terrain so a stray mountain can't absorb the test's shot. */
function openGround(ctx: GameContext): void {
  const { width, height } = gameConfig.grid;
  ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

/** Runs the shield system for `seconds` of fixed steps. */
function run(ctx: GameContext, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) shieldSystem(ctx, DT);
}

/** A player base with its dome already up. */
function domedBase(ctx: GameContext, owner: Owner = Owner.Player): BaseEntity {
  const base = spawnBase(ctx.world, owner, 4, 4);
  raiseShield(ctx, base);
  return base;
}

function effectKinds(ctx: GameContext): (EffectKind | undefined)[] {
  return ctx.world.with('explosion').entities.map((e) => e.effect?.kind);
}

describe('raiseShield — the one charge', () => {
  it('attaches a full dome and puts the base in the standing-domes query', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);

    expect(base.shield).toEqual({ hp: DOME.hp, left: DOME.duration });
    expect(base.shieldSpent).toBe(true);
    // The assertion that matters: the component is a query tag, so attaching it
    // by assignment instead of `world.addComponent` would leave this empty and
    // the dome would neither tick nor render.
    expect([...ctx.world.with('base', 'position', 'shield')]).toContain(base);
  });

  it('refuses a second dome once the charge is spent', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    base.shield!.hp = 10;

    expect(canRaiseShield(base)).toBe(false);
    expect(raiseShield(ctx, base)).toBe(false);
    expect(base.shield!.hp).toBe(10); // untouched, not topped back up
  });

  it('still refuses after the dome has ended — the charge does not come back', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);

    run(ctx, DOME.duration + 1);

    expect(base.shield).toBeUndefined();
    expect(base.shieldSpent).toBe(true);
    expect(raiseShield(ctx, base)).toBe(false);
  });

  it('refuses a dead base', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 4);
    base.hp = 0;

    expect(raiseShield(ctx, base)).toBe(false);
    expect(base.shield).toBeUndefined();
  });
});

describe('shield — absorption', () => {
  it('takes the hit instead of the base', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);

    applyDamage(base, CANNON, 'shooter');

    expect(base.hp).toBe(gameConfig.bases.maxHp);
    expect(base.shield!.hp).toBe(DOME.hp - CANNON);
  });

  it('leaves the base repairing: an absorbed hit is not a hit on the building', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    base.hp = 100;

    applyDamage(base, CANNON, 'shooter');

    expect(base.regenLock).toBeUndefined();
    regenSystem(ctx, 1);
    expect(base.hp).toBeCloseTo(100 + gameConfig.bases.regenPerSecond, 6);
  });

  it('spills the overkill through on the hit that breaks it, and that hit does stop repair', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    base.hp = 500;
    base.shield!.hp = 5;

    applyDamage(base, MISSILE, 'shooter');

    expect(base.hp).toBe(500 - (MISSILE - 5));
    expect(base.regenLock).toBeDefined();
    expect(isShielded(base)).toBe(false);

    shieldSystem(ctx, DT);
    expect(base.shield).toBeUndefined();
  });

  it('damage exactly equal to the remaining dome spills nothing', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    base.shield!.hp = CANNON;

    applyDamage(base, CANNON, 'shooter');

    expect(base.hp).toBe(gameConfig.bases.maxHp);
    expect(base.regenLock).toBeUndefined();
  });

  it('protects the building, not the robots standing under it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = domedBase(ctx, Owner.AI);
    // Under the dome (80) but clear of the footprint (48), so the roof cannot
    // eat the shot on the robot's behalf. The round is fired from outside the
    // shell and crosses it: aimed at the robot, not the base, it is not absorbed.
    const guard = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 70, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    spawnProjectile(
      ctx.world,
      Owner.Player,
      { x: guard.position!.x + 30, y: guard.position!.y },
      guard.position!,
      guard.id,
      CANNON,
      'shooter',
      WeaponType.Cannon,
    );

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(guard.hp).toBe(guard.maxHp! - CANNON);
    expect(base.shield!.hp).toBe(DOME.hp); // the dome never saw it
  });
});

describe('shieldSystem — the clock and the self-repair', () => {
  it('mends the dome, and keeps mending it right after a hit', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    base.shield!.hp = 500;

    run(ctx, 1);
    expect(base.shield!.hp).toBeCloseTo(500 + DOME.regenPerSecond, 6);

    // Unlike the base's own repair, no `regenDelay` — a dome that stopped
    // mending under fire would only work out of combat.
    applyDamage(base, CANNON, 'shooter');
    const afterHit = base.shield!.hp;
    run(ctx, 1);
    expect(base.shield!.hp).toBeCloseTo(afterHit + DOME.regenPerSecond, 6);
  });

  it('never mends past the dome cap', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);

    run(ctx, 2);

    expect(base.shield!.hp).toBe(DOME.hp);
  });

  it('advances the clock exactly once per tick', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    const steps = Math.round(DOME.duration / DT);

    for (let i = 0; i < steps - 1; i++) shieldSystem(ctx, DT);
    expect(base.shield).toBeDefined(); // one tick short: still standing

    shieldSystem(ctx, DT);
    expect(base.shield).toBeUndefined();
  });
});

describe('shieldSystem — the two endings', () => {
  it('powers down when the clock runs out, and the base is exposed again', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    const ended: { shattered: boolean }[] = [];
    ctx.bus.on('shieldEnded', (e) => ended.push({ shattered: e.shattered }));

    run(ctx, DOME.duration + DT);

    expect(base.shield).toBeUndefined();
    expect(ended).toEqual([{ shattered: false }]);
    expect(effectKinds(ctx)).toContain(EffectKind.ShieldExpire);

    applyDamage(base, CANNON, 'shooter');
    expect(base.hp).toBe(gameConfig.bases.maxHp - CANNON);
  });

  it('shatters when beaten to zero', () => {
    const ctx = makeCtx(1);
    const base = domedBase(ctx);
    const ended: { shattered: boolean }[] = [];
    ctx.bus.on('shieldEnded', (e) => ended.push({ shattered: e.shattered }));

    applyDamage(base, DOME.hp, 'shooter');
    shieldSystem(ctx, DT);

    expect(base.shield).toBeUndefined();
    expect(ended).toEqual([{ shattered: true }]);
    expect(effectKinds(ctx)).toContain(EffectKind.ShieldBreak);
  });

  it('marks the two endings with different effects — the player must be able to tell them apart', () => {
    const shattered = makeCtx(1);
    const expired = makeCtx(1);
    const beaten = domedBase(shattered);
    domedBase(expired);

    applyDamage(beaten, DOME.hp, 'shooter');
    shieldSystem(shattered, DT);
    run(expired, DOME.duration + DT);

    expect(effectKinds(shattered)).toContain(EffectKind.ShieldBreak);
    expect(effectKinds(expired)).toContain(EffectKind.ShieldExpire);
    expect(effectKinds(shattered)).not.toEqual(effectKinds(expired));
  });
});

describe('canActivateShield — the HUD gate', () => {
  it('is dark with nobody around, and dark for an enemy out of detection range', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 4, 4);
    visionSystem(ctx);
    expect(canActivateShield(ctx, base)).toBe(false);

    const far = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + gameConfig.bases.sightRange + 100, y: base.position!.y },
      ChassisType.Wheels,
      WeaponType.Cannon,
    );
    visionSystem(ctx);
    expect(canActivateShield(ctx, base)).toBe(false);

    far.position!.x = base.position!.x + 150;
    visionSystem(ctx);
    expect(canActivateShield(ctx, base)).toBe(true);
  });

  it('reads intel, not the world: an undetected enemy at the door leaves it dark', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 4, 4);
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 150, y: base.position!.y },
      ChassisType.Wheels,
      WeaponType.Cannon,
    );

    // No `visionSystem` run: the robot exists, but this side has not spotted it.
    expect(ctx.intel[Owner.Player].visibleRobotIds.size).toBe(0);
    expect(canActivateShield(ctx, base)).toBe(false);
  });

  it('goes dark once the charge is spent, however close the enemy is', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = domedBase(ctx);
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 150, y: base.position!.y },
      ChassisType.Wheels,
      WeaponType.Cannon,
    );
    visionSystem(ctx);

    expect(canActivateShield(ctx, base)).toBe(false);
  });
});
