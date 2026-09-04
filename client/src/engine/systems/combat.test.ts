import { describe, expect, it } from 'vitest';
import { gameConfig, munitionReach } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { EffectKind } from '../ecs/entity';
import { spawnBase, spawnDrone, spawnProjectile, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { tileOf } from '../obstacles';
import { combatSystem } from './combat';
import { visionSystem } from './vision';
import { raiseShield } from './shield';
import { applyDisable } from '../status';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;
/**
 * Ticks that certainly cover a kamikaze's whole fuse and its blast: the one that
 * lights it (which does not decay it), the ones that burn it down, and one spare —
 * `armingTime / DT` is 30 subtractions of a third of nothing, so the last of them
 * can leave a few 1e-16 of a second behind.
 */
const FUSE_TICKS = Math.ceil(gameConfig.robots.weapons.bomb.armingTime / DT) + 2;

/** Clear the generated terrain so a stray mountain can't absorb the test's shot. */
function openGround(ctx: GameContext): void {
  const { width, height } = gameConfig.grid;
  ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

describe('combatSystem — anti-air', () => {
  it('a missile aimed at a drone brings it down over three hits', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });

    for (let shot = 0; shot < 3; shot++) {
      spawnProjectile(
        ctx.world,
        Owner.AI,
        { x: 390, y: 400 },
        drone.position!,
        drone.id,
        gameConfig.robots.weapons.missiles.damage,
        'shooter',
        WeaponType.Missiles,
      );
      combatSystem(ctx, DT);
    }

    expect(drone.hp).toBeLessThanOrEqual(0);
  });

  it('does not hit a drone the shot merely flies past on its way to a robot', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    const victim = spawnRobot(ctx.world, Owner.Player, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: 380, y: 400 },
      victim.position!,
      victim.id,
      gameConfig.robots.weapons.missiles.damage,
      'shooter',
      WeaponType.Missiles,
    );

    // Long enough for the shot to cross the drone's position and reach the robot.
    for (let i = 0; i < 10; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
    expect(victim.hp!).toBeLessThan(victim.maxHp!);
  });

  it('a cannon shot cannot touch a drone even when aimed at one', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: 390, y: 400 },
      drone.position!,
      drone.id,
      gameConfig.robots.weapons.cannon.damage,
      'shooter',
      WeaponType.Cannon,
    );

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });

  it('a drone riding inside a robot is immune — the shot passes it by', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = carrier.id;

    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: 390, y: 400 },
      drone.position!,
      drone.id,
      gameConfig.robots.weapons.missiles.damage,
      'shooter',
      WeaponType.Missiles,
    );
    combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });

  it('a directed-energy shot cannot touch a drone', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    spawnProjectile(ctx.world, Owner.AI, { x: 390, y: 400 }, drone.position!, drone.id, 0, 'shooter', WeaponType.Dew);

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
    expect(drone.disabled).toBeUndefined();
  });

  it('leaves a friendly drone alone', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    spawnProjectile(
      ctx.world,
      Owner.Player,
      { x: 390, y: 400 },
      drone.position!,
      drone.id,
      gameConfig.robots.weapons.missiles.damage,
      'shooter',
      WeaponType.Missiles,
    );

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });
});

const DEW = gameConfig.robots.weapons.dew;

/**
 * One tick the way `gameScene` runs it: vision resolves *before* combat, because
 * a shooter only fires at what its own side can see (`isKnownTo` in `fireWeapon`).
 * Any test where something pulls a trigger has to go through this; the ones that
 * hand-write `ctx.intel` to stage a recon case call `combatSystem` directly, so
 * this pass cannot overwrite what they set up.
 */
function tick(ctx: GameContext): void {
  visionSystem(ctx);
  combatSystem(ctx, DT);
}

/** Runs the tick until `done()` holds, or fails the test after `ticks` steps. */
function runUntil(ctx: GameContext, done: () => boolean, ticks = 30): void {
  for (let i = 0; i < ticks && !done(); i++) tick(ctx);
  expect(done()).toBe(true);
}

describe('combatSystem — directed-energy weapon', () => {
  it('fires even though it deals no damage', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    shooter.targetId = foe.id;

    tick(ctx);

    expect(ctx.world.with('projectile').entities.length).toBe(1);
    expect(shooter.weapon!.cooldownLeft).toBe(DEW.cooldown);
  });

  it('disables the robot it hits instead of hurting it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    shooter.targetId = foe.id;

    runUntil(ctx, () => foe.disabled !== undefined);

    expect(foe.disabled!.left).toBe(DEW.freezeDuration);
    expect(foe.hp).toBe(foe.maxHp);
  });

  it('leaves a visible discharge where it lands', () => {
    // Without this the weapon is invisible in play: no damage, no explosion, and
    // a shot that lands looks exactly like a shot that missed.
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    shooter.targetId = foe.id;

    runUntil(ctx, () => foe.disabled !== undefined);

    const burst = ctx.world.with('explosion', 'effect', 'position').entities.at(-1);
    expect(burst?.effect!.kind).toBe(EffectKind.Emp);
    expect(burst?.position!.x).toBeCloseTo(foe.position!.x, 3);
  });

  it('a second hit extends the knock-out rather than stacking it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    for (let i = 0; i < 2; i++) {
      spawnProjectile(ctx.world, Owner.Player, { x: 400, y: 400 }, foe.position!, foe.id, 0, 'shooter', WeaponType.Dew);
    }

    runUntil(ctx, () => foe.disabled !== undefined);

    expect(foe.disabled!.left).toBe(DEW.freezeDuration);
  });

  it('flies over an enemy base rather than being absorbed by it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const from = { x: base.position!.x - 120, y: base.position!.y };
    spawnProjectile(ctx.world, Owner.Player, from, base.position!, base.id, 0, 'shooter', WeaponType.Dew);

    for (let i = 0; i < 30; i++) combatSystem(ctx, DT);

    expect(base.hp).toBe(base.maxHp);
  });

  it('a disabled robot neither fires nor reloads', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Radar);
    shooter.targetId = foe.id;
    shooter.weapon!.cooldownLeft = 0.5;
    shooter.disabled = { left: 2 };

    for (let i = 0; i < 10; i++) combatSystem(ctx, DT);

    expect(ctx.world.with('projectile').entities.length).toBe(0);
    expect(shooter.weapon!.cooldownLeft).toBe(0.5);
  });
});

describe('combatSystem — the base battery', () => {
  const MISSILES = gameConfig.robots.weapons.missiles;

  /** Puts `e` at `dist` px from the base centre, along +x, and clears the terrain. */
  function stage(ctx: GameContext) {
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    return { base, at: (dist: number) => ({ x: base.position!.x + dist, y: base.position!.y }) };
  }

  it('shoots a robot its target pass has picked', () => {
    const ctx = makeCtx(1);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    base.targetId = foe.id;

    runUntil(ctx, () => (foe.hp ?? 0) < foe.maxHp!);

    expect(foe.hp!).toBe(foe.maxHp! - MISSILES.damage);
  });

  it('stamps the base as the attacker, so the victim can shoot back at it', () => {
    const ctx = makeCtx(1);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    base.targetId = foe.id;

    runUntil(ctx, () => (foe.hp ?? 0) < foe.maxHp!);

    expect(foe.threat!.attackerId).toBe(base.id);
  });

  it('cannot reach past its weapon range, measured from the footprint centre', () => {
    const ctx = makeCtx(1);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(MISSILES.range + 10), ChassisType.Tracks, WeaponType.Cannon);
    base.targetId = foe.id;

    for (let i = 0; i < 60; i++) combatSystem(ctx, DT);

    expect(foe.hp).toBe(foe.maxHp);
    expect(ctx.world.with('projectile').entities.length).toBe(0);
  });

  it('reloads between shots instead of emptying the launcher in one tick', () => {
    const ctx = makeCtx(1);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Legs, WeaponType.Cannon);
    base.targetId = foe.id;

    // Just under one reload: exactly one round should have left the tube.
    let fired = 0;
    ctx.bus.on('projectileFired', () => (fired += 1));
    for (let i = 0; i < Math.floor(MISSILES.cooldown / DT); i++) tick(ctx);

    expect(fired).toBe(1);
  });

  it('a mountain between base and target blocks the shot', () => {
    const ctx = makeCtx(1);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    base.targetId = foe.id;
    const wall = tileOf({ x: base.position!.x + 60, y: base.position!.y });
    ctx.sightBlockers[wall.ty][wall.tx] = true;

    for (let i = 0; i < 60; i++) combatSystem(ctx, DT);

    expect(foe.hp).toBe(foe.maxHp);
  });

  it('a destroyed base does not keep firing', () => {
    const ctx = makeCtx(1);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    base.targetId = foe.id;
    base.hp = 0;

    for (let i = 0; i < 60; i++) combatSystem(ctx, DT);

    expect(foe.hp).toBe(foe.maxHp);
  });
});

describe('combatSystem — a base under its energy dome', () => {
  const DOME = gameConfig.bases.shield;
  const CANNON = gameConfig.robots.weapons.cannon.damage;

  /** An AI base with its dome up, plus a helper for points along +x from its centre. */
  function domed(ctx: GameContext) {
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.AI, 4, 4);
    raiseShield(ctx, base);
    return { base, at: (dist: number) => ({ x: base.position!.x + dist, y: base.position!.y }) };
  }

  it('a round aimed at the base dies on the dome, well short of the roof', () => {
    const ctx = makeCtx(1);
    const { base, at } = domed(ctx);
    spawnProjectile(ctx.world, Owner.Player, at(300), base.position!, base.id, CANNON, 'shooter', WeaponType.Cannon);
    const shot = ctx.world.with('projectile').entities[0];

    for (let i = 0; i < 60 && ctx.world.with('projectile').entities.length > 0; i++) combatSystem(ctx, DT);

    expect(ctx.world.with('projectile').entities).toHaveLength(0);
    expect(base.hp).toBe(base.maxHp);
    expect(base.shield!.hp).toBe(DOME.hp - CANNON);
    // Stopped at the shell, not on the building: the last position it reached is
    // still out near the dome radius, far outside the 48 px footprint.
    expect(shot.position!.x - base.position!.x).toBeGreaterThan(DOME.radius - 15);
  });

  it('a kamikaze that drives under the dome still spends itself on it — and still kills what is beside it', () => {
    const ctx = makeCtx(1);
    const { base, at } = domed(ctx);
    const bomb = spawnRobot(ctx.world, Owner.Player, at(50), ChassisType.Wheels, WeaponType.Bomb);
    bomb.targetId = base.id;
    const bystander = spawnRobot(ctx.world, Owner.AI, at(60), ChassisType.Tracks, WeaponType.Cannon);

    for (let i = 0; i < FUSE_TICKS; i++) tick(ctx);

    expect(base.hp).toBe(base.maxHp);
    expect(base.shield!.hp).toBe(DOME.hp - gameConfig.robots.weapons.bomb.damage);
    expect(bystander.hp).toBeLessThan(bystander.maxHp!);
  });

  it('a dew round is still a dud over a domed base, not something for the dome to eat', () => {
    const ctx = makeCtx(1);
    const { base, at } = domed(ctx);
    spawnProjectile(ctx.world, Owner.Player, at(200), base.position!, base.id, 0, 'shooter', WeaponType.Dew);

    for (let i = 0; i < 20; i++) combatSystem(ctx, DT);

    expect(base.hp).toBe(base.maxHp);
    expect(base.shield!.hp).toBe(DOME.hp);
  });
});

describe('combatSystem — the FPV carrier', () => {
  const FPV = gameConfig.robots.weapons.fpv;

  /** A carrier and a target its side can see, well beyond any other weapon's reach. */
  function stageSalvo(ctx: GameContext) {
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Fpv);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 1200, y: 200 }, ChassisType.Wheels, WeaponType.Cannon);
    carrier.targetId = foe.id;
    ctx.intel.player.visibleRobotIds = new Set([foe.id]);
    return { carrier, foe };
  }

  it('launches a whole salvo, not a projectile', () => {
    const ctx = makeCtx(1);
    const { carrier } = stageSalvo(ctx);

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo);
    expect(ctx.world.with('projectile').entities.length).toBe(0);
    expect(carrier.weapon!.cooldownLeft).toBe(FPV.cooldown);
  });

  it('fires with a mountain in the way — its drones fly over terrain', () => {
    const ctx = makeCtx(1);
    const { width, height } = gameConfig.grid;
    ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(true));
    stageSalvo(ctx);

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo);
  });

  it('holds its fire at a target the side cannot currently see', () => {
    const ctx = makeCtx(1);
    const { carrier } = stageSalvo(ctx);
    ctx.intel.player.visibleRobotIds = new Set(); // spotter lost

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(0);
    expect(carrier.weapon!.cooldownLeft).toBe(0); // and the reload never started
  });

  it('spreads the salvo out, so five drones are not one dot', () => {
    const ctx = makeCtx(1);
    stageSalvo(ctx);

    combatSystem(ctx, DT);

    const spots = new Set(
      ctx.world.with('munition', 'position').entities.map((m) => `${Math.round(m.position!.x)}:${Math.round(m.position!.y)}`),
    );
    expect(spots.size).toBe(FPV.salvo);
  });

  it('an anti-air shot aimed at a strike drone brings it down in one hit', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const { foe } = stageSalvo(ctx);
    combatSystem(ctx, DT);
    const m = ctx.world.with('munition', 'position').entities[0];
    ctx.intel.ai.visibleAirIds = new Set([m.id]);

    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: m.position!.x + 10, y: m.position!.y },
      m.position!,
      m.id,
      gameConfig.robots.weapons.missiles.damage,
      foe.id,
      WeaponType.Missiles,
    );
    combatSystem(ctx, DT);

    expect(m.hp).toBeLessThanOrEqual(0);
  });

  it('does not swat a strike drone with a round aimed at the ground', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const { foe } = stageSalvo(ctx);
    combatSystem(ctx, DT);
    const m = ctx.world.with('munition', 'position').entities[0];

    // Aimed at the carrier, straight through where the swarm is standing.
    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: m.position!.x + 40, y: m.position!.y },
      { x: 200, y: 200 },
      'robot_1',
      gameConfig.robots.weapons.missiles.damage,
      foe.id,
      WeaponType.Missiles,
    );
    for (let i = 0; i < 6; i++) combatSystem(ctx, DT);

    expect(m.hp).toBe(m.maxHp);
  });
});

describe('combatSystem — the two things that must stop an FPV salvo', () => {
  const FPV = gameConfig.robots.weapons.fpv;

  /** A carrier and an enemy base it has already discovered, well inside drone reach. */
  function stageBase(ctx: GameContext) {
    const base = spawnBase(ctx.world, Owner.AI, 20, 20);
    const carrier = spawnRobot(
      ctx.world,
      Owner.Player,
      { x: base.position!.x - 600, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Fpv,
    );
    carrier.targetId = base.id;
    ctx.intel.player.knownBaseIds = new Set([base.id]);
    return { carrier, base };
  }

  it('holds fire on a discovered base nobody is currently watching', () => {
    const ctx = makeCtx(1);
    const { carrier } = stageBase(ctx);
    // Found earlier in the match, but no ally has eyes on it now. `knownBaseIds`
    // never forgets, so this is the case that used to fire forever.
    ctx.intel.player.visibleBaseIds = new Set();

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(0);
    expect(carrier.weapon!.cooldownLeft).toBe(0);
  });

  it('fires the moment someone puts eyes back on it', () => {
    const ctx = makeCtx(1);
    const { base } = stageBase(ctx);
    ctx.intel.player.visibleBaseIds = new Set([base.id]);

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo);
  });

  it('holds fire on a watched target its drones could never reach', () => {
    const ctx = makeCtx(1);
    const { carrier, base } = stageBase(ctx);
    ctx.intel.player.visibleBaseIds = new Set([base.id]);
    // Just beyond speed × flightTime — the medium/large-map case, where a base in
    // the far corner sits 2169/3075 px away against a reach of 1680.
    carrier.position!.x = base.position!.x - (munitionReach() + 200);

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(0);
    expect(carrier.weapon!.cooldownLeft).toBe(0); // and the reload is not burned on nothing
  });

  it('measures a base from its footprint edge, exactly as the drone does on arrival', () => {
    const ctx = makeCtx(1);
    const { carrier, base } = stageBase(ctx);
    ctx.intel.player.visibleBaseIds = new Set([base.id]);
    const halfFootprint = (gameConfig.bases.footprintTiles * gameConfig.grid.tilePx) / 2;
    // Centre-to-centre is out of reach; edge-to-launcher is not. Measuring from the
    // centre here would refuse a salvo that in fact arrives.
    carrier.position!.x = base.position!.x - (munitionReach() + halfFootprint / 2);

    combatSystem(ctx, DT);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo);
  });
});

describe('combatSystem — reach beyond a hull’s own eyes', () => {
  const MISSILES = gameConfig.robots.weapons.missiles;
  const WHEELS = gameConfig.robots.chassis.wheels;

  /** A missile hull and a foe standing inside its reach but outside its own sight. */
  function stageSpotting(ctx: GameContext) {
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Missiles);
    const gap = (MISSILES.range + WHEELS.sight) / 2; // the surplus the spotter pays for
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 400 + gap, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    shooter.targetId = foe.id;
    return { shooter, foe };
  }

  it('the surplus exists at all: the missile outreaches every chassis', () => {
    // The premise of the two tests below — and the thing that makes the recon gate
    // load-bearing for an ordinary weapon rather than only for the FPV carrier.
    const widest = Math.max(...Object.values(gameConfig.robots.chassis).map((c) => c.sight));
    expect(MISSILES.range).toBeGreaterThan(widest);
  });

  it('holds fire on a target nobody on its side can see', () => {
    const ctx = makeCtx(1);
    const { shooter } = stageSpotting(ctx);

    // Vision resolved honestly: the foe is past this hull's own sight and there is
    // no one else to light it.
    tick(ctx);

    expect(ctx.world.with('projectile').entities.length).toBe(0);
    expect(shooter.weapon!.cooldownLeft).toBe(0); // and the reload is not burned on nothing
  });

  it('fires the moment an ally lights the target', () => {
    const ctx = makeCtx(1);
    const { shooter, foe } = stageSpotting(ctx);
    // A radar picket parked on top of the foe — the intended use of the surplus.
    spawnRobot(ctx.world, Owner.Player, { x: foe.position!.x, y: foe.position!.y }, ChassisType.Wheels, WeaponType.Radar);

    tick(ctx);

    expect(ctx.intel[Owner.Player].visibleRobotIds.has(foe.id)).toBe(true);
    expect(ctx.world.with('projectile').entities.length).toBe(1);
    expect(shooter.weapon!.cooldownLeft).toBe(MISSILES.cooldown);
  });
});

describe('combatSystem — the kamikaze detonates inside its own blast', () => {
  const BOMB = gameConfig.robots.weapons.bomb;

  it('takes the target and what stands behind it, at the full trigger distance', () => {
    // The pair `range`/`explosionRadius` has to stay ordered: the trigger is
    // measured centre-to-centre, so a radius at or under `range` would blow up on
    // the rim of the blast and clip the aimed target alone.
    const ctx = makeCtx(1);
    openGround(ctx);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Bomb);
    const target = spawnRobot(ctx.world, Owner.AI, { x: 400 + BOMB.range, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const behind = spawnRobot(ctx.world, Owner.AI, { x: 400 + BOMB.range + 25, y: 400 }, ChassisType.Legs, WeaponType.Cannon);
    bomb.targetId = target.id;

    for (let i = 0; i < FUSE_TICKS; i++) tick(ctx);

    expect(target.hp!).toBeLessThanOrEqual(0);
    expect(behind.hp!).toBeLessThanOrEqual(0);
    expect(bomb.hp!).toBeLessThanOrEqual(0); // spent itself, as a kamikaze must
  });
});

describe('combatSystem — the kamikaze burns a fuse before it goes off', () => {
  const BOMB = gameConfig.robots.weapons.bomb;

  /** A bomb in range of one enemy hull, on open ground, aimed and ready to commit. */
  function staged(ctx: GameContext) {
    openGround(ctx);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Bomb);
    const target = spawnRobot(ctx.world, Owner.AI, { x: 400 + BOMB.range, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    bomb.targetId = target.id;
    return { bomb, target };
  }

  it('nothing happens on the tick it arrives — the fuse is the whole point', () => {
    // The exploit this exists for: before the fuse, arriving *was* the blast, and a
    // 70 hp hull at 135 px/s could not be shot off a base in the time it took.
    const ctx = makeCtx(1);
    const { bomb, target } = staged(ctx);

    tick(ctx);

    expect(target.hp!).toBe(target.maxHp!);
    expect(bomb.hp!).toBeGreaterThan(0);
    expect(bomb.arming!.left).toBeGreaterThan(0);
  });

  it('goes off once the fuse runs out, not before', () => {
    const ctx = makeCtx(1);
    const { bomb, target } = staged(ctx);

    // One tick short of the fuse: still standing there, still nothing dead.
    for (let i = 0; i < FUSE_TICKS - 1; i++) tick(ctx);
    expect(target.hp!).toBe(target.maxHp!);

    tick(ctx);
    expect(target.hp!).toBeLessThanOrEqual(0);
    expect(bomb.hp!).toBeLessThanOrEqual(0);
  });

  it('detonates anyway when the target dies while the fuse is burning', () => {
    // Committed, not conditional. A kamikaze that could be talked out of its blast
    // by killing what it aimed at would be a free scout with a panic button.
    const ctx = makeCtx(1);
    const { bomb, target } = staged(ctx);
    const bystander = spawnRobot(ctx.world, Owner.AI, { x: 400 + BOMB.range + 20, y: 400 }, ChassisType.Legs, WeaponType.Cannon);

    tick(ctx);
    target.hp = 0; // somebody else got there first

    for (let i = 0; i < FUSE_TICKS; i++) tick(ctx);

    expect(bomb.hp!).toBeLessThanOrEqual(0);
    expect(bystander.hp!).toBeLessThan(bystander.maxHp!);
  });

  it('a directed-energy hit stops the fuse for as long as it holds the hull', () => {
    // The one way to take a started kamikaze off a target without killing it, and
    // the reason the fuse is ticked below the knock-out check rather than above it.
    const ctx = makeCtx(1);
    const { bomb, target } = staged(ctx);

    tick(ctx);
    const left = bomb.arming!.left;
    applyDisable(bomb, 10);

    for (let i = 0; i < FUSE_TICKS; i++) tick(ctx);

    expect(bomb.arming!.left).toBe(left); // not a second burned while it was out
    expect(target.hp!).toBe(target.maxHp!);
  });

  it('a bomb killed on its own doorstep never gets the blast off', () => {
    const ctx = makeCtx(1);
    const { bomb, target } = staged(ctx);

    tick(ctx);
    bomb.hp = 0; // the defender's window, used

    for (let i = 0; i < FUSE_TICKS; i++) tick(ctx);

    expect(target.hp!).toBe(target.maxHp!);
  });
});

describe('combatSystem — a salvo is not spent on a dead man', () => {
  const FPV = gameConfig.robots.weapons.fpv;

  /** Two carriers looking at one enemy robot, close enough for both to reach it. */
  function stageCrowd(ctx: GameContext, foeHp: number) {
    openGround(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 500, y: 400 }, ChassisType.Wheels, WeaponType.Cannon);
    foe.hp = foeHp;
    const carriers = [420, 440].map((y) => {
      const c = spawnRobot(ctx.world, Owner.Player, { x: 400, y }, ChassisType.Tracks, WeaponType.Fpv);
      c.targetId = foe.id;
      return c;
    });
    return { foe, carriers };
  }

  it('the second carrier holds when the first volley already kills the target', () => {
    // Both picked the target in the same tick, before either had fired — so the
    // ledger the second one reads is the first one's salvo, already in the world.
    const ctx = makeCtx(1);
    const { carriers } = stageCrowd(ctx, FPV.damage * FPV.salvo - 10);

    tick(ctx);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo);
    expect(carriers[1].weapon!.cooldownLeft).toBe(0); // and keeps its nine seconds
  });

  it('both fire when one volley is not enough to kill it', () => {
    const ctx = makeCtx(1);
    const { carriers } = stageCrowd(ctx, FPV.damage * FPV.salvo + 10);

    tick(ctx);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo * 2);
    expect(carriers[1].weapon!.cooldownLeft).toBe(FPV.cooldown);
  });

  it("counts a base's dome toward what still has to be chewed through", () => {
    // Without the dome in the pool a volley or two would read as lethal and every
    // carrier would fall silent in front of a base nowhere near falling.
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.AI, 20, 20);
    base.hp = 20;
    raiseShield(ctx, base);
    const carrier = spawnRobot(
      ctx.world,
      Owner.Player,
      // Inside the hull's own sight, so the recon gate is not what is being tested.
      { x: base.position!.x - 150, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Fpv,
    );
    carrier.targetId = base.id;

    tick(ctx);

    expect(ctx.world.with('munition').entities.length).toBe(FPV.salvo);
  });
});
