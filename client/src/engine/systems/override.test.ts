import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, OverrideKind, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnDrone, spawnMunition, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import type { RobotEntity } from '../ecs/archetypes';
import { isDisabled } from '../status';
import { applyDamage } from './combat';
import { availableOverrides, overrideSystem, startOverride } from './override';
import { reapSystem } from './reap';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;
const { shield, overload } = gameConfig.drone.overrides;

/** A hull with this side's drone actually riding it — what `startOverride` insists on. */
function piloted(
  ctx: GameContext,
  // Annotated rather than inferred: the enum is `as const`, so the default alone
  // would narrow the parameter to the literal `'cannon'` — the same trap
  // `spawnExplosion`'s `duration` documents.
  weapon: WeaponType = WeaponType.Cannon,
  at: { x: number; y: number } = { x: 400, y: 400 },
  owner: Owner = Owner.Player,
): RobotEntity {
  const robot = spawnRobot(ctx.world, owner, at, ChassisType.Tracks, weapon);
  const drone = spawnDrone(ctx.world, owner, at);
  drone.drone.possessedId = robot.id;
  return robot;
}

/** Runs the mode out, one fixed step at a time, plus the tick it expires on. */
function runOut(ctx: GameContext, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / DT) + 1; i++) overrideSystem(ctx, DT);
}

describe('startOverride — the gate both peers recompute', () => {
  it('arms a mode on the hull this side is flying', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    expect(startOverride(ctx, hull, OverrideKind.Shield)).toBe(true);
    expect(hull.override!.kind).toBe(OverrideKind.Shield);
  });

  it('refuses a hull no drone of that side is riding', () => {
    // The line that stops a doctored client arming a mode on someone else's
    // machine: eligibility is read from the world, never taken from the frame.
    const ctx = makeCtx(1);
    const loose = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    expect(startOverride(ctx, loose, OverrideKind.Shield)).toBe(false);
    expect(loose.override).toBeUndefined();
  });

  it('refuses a second mode while one is already burning', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx, WeaponType.Ew);
    startOverride(ctx, hull, OverrideKind.Shield);
    expect(startOverride(ctx, hull, OverrideKind.Overload)).toBe(false);
    expect(hull.override!.kind).toBe(OverrideKind.Shield);
  });

  it('refuses `None` — it is the resting value of the pulse, not a mode', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    expect(startOverride(ctx, hull, OverrideKind.None)).toBe(false);
  });
});

describe('availableOverrides — what the menu may offer', () => {
  it('offers the shield to every hull', () => {
    const ctx = makeCtx(1);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);
    expect(availableOverrides(gun)).toEqual([OverrideKind.Shield]);
  });

  it('offers the overload only to a machine that carries the hardware for it', () => {
    // Duck-typed off the weapon, not off the enum: a jamming bubble or a
    // directed-energy emitter is what there is to dump into a pulse.
    const ctx = makeCtx(1);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);
    const jammer = spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Ew);
    const emitter = spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Dew);
    expect(availableOverrides(gun)).not.toContain(OverrideKind.Overload);
    expect(availableOverrides(jammer)).toContain(OverrideKind.Overload);
    expect(availableOverrides(emitter)).toContain(OverrideKind.Overload);
  });
});

describe('the shield is immunity, not armour', () => {
  it('takes no damage at all while it runs', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    startOverride(ctx, hull, OverrideKind.Shield);
    const before = hull.hp;
    applyDamage(hull, 500, 'someone');
    expect(hull.hp).toBe(before);
  });

  it('leaves no mark: nothing absorbed means no repair lock and no attacker', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    startOverride(ctx, hull, OverrideKind.Shield);
    applyDamage(hull, 500, 'someone');
    expect(hull.regenLock).toBeUndefined();
    expect(hull.threat.attackerId).toBeUndefined();
  });

  it('does not stop a `dew` hit knocking the hull out', () => {
    // The counter-play: a defender cannot cancel the run, only decide where it
    // ends. The countdown belongs to the machine, not to whether it can drive.
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    startOverride(ctx, hull, OverrideKind.Shield);
    hull.disabled = { left: gameConfig.robots.weapons.dew.freezeDuration };
    overrideSystem(ctx, DT);
    expect(isDisabled(hull)).toBe(true);
    expect(hull.override!.left).toBeCloseTo(shield.duration - DT, 6);
  });
});

describe('every mode ends by destroying the hull', () => {
  it('kills an ordinary hull when the clock runs out', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    startOverride(ctx, hull, OverrideKind.Shield);
    runOut(ctx, shield.duration);
    expect(hull.hp).toBeLessThanOrEqual(0);
    expect(hull.override).toBeUndefined();
  });

  it('detonates a kamikaze as a kamikaze — the blast it was built for', () => {
    const ctx = makeCtx(1);
    const bomb = piloted(ctx, WeaponType.Bomb);
    const victim = spawnRobot(ctx.world, Owner.AI, { x: 420, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const victimHp = victim.hp;
    startOverride(ctx, bomb, OverrideKind.Shield);
    runOut(ctx, shield.duration);
    expect(bomb.hp).toBeLessThanOrEqual(0);
    expect(victim.hp).toBeLessThan(victimHp);
  });

  it('never fires a mode the machine did not live to finish', () => {
    // A charging `Overload` shot down before the burst is the whole answer a
    // defender has to it.
    const ctx = makeCtx(1);
    const hull = piloted(ctx, WeaponType.Ew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 420, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    startOverride(ctx, hull, OverrideKind.Overload);
    hull.hp = 0;
    runOut(ctx, overload.charge);
    expect(isDisabled(foe)).toBe(false);
  });

  it('leaves the wreck to `reapSystem` like any other death', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx);
    startOverride(ctx, hull, OverrideKind.Shield);
    runOut(ctx, shield.duration);
    reapSystem(ctx);
    expect(ctx.world.entities.some((e) => e.id === hull.id)).toBe(false);
  });
});

describe('the overload pulse', () => {
  it('knocks out hostile robots inside the radius and spares those outside', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx, WeaponType.Ew);
    const near = spawnRobot(ctx.world, Owner.AI, { x: 400 + overload.radius - 20, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const far = spawnRobot(ctx.world, Owner.AI, { x: 400 + overload.radius + 40, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    startOverride(ctx, hull, OverrideKind.Overload);
    runOut(ctx, overload.charge);
    expect(isDisabled(near)).toBe(true);
    expect(near.disabled!.left).toBe(overload.disableSeconds);
    expect(isDisabled(far)).toBe(false);
  });

  it('leaves its own side alone', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx, WeaponType.Ew);
    const friend = spawnRobot(ctx.world, Owner.Player, { x: 420, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    startOverride(ctx, hull, OverrideKind.Overload);
    runOut(ctx, overload.charge);
    expect(isDisabled(friend)).toBe(false);
  });

  it('drops enemy strike drones by zeroing hp — `munitionSystem` still owns them', () => {
    const ctx = makeCtx(1);
    const hull = piloted(ctx, WeaponType.Ew);
    const base = spawnBase(ctx.world, Owner.Player, 2, 2);
    const m = spawnMunition(ctx.world, Owner.AI, { x: 430, y: 400 }, 0, base.id, 12, 'launcher', WeaponType.Fpv);
    startOverride(ctx, hull, OverrideKind.Overload);
    runOut(ctx, overload.charge);
    expect(m.hp).toBe(0);
    // Still in the world: taking it out is the munition system's job, next tick.
    expect(ctx.world.entities.some((e) => e.id === m.id)).toBe(true);
  });
});
