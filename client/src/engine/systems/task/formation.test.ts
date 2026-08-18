import { describe, expect, it } from 'vitest';
import { ChassisType, FormationType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { gameConfig } from '../../../config/gameConfig';
import type { RobotEntity } from '../../ecs/archetypes';
import { spawnBase, spawnRobot } from '../../ecs/factory';
import type { GameContext } from '../../game/context';
import { makeCtx } from '../testkit';
import { applyFormations, FORMATION_RANK, formationSlots } from './formation';
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
    const ctx = makeCtx();
    const gun = robot(ctx, 'r_gun', WeaponType.Cannon);
    const jammer = robot(ctx, 'r_ew', WeaponType.Ew);
    const eyes = robot(ctx, 'r_radar', WeaponType.Radar);

    const slots = formationSlots([eyes, jammer, gun], FormationType.Line);
    // `ax` runs along the direction of travel and 0 is the front.
    expect(slots.get('r_gun')?.ax).toBeGreaterThan(slots.get('r_ew')?.ax ?? 0);
    expect(slots.get('r_ew')?.ax).toBeGreaterThan(slots.get('r_radar')?.ax ?? 0);
  });

  it('does not depend on the order it is handed the members', () => {
    const ctx = makeCtx();
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
    const ctx = makeCtx();
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
    const ctx = makeCtx();
    const nine = Array.from({ length: 9 }, (_, i) => robot(ctx, `r_${i}`, WeaponType.Cannon));

    const box = [...formationSlots(nine, FormationType.Box).values()];
    const furthest = Math.max(...box.map((s) => Math.hypot(s.ax, s.ay)));
    expect(furthest).toBeLessThan(gameConfig.robots.weapons.ew.jamRadius);

    // The whole point of `spread`: neighbours sit outside a kamikaze's reach.
    const blast = gameConfig.robots.weapons.bomb.explosionRadius + gameConfig.robots.radius;
    expect(cfg.spacing.spread).toBeGreaterThan(blast);
  });

  it('puts the support hulls in the middle cells of a box and the guns on the perimeter', () => {
    const ctx = makeCtx();
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
    const ctx = makeCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 140, 100)];
    const resolved = formUp(members, FormationType.Line);

    applyFormations(ctx, resolved);
    const move = resolved.get('r_1')?.move;
    expect(move?.kind).toBe('goal');
    // Not the raw objective any more — it is standing in a rank now.
    expect(move).not.toMatchObject({ x: 1000, y: 0 });
  });

  it('leaves a dodge alone — the shape must not cost a unit its evasion', () => {
    const ctx = makeCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 140, 100)];
    const dodge = { move: { kind: 'goal', x: 100, y: 148, reactive: true } } as const;
    const resolved = formUp(members, FormationType.Line, { r_1: dodge });

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move).toEqual(dodge.move);
  });

  it('stops projecting the frame forward once the whole line is holding and firing', () => {
    const ctx = makeCtx();
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
    const ctx = makeCtx();
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
    const ctx = makeCtx();
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
    const ctx = makeCtx();
    // A radar is refused every attack directive, so it sits on Idle with no
    // intent and no destination. Before formations it simply got left behind.
    const eyes = robot(ctx, 'r_radar', WeaponType.Radar, 100, 100);
    const gun = robot(ctx, 'r_gun', WeaponType.Cannon, 140, 100);
    const resolved = formUp([eyes, gun], FormationType.Line, { r_radar: {} });

    applyFormations(ctx, resolved);
    expect(resolved.get('r_radar')?.move).toBeDefined();
  });

  it('holds a hull that has run out ahead of its slot instead of reversing it', () => {
    const ctx = makeCtx();
    // Both told to go east; the first is already far past where the group is.
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 900, 100), robot(ctx, 'r_2', WeaponType.Cannon, 100, 100)];
    const resolved = formUp(members, FormationType.Line);

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move?.kind).toBe('hold');
  });

  it('lets the kamikaze out of the line once the group is on top of the enemy', () => {
    const ctx = makeCtx();
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
    const ctx = makeCtx();
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
    const ctx = makeCtx();
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
    const ctx = makeCtx();
    const lone = robot(ctx, 'r_1', WeaponType.Cannon, 100, 100);
    const resolved = formUp([lone], FormationType.Line);

    applyFormations(ctx, resolved);
    expect(lone.script.blackboard.formation).toBeUndefined();
    expect(resolved.get('r_1')?.move).toEqual({ kind: 'goal', x: 1000, y: 0 });
  });

  it('collapses a slot that lands in a mountain onto the frame origin', () => {
    const ctx = makeCtx();
    const members = [robot(ctx, 'r_1', WeaponType.Cannon, 100, 100), robot(ctx, 'r_2', WeaponType.Cannon, 100, 140)];
    // Wall off everything except a two-tile-wide corridor along y — the gorge
    // case: every outboard slot is blocked at once, so the group has to file.
    const tiles = gameConfig.grid.width;
    ctx.navObstacles = Array.from({ length: tiles }, (_, ty) =>
      Array.from({ length: tiles }, (_, tx) => !(tx === 3 || ty === 3)),
    );

    const resolved = formUp(members, FormationType.Line);
    applyFormations(ctx, resolved);

    // Both are pointed at the same place — the origin — rather than at slots
    // buried in the rock, which is what filing through a pass looks like here.
    const a = resolved.get('r_1')?.move;
    const b = resolved.get('r_2')?.move;
    if (a?.kind === 'goal' && b?.kind === 'goal') expect({ x: a.x, y: a.y }).toEqual({ x: b.x, y: b.y });
    else expect.unreachable('both should still have somewhere to go');
  });

  it('leaves robots with no formation entirely alone', () => {
    const ctx = makeCtx();
    const loner = robot(ctx, 'r_1', WeaponType.Cannon, 100, 100);
    loner.script = { programId: TaskType.AttackBase, blackboard: {} };
    const resolved = new Map<string, Outcome>([['r_1', { move: { kind: 'goal', x: 1000, y: 0 } }]]);

    applyFormations(ctx, resolved);
    expect(resolved.get('r_1')?.move).toEqual({ kind: 'goal', x: 1000, y: 0 });
  });
});
