import { describe, expect, it } from 'vitest';
import { ChassisType, FormationType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { gameConfig } from '../../../config/gameConfig';
import type { RobotEntity } from '../../ecs/archetypes';
import { spawnBase, spawnRobot } from '../../ecs/factory';
import type { GameContext } from '../../game/context';
import { isBlockedGrid, tileOf } from '../../obstacles';
import { makeCtx } from '../testkit';
import { clearGoal, setGoal } from '../movement';
import { movementSystem } from '../movement';
import { separationSystem } from '../separation';
import { applyFormations, FORMATION_RANK, formationSlots, toleranceFor } from './formation';
import type { Outcome } from './types';

/**
 * The formation layer is the one place in the engine where a robot is told to
 * stand somewhere for a reason that has nothing to do with its own program, so
 * these tests are mostly about the *interaction*: what overrules a slot, what a
 * slot overrules, and what happens to the shape as the group is shot to pieces.
 *
 * `formationSlots` is a pure function, which is what makes the geometry half of
 * that testable without ticking a match at all.
 */

const cfg = gameConfig.behavior.formation;
const DT = 1 / 30;

/** A map with nothing on it. */
function openGround(): boolean[][] {
  const n = gameConfig.grid.width;
  return Array.from({ length: n }, () => Array.from({ length: n }, () => false));
}

/**
 * A match on bare ground. `makeCtx()` seeds itself from the clock when it isn't
 * given a seed, so its terrain is different on every run — which was harmless
 * while the formation only measured sideways for a corridor, and is not now that
 * it paths a route through whatever is in front of the group. Tests that are
 * about the *shape* say so by starting from ground with nothing on it; the ones
 * that are about terrain lay their own down over this.
 */
function openCtx(): GameContext {
  const ctx = makeCtx();
  ctx.navObstacles = openGround();
  ctx.obstacles = ctx.navObstacles;
  return ctx;
}

/** Solid rock except one open column of tiles at `tx`, from `fromTy` down. */
function corridor(ctx: GameContext, tx: number, fromTy: number): void {
  const n = gameConfig.grid.width;
  ctx.navObstacles = Array.from({ length: n }, (_, ty) =>
    Array.from({ length: n }, (_, x) => !(x === tx && ty >= fromTy)),
  );
}

/** A robot with a known weapon, parked where it is put. */
function robot(ctx: GameContext, id: string, weapon: WeaponType, x = 0, y = 0): RobotEntity {
  const e = spawnRobot(ctx.world, Owner.Player, { x, y }, ChassisType.Tracks, weapon);
  e.id = id;
  return e as RobotEntity;
}

/** Puts `members` in one group and hands back the map the resolver would have built. */
function formUp(members: RobotEntity[], type: FormationType, outcomes: Record<string, Outcome> = {}) {
  for (const e of members) e.script.blackboard.formation = { gid: 'g1', type };
  const resolved = new Map<string, Outcome>();
  for (const e of members) resolved.set(e.id, outcomes[e.id] ?? { move: { kind: 'goal', x: 1000, y: 0 } });
  return resolved;
}

describe('formationSlots — the marching order', () => {
  it('puts the guns in front, the jammer and the bomb in the middle, the eyes at the back', () => {
    expect(FORMATION_RANK[WeaponType.Cannon]).toBeLessThan(FORMATION_RANK[WeaponType.Ew]);
    expect(FORMATION_RANK[WeaponType.Ew]).toBeLessThan(FORMATION_RANK[WeaponType.Radar]);
    expect(FORMATION_RANK[WeaponType.Bomb]).toBe(FORMATION_RANK[WeaponType.Ew]);
    // An `fpv` carrier never advances (range 4000), so the front rank would waste it.
    expect(FORMATION_RANK[WeaponType.Fpv]).toBe(FORMATION_RANK[WeaponType.Radar]);
  });

  it('places a line rank by rank, guns at the front of the axis', () => {
    const ctx = openCtx();
    const gun = robot(ctx, 'r_gun', WeaponType.Cannon);
    const jammer = robot(ctx, 'r_ew', WeaponType.Ew);
    const eyes = robot(ctx, 'r_radar', WeaponType.Radar);

    const slots = formationSlots([eyes, jammer, gun], FormationType.Line);
    // `ax` runs along the direction of travel and 0 is the front.
    expect(slots.get('r_gun')?.ax).toBeGreaterThan(slots.get('r_ew')?.ax ?? 0);
    expect(slots.get('r_ew')?.ax).toBeGreaterThan(slots.get('r_radar')?.ax ?? 0);
  });

  it('does not depend on the order it is handed the members', () => {
    const ctx = openCtx();
    const members = [
      robot(ctx, 'r_3', WeaponType.Cannon),
      robot(ctx, 'r_1', WeaponType.Cannon),
      robot(ctx, 'r_2', WeaponType.Missiles),
    ];
    const forwards = formationSlots(members, FormationType.Wedge);
    const backwards = formationSlots([...members].reverse(), FormationType.Wedge);
    for (const e of members) expect(backwards.get(e.id)).toEqual(forwards.get(e.id));
  });

  it('closes the ranks when a member dies rather than leaving its hole', () => {
    const ctx = openCtx();
    const members = [
      robot(ctx, 'r_1', WeaponType.Cannon),
      robot(ctx, 'r_2', WeaponType.Cannon),
      robot(ctx, 'r_3', WeaponType.Cannon),
    ];
    const full = formationSlots(members, FormationType.Line);
    const bereaved = formationSlots([members[0], members[2]], FormationType.Line);
    // Two abreast are centred differently from three: the survivors move up.
    expect(bereaved.get('r_1')).not.toEqual(full.get('r_1'));
    expect(bereaved.size).toBe(2);
  });

  it('keeps a box tight enough for a jammer to cover it, and spreads wider than a blast', () => {
    const ctx = openCtx();
    const nine = Array.from({ length: 9 }, (_, i) => robot(ctx, `r_${i}`, WeaponType.Cannon));

    const box = [...formationSlots(nine, FormationType.Box).values()];
    const furthest = Math.max(...box.map((s) => Math.hypot(s.ax, s.ay)));
    expect(furthest).toBeLessThan(gameConfig.robots.weapons.ew.jamRadius);

    // The whole point of `spread`: neighbours sit outside a kamikaze's reach.
    const blast = gameConfig.robots.weapons.bomb.explosionRadius + gameConfig.robots.radius;
    expect(cfg.spacing.spread).toBeGreaterThan(blast);
  });

  it('puts the support hulls in the middle cells of a box and the guns on the perimeter', () => {
    const ctx = openCtx();
    const members = [
      ...Array.from({ length: 8 }, (_, i) => robot(ctx, `r_gun_${i}`, WeaponType.Cannon)),
      robot(ctx, 'r_ew', WeaponType.Ew),
    ];
    const slots = formationSlots(members, FormationType.Box);
    const jammer = slots.get('r_ew');
    const fromCentre = (id: string) => {
      const s = slots.get(id);
      return Math.hypot(s?.ax ?? 0, s?.ay ?? 0);
    };
    expect(Math.hypot(jammer?.ax ?? 0, jammer?.ay ?? 0)).toBeLessThan(
      Math.min(...members.filter((e) => e.id !== 'r_ew').map((e) => fromCentre(e.id))) + 1e-6,
    );
  });
});

describe('applyFormations — what overrules a slot', () => {
  it('rewrites an advancing robot onto its slot instead of straight at the objective', () => {
    const ctx = openCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 140, 100)];
    const resolved = formUp(members, FormationType.Line);

    applyFormations(ctx, resolved);
    const move = resolved.get('r_1')?.move;
    expect(move?.kind).toBe('goal');
    // Not the raw objective any more — it is standing in a rank now.
    expect(move).not.toMatchObject({ x: 1000, y: 0 });
  });

  it('leaves a dodge alone — the shape must not cost a unit its evasion', () => {
    const ctx = openCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 140, 100)];
    const dodge = { move: { kind: 'goal', x: 100, y: 148, reactive: true } } as const;
    const resolved = formUp(members, FormationType.Line, { r_1: dodge });

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move).toEqual(dodge.move);
  });

  it('stops projecting the frame forward once the whole line is holding and firing', () => {
    const ctx = openCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 100, 200)];
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 200, y: 150 }, ChassisType.Tracks, WeaponType.Cannon);
    const holding = { move: { kind: 'hold' }, fire: foe.id } as const;
    const resolved = formUp(members, FormationType.Line, { r_1: holding, r_2: holding });

    applyFormations(ctx, resolved);
    // The frame is anchored on the group's own centroid with no lead, so the
    // slots straddle where the group already stands rather than pulling it on.
    const centroid = { x: 100, y: 150 };
    for (const e of members) {
      const move = resolved.get(e.id)?.move;
      if (move?.kind !== 'goal') continue;
      expect(Math.hypot(move.x - centroid.x, move.y - centroid.y)).toBeLessThanOrEqual(cfg.spacing.line * 2);
    }
  });

  it('settles a stopped line instead of shuffling it forever', () => {
    const ctx = openCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 140, 100)];
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);
    const holding = { move: { kind: 'hold' }, fire: foe.id } as const;

    // Nobody is advancing, so the frame is pinned to the group's own centroid:
    // dressing has a fixed point to converge on rather than a moving one.
    for (let tick = 0; tick < 5; tick++) {
      const resolved = formUp(members, FormationType.Line, { r_1: holding, r_2: holding });
      applyFormations(ctx, resolved);
      for (const e of members) {
        const move = resolved.get(e.id)?.move;
        if (move?.kind === 'goal') {
          e.position.x = move.x;
          e.position.y = move.y;
        }
      }
    }

    const settled = formUp(members, FormationType.Line, { r_1: holding, r_2: holding });
    applyFormations(ctx, settled);
    expect(settled.get('r_1')?.move?.kind).toBe('hold');
    expect(settled.get('r_2')?.move?.kind).toBe('hold');
  });

  it('does not cancel a right-click march already under way', () => {
    const ctx = openCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 140, 100)];
    // What a march looks like from here: Idle produces no move intent, and the
    // destination lives on `movement.goal`. The resolver's contract is that an
    // absent intent leaves that goal alone, and a formation must not break it.
    for (const e of members) e.movement.goal = { x: 900, y: 900 };
    const resolved = formUp(members, FormationType.Line, { r_1: {}, r_2: {} });

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move).toBeUndefined();
    expect(resolved.get('r_2')?.move).toBeUndefined();
  });

  it('falls an idle support hull in with the group once it has nowhere else to be', () => {
    const ctx = openCtx();
    // A radar is refused every attack directive, so it sits on Idle with no
    // intent and no destination. Before formations it simply got left behind.
    const eyes = robot(ctx, 'r_radar', WeaponType.Radar, 100, 100);
    const gun = robot(ctx, 'r_gun', WeaponType.Cannon, 140, 100);
    const resolved = formUp([eyes, gun], FormationType.Line, { r_radar: {} });

    applyFormations(ctx, resolved);
    expect(resolved.get('r_radar')?.move).toBeDefined();
  });

  it('holds a hull that has run out ahead of its slot instead of reversing it', () => {
    const ctx = openCtx();
    // Both told to go east; the first is already far past where the group is.
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 900, 100), robot(ctx, 'r_2', WeaponType.Cannon, 100, 100)];
    const resolved = formUp(members, FormationType.Line);

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move?.kind).toBe('hold');
  });

  it('lets the kamikaze out of the line once the group is on top of the enemy', () => {
    const ctx = openCtx();
    const bomb = robot(ctx, 'r_bomb', WeaponType.Bomb, 100, 100);
    const escort = robot(ctx, 'r_gun', WeaponType.Cannon, 140, 100);
    // A target the escort can genuinely reach — contact is measured against the
    // weapon's range, not against having merely picked something out.
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 200, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);
    const resolved = formUp([bomb, escort], FormationType.Box, {
      r_gun: { move: { kind: 'hold' }, fire: foe.id },
    });

    applyFormations(ctx, resolved);
    expect(bomb.script.blackboard.formation).toBeUndefined();
    // Its own intent is left untouched — it runs its program the rest of the way in.
    expect(resolved.get('r_bomb')?.move).toEqual({ kind: 'goal', x: 1000, y: 0 });
    // The escort stays in formation.
    expect(escort.script.blackboard.formation?.type).toBe(FormationType.Box);
  });

  it('keeps the kamikaze in rank while the escort has only *spotted* something', () => {
    const ctx = openCtx();
    const bomb = robot(ctx, 'r_bomb', WeaponType.Bomb, 100, 100);
    const escort = robot(ctx, 'r_gun', WeaponType.Cannon, 140, 100);
    // Well beyond the cannon's 180 px: a squad carrying a radar sees up to 460 px,
    // so "has picked a target" happens a long way from "can shoot it". Releasing
    // on the intent alone sent the kamikaze off alone halfway across the map.
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 900, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);
    const resolved = formUp([bomb, escort], FormationType.Box, {
      r_gun: { move: { kind: 'goal', x: 900, y: 100 }, fire: foe.id },
    });

    applyFormations(ctx, resolved);
    expect(bomb.script.blackboard.formation?.type).toBe(FormationType.Box);
  });

  it('releases the kamikaze against a base too, which never shoots first', () => {
    const ctx = openCtx();
    const bomb = robot(ctx, 'r_bomb', WeaponType.Bomb, 100, 100);
    const escort = robot(ctx, 'r_gun', WeaponType.Cannon, 140, 100);
    spawnBase(ctx.world, Owner.AI, 3, 3);
    // Make the enemy base known to us, the way `visionSystem` would.
    const enemyBase = ctx.world.entities.find((e) => e.owner === Owner.AI && e.production !== undefined);
    ctx.intel[Owner.Player].knownBaseIds.add(enemyBase?.id ?? '');

    const resolved = formUp([bomb, escort], FormationType.Box);
    applyFormations(ctx, resolved);
    expect(bomb.script.blackboard.formation).toBeUndefined();
  });

  it('disbands a group worn down to one survivor', () => {
    const ctx = openCtx();
    const lone = robot(ctx, 'r_1', WeaponType.Cannon, 100, 100);
    const resolved = formUp([lone], FormationType.Line);

    applyFormations(ctx, resolved);
    expect(lone.script.blackboard.formation).toBeUndefined();
    expect(resolved.get('r_1')?.move).toEqual({ kind: 'goal', x: 1000, y: 0 });
  });

  it('files a group down a one-tile corridor instead of piling it onto one point', () => {
    const ctx = openCtx();
    const members = Array.from({ length: 5 }, (_, i) => robot(ctx, `r_${i}`, WeaponType.Cannon, 96 + i * 8, 112));
    // A single open column of tiles running north-south: nothing wider than one
    // robot fits, so the shape has to become a file whatever was ordered. Open
    // for its whole length, so the tail of the file has ground to stand on —
    // when it doesn't, the safety valve takes over instead (see below).
    corridor(ctx, 3, 0);

    const resolved = formUp(members, FormationType.Line, Object.fromEntries(
      members.map((e) => [e.id, { move: { kind: 'goal' as const, x: 112, y: 1000 } }]),
    ));
    applyFormations(ctx, resolved);

    // Every goal distinct — the pile-up that the old collapse-to-origin produced
    // is precisely what jammed the mouth of a pass.
    const goals = members
      .map((e) => resolved.get(e.id)?.move)
      .filter((m): m is { kind: 'goal'; x: number; y: number } => m?.kind === 'goal');
    const distinct = new Set(goals.map((g) => `${g.x.toFixed(1)},${g.y.toFixed(1)}`));
    expect(distinct.size).toBe(goals.length);
    // ...and none of them is inside the rock.
    for (const g of goals) {
      const tile = tileOf({ x: g.x, y: g.y });
      expect(isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)).toBe(false);
    }
  });

  it('hands a robot back its own objective when its slot is in rock', () => {
    const ctx = openCtx();
    const members = Array.from({ length: 5 }, (_, i) => robot(ctx, `r_${i}`, WeaponType.Cannon, 96 + i * 8, 112));
    // The group is at the very mouth of the corridor: the file's rear slots fall
    // outside it, in the rock the group has just come from. Nothing can stand
    // there, and a formation is not allowed to answer that with `hold` — a hold
    // clears the goal, a cleared goal freezes the centroid, and the frame is
    // anchored on the centroid. That is the deadlock this valve exists for.
    corridor(ctx, 3, 3);

    const objective = { kind: 'goal' as const, x: 112, y: 1000 };
    const resolved = formUp(members, FormationType.Line, Object.fromEntries(members.map((e) => [e.id, { move: objective }])));
    applyFormations(ctx, resolved);

    // The ones with no slot to take are handed their own objective back rather
    // than a `hold`. (Holding is still a legitimate answer for a robot that *is*
    // in its slot — what must not happen is the group being stopped by ground it
    // cannot stand on.)
    const released = members.filter((e) => {
      const m = resolved.get(e.id)?.move;
      return m?.kind === 'goal' && m.x === objective.x && m.y === objective.y;
    });
    expect(released.length).toBeGreaterThan(0);
  });

  it('keeps the ordered shape where there is room for it', () => {
    const ctx = openCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 400, 400), robot(ctx, 'r_2', WeaponType.Cannon, 440, 400)];
    ctx.navObstacles = openGround();

    const resolved = formUp(members, FormationType.Line);
    applyFormations(ctx, resolved);

    // Abreast: on open ground a line stays a line, so the two goals differ across
    // the axis of travel rather than along it.
    const a = resolved.get('r_1')?.move;
    const b = resolved.get('r_2')?.move;
    if (a?.kind === 'goal' && b?.kind === 'goal') expect(Math.abs(a.y - b.y)).toBeGreaterThan(1);
    else expect.unreachable('both should have been given a slot');
  });

  it('leaves robots with no formation entirely alone', () => {
    const ctx = openCtx();
    const loner = robot(ctx, 'r_1', WeaponType.Cannon, 100, 100);
    loner.script = { programId: TaskType.AttackBase, blackboard: {} };
    const resolved = new Map<string, Outcome>([['r_1', { move: { kind: 'goal', x: 1000, y: 0 } }]]);

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move).toEqual({ kind: 'goal', x: 1000, y: 0 });
  });
});

/**
 * The invariant that was broken in the first cut of this feature, written down so
 * it fails the build rather than the game: a formation shares the field with
 * `separationSystem`, and any shape whose slots (or whose tolerance) let two
 * robots inside `radius * 2` will judder forever as the two systems fight.
 */
describe('formationSlots — geometry that separation can live with', () => {
  const minDist = gameConfig.robots.radius * 2;

  for (const type of Object.values(FormationType)) {
    it(`keeps every pair of slots at least ${minDist} px apart in a ${type}`, () => {
      const ctx = openCtx();
      // A mixed twelve, so ranks are populated and the widest layouts are exercised.
      const weapons = [WeaponType.Cannon, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar];
      const members = Array.from({ length: 12 }, (_, i) => robot(ctx, `r_${i}`, weapons[i % weapons.length]));

      const slots = [...formationSlots(members, type).values()];
      expect(slots).toHaveLength(members.length);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const gap = Math.hypot(slots[i].ax - slots[j].ax, slots[i].ay - slots[j].ay);
          expect(gap).toBeGreaterThanOrEqual(minDist);
        }
      }
    });

    it(`leaves a ${type} enough tolerance that neighbours never close inside the push distance`, () => {
      const spacing = cfg.spacing[type];
      // `release` is the binding one: it is the widest a robot may sit off its
      // slot and still be left alone, so a pair can close the gap by twice it.
      const { slack, release } = toleranceFor(spacing);
      expect(spacing - 2 * release).toBeGreaterThan(minDist);
      expect(slack).toBeLessThan(release);
    });
  }
});

describe('applyFormations — a settled formation stops moving', () => {
  it('parks a box without overlaps and without flapping between hold and drive', () => {
    const ctx = openCtx();
    ctx.navObstacles = openGround();
    const members = Array.from({ length: 9 }, (_, i) =>
      robot(ctx, `r_${i}`, WeaponType.Cannon, 600 + (i % 3) * 30, 600 + Math.floor(i / 3) * 30),
    );
    for (const e of members) e.script.blackboard.formation = { gid: 'g1', type: FormationType.Box };

    let flips = 0;
    let previouslyHolding = new Map<string, boolean>();
    for (let tick = 0; tick < 400; tick++) {
      const resolved = new Map<string, Outcome>();
      // Nobody advancing: the frame is pinned, so the group has a fixed shape to
      // settle into — the state a parked escort is in for most of a match.
      for (const e of members) resolved.set(e.id, { move: { kind: 'hold' } });
      applyFormations(ctx, resolved);
      for (const e of members) {
        const move = resolved.get(e.id)?.move;
        if (move?.kind === 'goal') setGoal(ctx, e, move.x, move.y);
        else clearGoal(e);
      }
      movementSystem(ctx, DT);
      separationSystem(ctx);

      if (tick > 250) {
        for (const e of members) {
          const holding = e.movement.goal === undefined;
          if (previouslyHolding.get(e.id) !== undefined && previouslyHolding.get(e.id) !== holding) flips++;
        }
      }
      previouslyHolding = new Map(members.map((e) => [e.id, e.movement.goal === undefined]));
    }

    // Nobody standing on anybody: this is the overlap that was visible on screen.
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const gap = Math.hypot(
          members[i].position.x - members[j].position.x,
          members[i].position.y - members[j].position.y,
        );
        expect(gap).toBeGreaterThanOrEqual(gameConfig.robots.radius * 2 - 0.01);
      }
    }
    // ...and nobody twitching: the hysteresis band is what buys this.
    expect(flips).toBe(0);
  });
});

describe('layoutFor — the ground overrules the shape', () => {
  const goingSouth = (members: RobotEntity[]) =>
    formUp(members, FormationType.Line, Object.fromEntries(
      members.map((e) => [e.id, { move: { kind: 'goal' as const, x: e.position.x, y: 1200 } }]),
    ));

  /** How wide, across the axis of travel, the group was actually told to stand. */
  const frontage = (members: RobotEntity[], resolved: Map<string, Outcome>) => {
    const xs = members
      .map((e) => resolved.get(e.id)?.move)
      .filter((m): m is { kind: 'goal'; x: number; y: number } => m?.kind === 'goal')
      .map((m) => m.x);
    return xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;
  };

  it('narrows a line to a column in a two-tile pass, and to a file in a one-tile pass', () => {
    const ctx = openCtx();
    const members = Array.from({ length: 6 }, (_, i) => robot(ctx, `r_${i}`, WeaponType.Cannon, 112, 100 + i * 12));

    ctx.navObstacles = openGround();
    const open = goingSouth(members);
    applyFormations(ctx, open);
    const openFrontage = frontage(members, open);

    // Two tiles wide (a column fits, a six-abreast line does not).
    const n = gameConfig.grid.width;
    ctx.navObstacles = Array.from({ length: n }, () => Array.from({ length: n }, (_, x) => !(x === 3 || x === 4)));
    const twoWide = goingSouth(members);
    applyFormations(ctx, twoWide);
    const columnFrontage = frontage(members, twoWide);

    corridor(ctx, 3, 0);
    const oneWide = goingSouth(members);
    applyFormations(ctx, oneWide);
    const fileFrontage = frontage(members, oneWide);

    expect(openFrontage).toBeGreaterThan(columnFrontage);
    expect(columnFrontage).toBeGreaterThan(fileFrontage);
    expect(fileFrontage).toBeLessThan(1); // a file has no frontage at all
  });
});

/**
 * The stall this layer was rewritten for (`.docs/issues/formation-jitter-and-narrow-passes.md`,
 * stage A of `.docs/tasks/movement-refactor.md`): a squad ordered at something
 * behind a mountain range walked to the rock face and stood there for the rest
 * of the match. Nothing about it was visible in the unit tests above, because
 * every one of them decides a single tick — the freeze is a *loop*, and it needs
 * the real conveyor to show up.
 *
 * Measured on the old code the group made 626 px of its 1287 and then stopped
 * dead, with 71% of all robot-ticks spent with no goal at all.
 */
describe('applyFormations — a march that has to go round something', () => {
  const WALL_TY = 10;
  const GAP_TX = 20;

  /** Rock right across the course, with the only way through well off the straight line to the goal. */
  function wallWithOffsetGap(ctx: GameContext): void {
    const n = gameConfig.grid.width;
    ctx.navObstacles = Array.from({ length: n }, (_, ty) =>
      Array.from({ length: n }, (_, tx) => ty === WALL_TY && tx !== GAP_TX && tx !== GAP_TX + 1),
    );
    ctx.obstacles = ctx.navObstacles;
  }

  /** One tick of the real pipeline: intents → formation → goals → movement → separation. */
  function march(ctx: GameContext, members: RobotEntity[], goal: { x: number; y: number }): void {
    const resolved = new Map<string, Outcome>();
    for (const e of members) resolved.set(e.id, { move: { kind: 'goal', x: goal.x, y: goal.y } });
    applyFormations(ctx, resolved);
    for (const e of members) {
      const move = resolved.get(e.id)?.move;
      if (move?.kind === 'goal') setGoal(ctx, e, move.x, move.y);
      else if (move?.kind === 'hold') clearGoal(e);
    }
    movementSystem(ctx, DT);
    separationSystem(ctx);
  }

  function squad(ctx: GameContext): RobotEntity[] {
    const weapons = [WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar];
    return weapons.map((w, i) => robot(ctx, `r_${i}`, w, 150 + (i % 3) * 30, 150 + Math.floor(i / 3) * 30));
  }

  it('gets a squad through a pass whose mouth is nowhere near the straight line to the goal', () => {
    const ctx = openCtx();
    wallWithOffsetGap(ctx);
    const members = squad(ctx);
    for (const e of members) e.script.blackboard.formation = { gid: 'g1', type: FormationType.Box };
    const goal = { x: 1150, y: 1150 };

    const start = members.map((e) => ({ ...e.position }));
    const startDist = Math.min(...start.map((p) => Math.hypot(goal.x - p.x, goal.y - p.y)));

    for (let tick = 0; tick < 1400; tick++) march(ctx, members, goal);

    // Through the wall — the whole squad, not just whoever found the gap.
    const wallY = (WALL_TY + 1) * gameConfig.grid.tilePx;
    for (const e of members) expect(e.position.y).toBeGreaterThan(wallY);

    // ...and actually arrived. The old code's centroid stopped ~660 px short.
    const endDist = Math.max(...members.map((e) => Math.hypot(goal.x - e.position.x, goal.y - e.position.y)));
    expect(endDist).toBeLessThan(startDist / 4);
  });

  it('never lets the shape stop a robot for longer than it takes to dress', () => {
    const ctx = openCtx();
    wallWithOffsetGap(ctx);
    const members = squad(ctx);
    for (const e of members) e.script.blackboard.formation = { gid: 'g1', type: FormationType.Box };
    const goal = { x: 1150, y: 1150 };

    // A robot standing in its slot for a tick or two is the formation working. A
    // robot standing for *seconds* while its group is still half a map from the
    // objective is the deadlock: the freeze is not visible in any single tick, it
    // is visible in how long it lasts. Three seconds is an order of magnitude
    // more than dressing takes and an order of magnitude less than the old stall,
    // which never ended at all.
    const stopped = new Map(members.map((e) => [e.id, 0]));
    for (let tick = 0; tick < 900; tick++) {
      march(ctx, members, goal);
      for (const e of members) {
        const held = e.movement.goal === undefined ? (stopped.get(e.id) ?? 0) + 1 : 0;
        stopped.set(e.id, held);
        expect(held, `${e.id} stood still for ${held} ticks, ending on tick ${tick}`).toBeLessThan(90);
      }
    }

    // ...and the group as a whole never stops making ground.
    const centroid = members.reduce((a, e) => ({ x: a.x + e.position.x / 6, y: a.y + e.position.y / 6 }), { x: 0, y: 0 });
    expect(Math.hypot(goal.x - centroid.x, goal.y - centroid.y)).toBeLessThan(200);
  });
});
