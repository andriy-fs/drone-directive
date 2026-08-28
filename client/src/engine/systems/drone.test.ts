import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { droneSystem, manualFireTarget } from './drone';
import { movementSystem, setGoal } from './movement';
import { reapSystem } from './reap';
import { isTargetableDrone } from './targeting';
import { makeCtx } from './testkit';

function fillNav(ctx: GameContext, blocked: boolean): void {
  const { width, height } = gameConfig.grid;
  ctx.navObstacles = Array.from({ length: height }, () => new Array<boolean>(width).fill(blocked));
}

function setControl(ctx: GameContext, dir = { x: 0, y: 0 }, possessPulse = false, firePulse = false): void {
  ctx.droneControl[Owner.Player] = { dir, possessPulse, firePulse };
}

describe('droneSystem — free flight', () => {
  it('flies straight through obstacles (never pathfinds)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true); // whole map "blocked" — must not matter to the drone
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, 1);

    expect(drone.position!.x).toBeCloseTo(400 + gameConfig.drone.speed, 3);
    expect(drone.position!.y).toBeCloseTo(400, 3);
  });

  it('clamps to the world bounds', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 10, y: 10 });
    setControl(ctx, { x: -1, y: -1 });
    droneSystem(ctx, 1);
    expect(drone.position!.x).toBe(0);
    expect(drone.position!.y).toBe(0);
  });

  it('consumes the one-shot pulses each tick', () => {
    const ctx = makeCtx(1);
    spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true, true);
    droneSystem(ctx, 1);
    expect(ctx.droneControl[Owner.Player].possessPulse).toBe(false);
    expect(ctx.droneControl[Owner.Player].firePulse).toBe(false);
  });
});

describe('droneSystem — possession', () => {
  it('lands on the nearest idle friendly robot within range', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 405, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBe(robot.id);
  });

  it('will not possess a disabled robot (there is nothing left to steer)', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.disabled = { left: 8 };
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 405, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });

  it('a robot knocked out under the pilot answers neither stick nor trigger', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.None);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    robot.disabled = { left: 8 };
    setControl(ctx, { x: 1, y: 0 }, false, true);

    droneSystem(ctx, 1);

    expect(robot.position!.x).toBe(400);
    expect(ctx.world.with('projectile').entities.length).toBe(0);
    expect(drone.drone!.possessedId).toBe(robot.id); // still riding it
  });

  it('will not possess a non-idle robot', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.script!.programId = TaskType.Guard;
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });

  it('will not possess an idle robot out of range', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, {
      x: 400 + gameConfig.drone.possessRadius + 20,
      y: 400,
    });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });

  it('releases the robot on the next possess pulse and stays put', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
    expect(drone.position!.x).toBeCloseTo(400, 3);
  });

  it('clears an outstanding move order — taking the wheel spends it', () => {
    // Idle is not "not en route": `taskSystem` emits no move intent for an Idle
    // robot, so a right-clicked destination survives and would leave two hands on
    // the hull — the pilot steering while `movementSystem` drives the old goal.
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    setGoal(ctx, robot, 1200, 400);
    expect(robot.movement!.goal).toBeDefined();
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 405, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, gameConfig.fixedDt);

    expect(drone.drone!.possessedId).toBe(robot.id);
    expect(robot.movement!.goal).toBeUndefined();
    expect(robot.movement!.destination).toBeUndefined();
    expect(robot.movement!.path).toBeUndefined();
  });

  it('frees itself when the possessed robot dies', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    robot.hp = 0;
    setControl(ctx);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });
});

describe('droneSystem — driving a possessed robot', () => {
  it('steers the robot and drags the drone along', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false); // open ground
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, 1);

    expect(robot.position!.x).toBeGreaterThan(400);
    expect(drone.position!.x).toBeCloseTo(robot.position!.x, 3);
    expect(drone.position!.y).toBeCloseTo(robot.position!.y, 3);
  });

  it('stops the possessed robot at walls (obstacle-checked)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true); // every destination tile blocked
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, 1);

    expect(robot.position!.x).toBeCloseTo(400, 3); // did not phase through the wall
  });

  it('publishes the velocity the pilot drove', () => {
    // `movementSystem` cannot measure this hull — the pilot's step lands between
    // the two systems — so `drivePossessed` records it, and it is what every
    // neighbour reciprocates against in the ORCA solve.
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 0, y: -1 }); // north

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.velY).toBeCloseTo(-robot.movement!.speed, 3);
    expect(robot.movement!.velX).toBeCloseTo(0, 3);
  });

  it('publishes zero for a centred stick rather than last tick\'s reading', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.movement!.velX = 60;
    robot.movement!.velY = -12;
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx); // stick centred

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.velX).toBe(0);
    expect(robot.movement!.velY).toBe(0);
  });

  it('stops at a wall and says so — no velocity for a step it did not take', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.velX).toBe(0);
    expect(robot.movement!.velY).toBe(0);
  });

  it('keeps a possessed robot from auto-firing (clears its target)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.targetId = 'someEnemy';
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx); // no fire pulse

    droneSystem(ctx, 1);

    expect(robot.targetId).toBeUndefined();
  });
});

/**
 * The two systems in the order `gameScene` runs them, which is the only place the
 * fault was ever visible: `droneSystem` steers, `movementSystem` follows, and it
 * used to both drive the hull toward a stale destination and overwrite what the
 * pilot drove with a reading of its own pass.
 */
describe('droneSystem + movementSystem — one hand on the hull', () => {
  it('a hull possessed mid-move obeys the stick alone', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    setGoal(ctx, robot, 1200, 400); // walking east when the pilot arrives
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 0, y: -1 }); // stick held north
    const dt = gameConfig.fixedDt;

    droneSystem(ctx, dt);
    movementSystem(ctx, dt);

    expect(robot.position!.x).toBeCloseTo(400, 3); // not a pixel east
    expect(robot.position!.y).toBeCloseTo(400 - robot.movement!.speed * dt, 3);
    expect(robot.movement!.velX).toBeCloseTo(0, 3);
    expect(robot.movement!.velY).toBeCloseTo(-robot.movement!.speed, 3);
  });
});

describe('droneSystem — manual fire', () => {
  it('detonates a possessed kamikaze on demand, damaging a nearby enemy', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Bomb);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 430, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const foeHp = foe.hp!;
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = bomb.id;
    setControl(ctx, { x: 0, y: 0 }, false, true);

    droneSystem(ctx, 1);

    expect(foe.hp!).toBeLessThan(foeHp);
    expect(bomb.hp).toBe(0); // self-destructs
  });

  it('fires a projectile from a possessed gun robot at the nearest enemy in range', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnRobot(ctx.world, Owner.AI, { x: 470, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = gun.id;
    setControl(ctx, { x: 0, y: 0 }, false, true);

    droneSystem(ctx, 1);

    expect(ctx.world.with('projectile').entities.length).toBe(1);
    expect(gun.weapon!.cooldownLeft).toBeGreaterThan(0);
  });
});

describe('manualFireTarget — what the trigger would take', () => {
  const possessedGun = (ctx: GameContext, weapon: WeaponType = WeaponType.Cannon) => {
    fillNav(ctx, false);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, weapon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = gun.id;
    return gun;
  };

  it('is whatever the shot actually goes at — the mark and the round cannot disagree', () => {
    // The whole reason this is exported: the hull view draws it, and a mark that
    // named a different machine from the one the trigger hits would be worse than
    // no mark at all.
    const ctx = makeCtx(1);
    const gun = possessedGun(ctx);
    spawnRobot(ctx.world, Owner.AI, { x: 400, y: 470 }, ChassisType.Tracks, WeaponType.Cannon);
    const near = spawnRobot(ctx.world, Owner.AI, { x: 440, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    const marked = manualFireTarget(ctx, gun);
    expect(marked?.id).toBe(near.id);

    setControl(ctx, { x: 0, y: 0 }, false, true);
    droneSystem(ctx, 1);
    const shot = ctx.world.with('projectile').entities[0];
    expect(shot.targetId).toBe(marked!.id);
  });

  it('takes nothing when the nearest enemy is past the weapon range', () => {
    // The case behind "I pressed E and nothing happened": a cannon reaches 180 px,
    // and from inside a hull a machine at 300 looks perfectly shootable.
    const ctx = makeCtx(1);
    const gun = possessedGun(ctx);
    spawnRobot(ctx.world, Owner.AI, { x: 700, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    expect(manualFireTarget(ctx, gun)).toBeUndefined();
    setControl(ctx, { x: 0, y: 0 }, false, true);
    droneSystem(ctx, 1);
    expect(ctx.world.with('projectile').entities.length).toBe(0);
  });

  it('keeps marking through a reload, because that is the gun and not the target', () => {
    const ctx = makeCtx(1);
    const gun = possessedGun(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 440, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    gun.weapon!.cooldownLeft = gun.weapon!.cooldown;

    expect(manualFireTarget(ctx, gun)?.id).toBe(foe.id);
  });

  it('takes nothing for a hull that cannot shoot at all', () => {
    const ctx = makeCtx(1);
    // A kamikaze has no target — its shot is the blast where it stands — and a
    // radar has no weapon to point at anything.
    const bomb = possessedGun(makeCtx(1), WeaponType.Bomb);
    expect(manualFireTarget(ctx, bomb)).toBeUndefined();

    const scout = possessedGun(ctx, WeaponType.Radar);
    spawnRobot(ctx.world, Owner.AI, { x: 440, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    expect(manualFireTarget(ctx, scout)).toBeUndefined();
  });

  it('takes nothing while the hull is knocked out', () => {
    const ctx = makeCtx(1);
    const gun = possessedGun(ctx);
    spawnRobot(ctx.world, Owner.AI, { x: 440, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    gun.disabled = { left: 8 };

    expect(manualFireTarget(ctx, gun)).toBeUndefined();
  });
});

describe('drone exposure', () => {
  it('is a valid target while free-flying', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    expect(isTargetableDrone(drone)).toBe(true);
    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });

  it('is untouchable while it possesses a robot — it rides inside the hull', () => {
    const ctx = makeCtx(1);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = carrier.id;

    expect(isTargetableDrone(drone)).toBe(false);
  });

  it('becomes exposed again the moment it takes off', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = carrier.id;
    setControl(ctx, { x: 0, y: 0 }, true); // release pulse

    droneSystem(ctx, 1);

    expect(isTargetableDrone(drone)).toBe(true);
  });

  it('is reaped once shot down, leaving the side without an eye', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.hp = 0;

    expect(reapSystem(ctx)).toBe(true);
    expect(ctx.world.with('drone').entities).toHaveLength(0);
  });
});

describe('droneSystem — manual fire from an FPV carrier', () => {
  it('sends a salvo at the nearest foe the side can see, however far away', () => {
    const ctx = makeCtx(1);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Fpv);
    carrier.script = { programId: TaskType.Idle, blackboard: {} };
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 1400, y: 200 }, ChassisType.Wheels, WeaponType.Cannon);
    ctx.intel.player.visibleRobotIds = new Set([foe.id]);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 200, y: 200 });
    drone.drone!.possessedId = carrier.id;
    setControl(ctx, { x: 0, y: 0 }, false, true);

    droneSystem(ctx, gameConfig.fixedDt);

    expect(ctx.world.with('munition').entities.length).toBe(gameConfig.robots.weapons.fpv.salvo);
  });

  it('will not fire blind: an unseen enemy is no target, even in "range"', () => {
    const ctx = makeCtx(1);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Fpv);
    carrier.script = { programId: TaskType.Idle, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 1400, y: 200 }, ChassisType.Wheels, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 200, y: 200 });
    drone.drone!.possessedId = carrier.id;
    setControl(ctx, { x: 0, y: 0 }, false, true);

    droneSystem(ctx, gameConfig.fixedDt);

    expect(ctx.world.with('munition').entities.length).toBe(0);
  });
});
