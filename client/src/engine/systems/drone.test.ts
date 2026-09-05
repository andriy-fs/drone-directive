import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { droneSystem, manualFireTarget } from './drone';
import { movementSystem, setGoal } from './movement';
import { reapSystem } from './reap';
import { isTargetableDrone } from '../targeting';
import { makeCtx } from './testkit';

function fillNav(ctx: GameContext, blocked: boolean): void {
  const { width, height } = gameConfig.grid;
  ctx.navObstacles = Array.from({ length: height }, () => new Array<boolean>(width).fill(blocked));
}

function setControl(ctx: GameContext, dir = { x: 0, y: 0 }, possessPulse = false, firePulse = false): void {
  ctx.droneControl[Owner.Player] = { dir, possessPulse, firePulse };
}

/** `W`: screen y grows downward, so full ahead on a ridden hull is y = -1. */
const FORWARD = { x: 0, y: -1 };

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

describe('droneSystem — a standing MoveDrone goal', () => {
  it('flies toward the goal with the stick neutral, and stops on arrival', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone.goal = { x: 400 + gameConfig.drone.speed, y: 400 };
    setControl(ctx);

    droneSystem(ctx, 0.5); // half a second: half the way there
    expect(drone.position.x).toBeCloseTo(400 + gameConfig.drone.speed / 2, 3);
    expect(drone.drone.goal).toBeDefined(); // not there yet

    droneSystem(ctx, 0.5);
    expect(drone.position.x).toBeCloseTo(400 + gameConfig.drone.speed, 3);

    // The order is spent on the *next* tick, when the arrival check runs against
    // where the drone now is. That one tick is not a wait the player can see —
    // the drone is already parked, and nothing draws the goal — but the drone has
    // to be somewhere before "am I there?" can be asked about it.
    const restingX = drone.position.x;
    droneSystem(ctx, 1);
    expect(drone.drone.goal).toBeUndefined();
    expect(drone.position.x).toBeCloseTo(restingX, 3);

    // And it holds station from here rather than buzzing around the point.
    droneSystem(ctx, 1);
    expect(drone.position.x).toBeCloseTo(restingX, 3);
  });

  it('counts anything inside the arrival radius as arrived', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone.goal = { x: 400 + gameConfig.drone.goalArriveRadius - 1, y: 400 };
    setControl(ctx);

    droneSystem(ctx, 1);

    expect(drone.drone.goal).toBeUndefined();
    expect(drone.position.x).toBeCloseTo(400, 3); // never moved: it was already there
  });

  // The engine's precedence rule. No human produces this collision today — the
  // client sends no free-flight stick for a player (`GameApp.localDroneControl`) —
  // but `droneSystem` cannot tell a player from a bot and has to answer it anyway.
  it('hands the stick priority and cancels the goal outright', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone.goal = { x: 400, y: 800 }; // sent south
    setControl(ctx, { x: 1, y: 0 }); // pilot pushes east

    droneSystem(ctx, 1);

    expect(drone.position.x).toBeCloseTo(400 + gameConfig.drone.speed, 3);
    expect(drone.position.y).toBeCloseTo(400, 3);
    // And the order is gone, not queued: releasing the key must not resume it.
    expect(drone.drone.goal).toBeUndefined();
    setControl(ctx);
    droneSystem(ctx, 1);
    expect(drone.position.y).toBeCloseTo(400, 3);
  });

  it('spends the goal when the drone lands on a hull', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 405, y: 400 });
    drone.drone.goal = { x: 400, y: 900 };
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone.possessedId).toBe(robot.id);
    expect(drone.drone.goal).toBeUndefined();
  });
});

describe('droneSystem — possession', () => {
  it('lands on the nearest friendly robot within range', () => {
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

  it('lands on a hull that is already under orders', () => {
    // The gate used to be `Idle`, which sounds mild and priced the cockpit out of
    // the game: a player cannot assign `Idle`, so the only hulls wearing it are
    // the ones fresh off the factory floor, and every sortie began with a long
    // manual drive from home. `taskSystem` standing the program down is what makes
    // taking a machine mid-march safe — see `task/resolver.ts`.
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.script!.programId = TaskType.Guard;
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBe(robot.id);
  });

  it('will not possess a robot out of range', () => {
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
    // Two hands on the hull otherwise: the pilot steering while `movementSystem`
    // walks the route queued behind them. A programmed hull gets a fresh goal from
    // its own resolver on release; an `Idle` one holding a right-clicked
    // destination is the case nothing else would ever clear.
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

/**
 * A ridden hull reads the stick as its *own* controls, not as a compass: `y` is
 * throttle along the heading and `x` is a turn rate. A robot spawns pointing east
 * (`heading = 0`), so "forward" in these tests is east — which is the shortest
 * statement of the whole change: the same key that used to mean north.
 */
describe('droneSystem — driving a possessed robot', () => {
  /** Radians the pilot may swing the hull in one tick. */
  const turnStep = ((gameConfig.drone.possessTurnRateDeg * Math.PI) / 180) * gameConfig.fixedDt;

  const possessed = (ctx: GameContext, at = { x: 400, y: 400 }) => {
    const robot = spawnRobot(ctx.world, Owner.Player, at, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, at);
    drone.drone!.possessedId = robot.id;
    return { robot, drone };
  };

  it('drives along the heading, not along the stick, and drags the drone with it', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false); // open ground
    const { robot, drone } = possessed(ctx);
    setControl(ctx, FORWARD);

    droneSystem(ctx, gameConfig.fixedDt);

    // East, because that is where the hull points — the stick said "forward".
    expect(robot.position!.x).toBeCloseTo(400 + robot.movement!.speed * gameConfig.fixedDt, 3);
    expect(robot.position!.y).toBeCloseTo(400, 3);
    expect(drone.position!.x).toBeCloseTo(robot.position!.x, 3);
    expect(drone.position!.y).toBeCloseTo(robot.position!.y, 3);
  });

  it('turns at the configured rate without moving the hull', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const { robot } = possessed(ctx);
    setControl(ctx, { x: 1, y: 0 }); // D — to the pilot's right

    droneSystem(ctx, gameConfig.fixedDt);

    // Screen y grows downward, so a right turn increases the heading.
    expect(robot.heading).toBeCloseTo(turnStep, 6);
    expect(robot.position!.x).toBeCloseTo(400, 6);
    expect(robot.position!.y).toBeCloseTo(400, 6);
  });

  it('turns the other way on the other key', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const { robot } = possessed(ctx);
    setControl(ctx, { x: -1, y: 0 }); // A

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.heading).toBeCloseTo(-turnStep, 6);
  });

  it('reverses along the heading without spinning the machine round', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const { robot } = possessed(ctx);
    setControl(ctx, { x: 0, y: 1 }); // S

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.position!.x).toBeCloseTo(400 - robot.movement!.speed * gameConfig.fixedDt, 3);
    expect(robot.heading).toBe(0); // still pointing the way it was
  });

  it('keeps turning while pinned against a wall', () => {
    // The step can be refused; the heading never is. A pilot nosed into rock must
    // still be able to point the machine somewhere else.
    const ctx = makeCtx(1);
    fillNav(ctx, true);
    const { robot } = possessed(ctx);
    setControl(ctx, { x: 1, y: -1 }); // full ahead and hard over, into the rock

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.position!.x).toBeCloseTo(400, 6);
    expect(robot.position!.y).toBeCloseTo(400, 6);
    expect(robot.heading).toBeGreaterThan(0);
  });

  it('stops the possessed robot at walls (obstacle-checked)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true); // every destination tile blocked
    const { robot } = possessed(ctx);
    setControl(ctx, FORWARD);

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.position!.x).toBeCloseTo(400, 3); // did not phase through the wall
  });

  it('publishes the velocity the pilot drove', () => {
    // `movementSystem` cannot measure this hull — the pilot's step lands between
    // the two systems — so `drivePossessed` records it, and it is what every
    // neighbour reciprocates against in the ORCA solve.
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const { robot } = possessed(ctx);
    setControl(ctx, FORWARD);

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.velX).toBeCloseTo(robot.movement!.speed, 3);
    expect(robot.movement!.velY).toBeCloseTo(0, 3);
  });

  it('publishes zero for a hull that only turned — it covered no ground', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const { robot } = possessed(ctx);
    robot.movement!.velX = 60;
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.velX).toBe(0);
    expect(robot.movement!.velY).toBe(0);
  });

  it('publishes zero for a centred stick rather than last tick\'s reading', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const { robot } = possessed(ctx);
    robot.movement!.velX = 60;
    robot.movement!.velY = -12;
    setControl(ctx); // stick centred

    droneSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.velX).toBe(0);
    expect(robot.movement!.velY).toBe(0);
  });

  it('stops at a wall and says so — no velocity for a step it did not take', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true);
    const { robot } = possessed(ctx);
    setControl(ctx, FORWARD);

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
    setGoal(ctx, robot, 400, 1200); // sent south when the pilot arrives
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, FORWARD); // and driven forward — east, where the hull points
    const dt = gameConfig.fixedDt;

    droneSystem(ctx, dt);
    movementSystem(ctx, dt);

    expect(robot.position!.y).toBeCloseTo(400, 3); // not a pixel south
    expect(robot.position!.x).toBeCloseTo(400 + robot.movement!.speed * dt, 3);
    expect(robot.movement!.velX).toBeCloseTo(robot.movement!.speed, 3);
    expect(robot.movement!.velY).toBeCloseTo(0, 3);
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
    // The case behind "I pressed E and nothing happened": a cannon reaches 200 px,
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
