import { gameConfig, worldPixelSize } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { FormationType, WeaponType } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../../utils/math';
import type { RobotEntity } from '../../ecs/archetypes';
import { isAlive, isPositioned } from '../../ecs/guards';
import { robots } from '../../ecs/queries';
import type { GameContext } from '../../game/context';
import { isBlockedGrid, tileOf } from '../../obstacles';
import { isDisabled } from '../status';
import { findById, knownEnemyBases, knownEnemyRobots } from '../targeting';
import { centroidOf } from './roam';
import type { MoveIntent, Outcome } from './types';

/**
 * Formation keeping: the layer that turns a bag of independent agents into a
 * body that marches together.
 *
 * It is **not** a directive and not a program, and that is the whole design.
 * Every combat program in `config/programs.ts` opens with `underFire → evade`,
 * so a formation expressed as a directive would be outranked by the first shot
 * fired at it and the shape would dissolve exactly when it starts to matter.
 * Instead this runs *after* the resolver has produced each robot's own move
 * intent and rewrites those intents — the program still decides what to fight,
 * the formation decides where to stand while doing it.
 *
 * Three properties fall out of the geometry rather than being coded for:
 *
 * - **The group paces itself to its slowest member.** The frame is anchored on
 *   the members' own centroid, so a straggler drags the origin back and every
 *   slot with it. No leader, no speed clamp, no stored anchor to keep in sync
 *   across two peers.
 * - **The line stops when it makes contact.** The frame is only projected
 *   forward while somebody still wants to advance; once everyone is holding and
 *   firing, `lead` goes to zero and the shape stands where it is.
 * - **Losses close the ranks.** Slots are recomputed every tick from whoever is
 *   still alive under the same group id, so a formation is never a list of
 *   positions that can go stale.
 */

/**
 * Where a weapon belongs in the depth of a formation. Derived from what the hull
 * actually does, not from a role the player assigns:
 *
 * - **0, the front** — `cannon` (180 px) and `dew` (120 px) have to be in contact
 *   to contribute at all.
 * - **1, the middle** — `missiles` outranges the front rank (255) and shoots over
 *   it, friendly units block no line of fire; `ew` projects an aura and covers
 *   most of the group from the centre; `bomb` is the one hull the formation
 *   exists to deliver, so it travels inside it.
 * - **2, the rear** — `radar` is eyes with `range: 0`, `none` has nothing at all,
 *   and `fpv` is artillery whose 4000 px "range" means it never needed to be
 *   anywhere near the front in the first place.
 */
export const FORMATION_RANK: Record<WeaponType, 0 | 1 | 2> = {
  [WeaponType.Cannon]: 0,
  [WeaponType.Dew]: 0,
  [WeaponType.Missiles]: 1,
  [WeaponType.Ew]: 1,
  [WeaponType.Bomb]: 1,
  [WeaponType.Radar]: 2,
  [WeaponType.Fpv]: 2,
  [WeaponType.None]: 2,
};

/**
 * The two tolerances a shape gets, derived from its spacing: how close to its
 * slot a robot has to be before it stops (`slack`), and how far out it has to
 * drift before it sets off again (`release`).
 *
 * Both are derived rather than configured, because the formation is not the only
 * thing moving these robots: `systems/separation.ts` pushes apart anything closer
 * than `robots.radius * 2`. **The binding number is `release`, not `slack`** —
 * that is the widest a robot may sit off its slot and still be left alone, so two
 * neighbours can close the gap between their slots by `2 * release`. If that
 * brings them inside the push distance, separation opens the pair, the slots pull
 * them shut, and they judder in place forever.
 *
 * A 12 px tolerance did exactly that to the 36 px box (36 − 24 = 12, well inside
 * the 22 px push), and the first attempt at a fix bounded `slack` while letting
 * `release` be twice it — which quietly put the same bug back. Measured, the box
 * then never reached its own spacing at all: every robot declared itself dressed
 * while still overlapping, and the group sat on the separation floor shuffling.
 *
 * The 0.8 (rather than the whole half-clearance) keeps the worst case strictly
 * clear of the threshold instead of sitting on it.
 */
export function toleranceFor(spacing: number): { slack: number; release: number } {
  const cfg = gameConfig.behavior.formation;
  const halfClearance = (spacing - gameConfig.robots.radius * 2) / 2;
  const release = Math.min(cfg.slackCap * cfg.holdReleaseFactor, 0.8 * halfClearance);
  return { slack: release / cfg.holdReleaseFactor, release };
}

/**
 * Single file — one robot wide. Not a `FormationType` because it is not something
 * the player picks: the terrain hands it out when nothing wider will fit through
 * (see `layoutFor`), and the shape the player chose is left untouched in the
 * blackboard so the HUD still shows it and the group resumes it in the open.
 */
const FILE = 'file';

/** A shape to lay out: one the player chose, or the file the ground forced. */
export type Layout = FormationType | typeof FILE;

/** Spacing for a layout; the file marches at the column's interval. */
function spacingFor(layout: Layout): number {
  const spacing = gameConfig.behavior.formation.spacing;
  return layout === FILE ? spacing[FormationType.Column] : spacing[layout];
}

/**
 * A slot in the formation's own frame: `ax` runs along the direction of travel
 * (0 at the front, negative behind it), `ay` across it.
 */
export interface Slot {
  ax: number;
  ay: number;
}

/**
 * Marching order: by rank first, then by id. The id tiebreak is not cosmetic —
 * it is what makes two peers hand the same robot the same slot without
 * exchanging a word about it, and it must never be swapped for anything that
 * depends on local state (selection order, hp, distance to the cursor).
 */
function marchingOrder(members: readonly RobotEntity[]): RobotEntity[] {
  return [...members].sort((a, b) => {
    const rank = FORMATION_RANK[a.weaponType] - FORMATION_RANK[b.weaponType];
    return rank !== 0 ? rank : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Lateral offsets for `n` abreast, centred on the axis. */
function abreast(n: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/**
 * The slot each member holds, keyed by robot id. A pure function of the members
 * and the shape — no world, no randomness, no time — which is what makes the
 * whole feature testable without a running match.
 */
export function formationSlots(members: readonly RobotEntity[], layout: Layout): Map<string, Slot> {
  const ordered = marchingOrder(members);
  const spacing = spacingFor(layout);
  const slots = new Map<string, Slot>();

  switch (layout) {
    case FILE: {
      // Single file, nose to tail: what a one-tile gap leaves room for. Never
      // offered as a choice — terrain hands it out, see `layoutFor`.
      ordered.forEach((e, i) => slots.set(e.id, { ax: -i * spacing, ay: 0 }));
      break;
    }
    case FormationType.Column: {
      // Two abreast, deepening: the shape that still fits down a two-tile gorge.
      ordered.forEach((e, i) => {
        slots.set(e.id, { ax: -Math.floor(i / 2) * spacing, ay: (i % 2 === 0 ? -0.5 : 0.5) * spacing });
      });
      break;
    }
    case FormationType.Line:
    case FormationType.Spread: {
      // One rank per role, front to back — `spread` is the same shape at a
      // spacing chosen to sit outside a kamikaze's blast.
      const byRank = groupByRank(ordered);
      byRank.forEach((rankMembers, depth) => {
        const lateral = abreast(rankMembers.length, spacing);
        rankMembers.forEach((e, i) => slots.set(e.id, { ax: -depth * spacing, ay: lateral[i] }));
      });
      break;
    }
    case FormationType.Wedge: {
      // Rows of 1, 2, 3 … in marching order: the point is a front rank hull, and
      // the support that sorts to the back ends up in the widest, deepest row.
      let index = 0;
      let row = 0;
      while (index < ordered.length) {
        const width = Math.min(row + 1, ordered.length - index);
        const lateral = abreast(width, spacing);
        for (let i = 0; i < width; i++) {
          slots.set(ordered[index + i].id, { ax: -row * spacing * 0.8, ay: lateral[i] });
        }
        index += width;
        row++;
      }
      break;
    }
    case FormationType.Box: {
      // A square, filled from the middle out: the support hulls sort last, so
      // handing out the *innermost* cells last would bury the gunners. Cells are
      // therefore ranked by distance from the centre and given to the marching
      // order in reverse — rear ranks take the middle, the front rank takes the
      // perimeter it is there to be.
      const cols = Math.ceil(Math.sqrt(ordered.length));
      const rows = Math.ceil(ordered.length / cols);
      const cells: Slot[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        cells.push({ ax: -(row - (rows - 1) / 2) * spacing, ay: (col - (cols - 1) / 2) * spacing });
      }
      cells.sort((a, b) => vecLength(a.ax, a.ay) - vecLength(b.ax, b.ay));
      [...ordered].reverse().forEach((e, i) => slots.set(e.id, cells[i]));
      break;
    }
  }

  return slots;
}

/**
 * Where the formation's frame is pinned this tick.
 *
 * **Advancing:** on the group's own centroid, pushed `lead` ahead. That is what
 * paces the body to its slowest member — a straggler drags the centroid back and
 * every slot comes back with it — and it costs nothing while everyone is moving
 * anyway.
 *
 * **Stopped:** on the *guide* — the first hull in marching order — by placing the
 * frame so that the guide is already standing in its own slot. Anchoring a
 * stationary group on its centroid does not converge: each robot chases a slot
 * defined relative to an average that its own movement then shifts, so somebody
 * is always a little out of place and the whole lattice creeps. Measured, a
 * parked box never reached its 36 px spacing at all — it sat at the 22 px
 * separation floor and shuffled indefinitely. Dressing on one robot gives the
 * others a fixed thing to line up on, which is what a drill line does and for the
 * same reason.
 *
 * Then the frame is slid sideways if the ground demands it, so a group entering a
 * pass takes the middle of it instead of grinding along one wall.
 */
function originFor(
  ctx: GameContext,
  mobile: readonly RobotEntity[],
  slots: Map<string, Slot>,
  marching: Vec2,
  facing: Vec2,
  advancing: boolean,
): Vec2 {
  let origin = marching;

  if (!advancing) {
    const guide = marchingOrder(mobile)[0];
    const slot = slots.get(guide.id);
    if (slot) {
      origin = {
        x: guide.position.x - (facing.x * slot.ax - facing.y * slot.ay),
        y: guide.position.y - (facing.y * slot.ax + facing.x * slot.ay),
      };
    }
  }

  const shift = centringShift(ctx, slots, origin, facing);
  if (shift === 0) return origin;
  return {
    x: clamp(origin.x - facing.y * shift, 0, worldPixelSize.width),
    y: clamp(origin.y + facing.x * shift, 0, worldPixelSize.height),
  };
}

/**
 * How far sideways the frame has to slide for the shape to fit the gap it is in,
 * or 0 when it already fits. Only what is actually needed: a group standing near
 * a cliff with plenty of room on its own side is left where it is.
 */
function centringShift(ctx: GameContext, slots: Map<string, Slot>, origin: Vec2, facing: Vec2): number {
  const radius: number = gameConfig.robots.radius;
  let needed = radius;
  for (const slot of slots.values()) needed = Math.max(needed, Math.abs(slot.ay) + radius);

  const span = corridorSpan(ctx, origin, facing);
  let shift = 0;
  if (span.right < needed) shift -= needed - span.right;
  if (span.left < needed) shift += needed - span.left;
  return shift;
}

/**
 * The shape the group can actually hold here — the one the player chose while
 * there is room for it, and something narrower while there is not.
 *
 * The ladder is chosen shape → `Column` → single file, and it is re-decided every
 * tick from the ground rather than latched, so a group squeezes down entering a
 * pass and opens back out on the far side without anybody ordering it to. The
 * player's choice is never rewritten: this is a temporary answer to the terrain,
 * and `blackboard.formation.type` still says what the group is *for*.
 *
 * The first version of this had no such step and instead collapsed each blocked
 * slot onto the frame's origin, on the theory that a gorge would file the group
 * automatically. It does not: a point is not a file. Every unit whose slot hit
 * rock was handed the *same* goal, they piled onto one tile, separation shoved
 * them apart, and the anti-jam retreat cycled them back and forth in the mouth of
 * the pass. Deciding the shape once, for the whole group, is what that should
 * have been.
 */
function layoutFor(
  ctx: GameContext,
  mobile: readonly RobotEntity[],
  type: FormationType,
  origin: Vec2,
  facing: Vec2,
): Layout {
  const ladder: Layout[] =
    type === FormationType.Column ? [FormationType.Column, FILE] : [type, FormationType.Column, FILE];
  // The span, not the distance to the nearer wall: the frame gets recentred in
  // whatever gap it is in (see `centringShift`), so what limits the shape is how
  // wide the gap is, not how badly the group happens to be hugging one side.
  const span = corridorSpan(ctx, origin, facing);
  const clear = (span.left + span.right) / 2;

  for (const layout of ladder) {
    if (halfWidthOf(mobile, layout) <= clear) return layout;
  }
  // Not even a file fits, which means the frame itself is standing in rock. The
  // file is still the right answer: its slots run *along* the axis, so the group
  // queues up behind whoever can move instead of bunching at the obstruction.
  return FILE;
}

/** How far the shape reaches to either side of its own axis, robot included. */
function halfWidthOf(mobile: readonly RobotEntity[], layout: Layout): number {
  let widest = 0;
  for (const slot of formationSlots(mobile, layout).values()) widest = Math.max(widest, Math.abs(slot.ay));
  return widest + gameConfig.robots.radius;
}

/**
 * How much clear ground the frame has on each side, up to the widest shape there
 * is any point measuring for.
 *
 * Sampled at more than one point along the axis — at the origin and one `lead`
 * further on — and the narrowest reading wins. One sample would have the group
 * still reading "open" with the pass directly in front of it and then flipping
 * shape the moment the origin crossed the threshold; looking ahead lets it fold
 * before it arrives, which is also what it looks like when it is done on purpose.
 *
 * The two sides are reported separately because a group is rarely centred in the
 * gap it is walking into: what decides whether a shape fits is the *span*, and
 * what the frame then needs is a nudge toward the middle of it.
 */
function corridorSpan(ctx: GameContext, origin: Vec2, facing: Vec2): { left: number; right: number } {
  // An eighth of a tile: the reading has to be good to a few pixels, because the
  // whole question it settles is whether a shape clears a gap by a hair. The walk
  // stops at the first blocked sample, so open ground is the only case that pays
  // for the resolution, and it pays in array lookups.
  const step = gameConfig.grid.tilePx / 8;
  const limit = Math.max(...Object.values(gameConfig.behavior.formation.spacing)) + gameConfig.robots.radius;
  const lead = gameConfig.behavior.formation.lead;
  const samples: Vec2[] = [origin, { x: origin.x + facing.x * lead, y: origin.y + facing.y * lead }];

  // The edge lies somewhere between the last clear sample and the first blocked
  // one, so the midpoint of that bracket is reported rather than its floor: the
  // floor understates every reading by up to a full step, and two understated
  // sides add up to a span narrow enough to file a group that would have fitted.
  const measure = (from: Vec2, sign: number, cap: number): number => {
    for (let offset = step; offset <= cap; offset += step) {
      if (blockedAt(ctx, from, facing, sign * offset)) return offset - step / 2;
    }
    return cap;
  };

  let left = limit;
  let right = limit;
  for (const from of samples) {
    right = measure(from, 1, right);
    left = measure(from, -1, left);
  }
  return { left, right };
}

/** Is the point `offset` px to the side of `from` (perpendicular to `facing`) impassable? */
function blockedAt(ctx: GameContext, from: Vec2, facing: Vec2, offset: number): boolean {
  const x = clamp(from.x - facing.y * offset, 0, worldPixelSize.width);
  const y = clamp(from.y + facing.x * offset, 0, worldPixelSize.height);
  const tile = tileOf({ x, y });
  return isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty);
}

/** The marching order split into consecutive runs of equal rank (empty ranks collapse). */
function groupByRank(ordered: readonly RobotEntity[]): RobotEntity[][] {
  const ranks: RobotEntity[][] = [];
  let current: RobotEntity[] = [];
  let rank: number | undefined;
  for (const e of ordered) {
    const r = FORMATION_RANK[e.weaponType];
    if (rank !== r) {
      if (current.length > 0) ranks.push(current);
      current = [];
      rank = r;
    }
    current.push(e);
  }
  if (current.length > 0) ranks.push(current);
  return ranks;
}

/**
 * Rewrites this tick's move intents so every robot in a formation drives to its
 * slot instead of straight at whatever its program picked. Runs once per tick,
 * between the resolver and the point where intents become goals.
 *
 * `resolved` is keyed by robot id and holds what each robot's program produced.
 * A robot the resolver skipped (knocked out) has no entry — it is still counted
 * as a member, so it rejoins its group when it wakes up, but it is left out of
 * the anchor and the slot layout: it cannot drive, and letting a frozen hull
 * hold the shape open would stall the group for the full eight seconds.
 */
export function applyFormations(ctx: GameContext, resolved: Map<string, Outcome>): void {
  const groups = new Map<string, RobotEntity[]>();
  for (const e of robots(ctx.world)) {
    if (!isAlive(e)) continue;
    const gid = e.script.blackboard.formation?.gid;
    if (gid === undefined) continue;
    const list = groups.get(gid);
    if (list) list.push(e);
    else groups.set(gid, [e]);
  }

  for (const members of groups.values()) applyGroup(ctx, members, resolved);
}

function applyGroup(ctx: GameContext, members: RobotEntity[], resolved: Map<string, Outcome>): void {
  // A formation of one is a robot. Dropping the record here (rather than leaving
  // it to mean nothing) is also what makes the HUD tile switch itself off once a
  // group has been whittled down to its last survivor.
  if (members.length <= 1) {
    for (const e of members) delete e.script.blackboard.formation;
    return;
  }

  const type = members[0].script.blackboard.formation?.type;
  if (type === undefined) return;

  const mobile = members.filter((e) => !isDisabled(e));
  if (mobile.length === 0) return; // the whole group is knocked out — nothing to steer

  const anchor = centroidOf(mobile);
  const cfg = gameConfig.behavior.formation;

  // Somebody still wants to go somewhere: the frame is projected `lead` ahead and
  // the group walks. Once every last member is holding — in range and shooting —
  // the projection goes to zero and the shape stands its ground. That is the whole
  // of "the formation holds on contact".
  const goals = mobile
    .map((e) => resolved.get(e.id)?.move)
    .filter((m): m is Extract<MoveIntent, { kind: 'goal' }> => m?.kind === 'goal');
  const advancing = goals.length > 0;

  const facing = facingOf(ctx, mobile, goals, anchor, resolved);
  const lead = advancing ? cfg.lead : 0;
  const marching = { x: anchor.x + facing.x * lead, y: anchor.y + facing.y * lead };

  const contact = inContact(ctx, mobile, anchor, resolved);
  // What fits here, which is not always what was ordered — see `layoutFor`. The
  // marching origin is good enough to probe the ground with; the final origin
  // needs the slots, and the slots need the layout.
  const layout = layoutFor(ctx, mobile, type, marching, facing);
  const slots = formationSlots(mobile, layout);
  const origin = originFor(ctx, mobile, slots, marching, facing, advancing);

  for (const e of mobile) {
    const out = resolved.get(e.id);
    if (!out) continue;

    // The one hull the formation is carrying rather than fielding: once the group
    // is on top of the enemy, the kamikaze stops dressing the line and runs its
    // own program the rest of the way in.
    if (contact && e.weapon.explosionRadius > 0) {
      delete e.script.blackboard.formation;
      continue;
    }

    // A dodge outranks the slot. It is worth 48 px for `underFireDuration` (1.2 s)
    // and the unit walks back into place afterwards, so the shape survives while
    // the micro-behaviour that keeps units alive under fire survives with it.
    if (out.move?.kind === 'goal' && out.move.reactive) continue;

    // No intent of its own *and* somewhere it was already sent: leave it alone.
    // That is the resolver's rule and the only thing keeping a manually issued
    // destination alive (`applyOutcome`); inventing a slot here would cancel
    // every right-click march the moment the selection had a formation. A group
    // on the march is dressed already — `moveInFormation` handed out the slots
    // when the order was given.
    //
    // With no destination either, the robot *does* get a slot, and this is where
    // support hulls come from: a radar is refused every attack directive it is
    // offered (`isTaskBlockedForWeapon`), so it sits on Idle producing no intent
    // at all. Before formations there was nothing to do about that but babysit
    // it. Now it simply travels with the group that is protecting it.
    if (!out.move && e.movement.goal) continue;

    const slot = slots.get(e.id);
    if (!slot) continue;
    out.move = slotIntent(ctx, e, origin, facing, slot, layout);
  }
}

/** The move intent that puts `e` on its slot — or holds it, if it is already there. */
function slotIntent(
  ctx: GameContext,
  e: RobotEntity,
  origin: Vec2,
  facing: Vec2,
  slot: Slot,
  layout: Layout,
): MoveIntent {
  const spacing = spacingFor(layout);

  // A lone boulder inside otherwise open ground: shuffle along the rank, then
  // drop back a rank, and only give up if none of that is free. What must never
  // happen is the whole blocked half of a shape being handed one shared point —
  // that is not a formation collapsing gracefully, it is a pile-up.
  const placed = firstFreePlacement(ctx, origin, facing, slot, spacing);
  if (!placed) return { kind: 'hold' };
  const { x, y } = placed;

  const dx = e.position.x - x;
  const dy = e.position.y - y;
  // Wider to leave than to enter: a robot that has stopped (no goal of its own)
  // stays stopped until it has drifted out to `release`. Without the band, one on
  // the boundary flips between holding and driving every tick, and every flip is
  // a `setGoal`/`clearGoal` pair with a fresh A* in it.
  const { slack, release } = toleranceFor(spacing);
  const threshold = e.movement.goal === undefined ? release : slack;

  // Already dressed, or out in front of it: hold. The second test is what keeps a
  // fast hull from reversing into its place — it waits for the line instead of
  // driving backwards through it.
  const ahead = dx * facing.x + dy * facing.y;
  if (vecLength(dx, dy) <= threshold || ahead > slack) return { kind: 'hold' };
  return { kind: 'goal', x, y };
}

/**
 * The slot itself if its ground is clear, else the nearest alternative along the
 * rank and then one rank back, else nothing. Candidates are tried in a fixed
 * order so two peers place the same robot identically.
 */
function firstFreePlacement(
  ctx: GameContext,
  origin: Vec2,
  facing: Vec2,
  slot: Slot,
  spacing: number,
): Vec2 | undefined {
  const candidates: Slot[] = [
    slot,
    { ax: slot.ax, ay: slot.ay + spacing / 2 },
    { ax: slot.ax, ay: slot.ay - spacing / 2 },
    { ax: slot.ax, ay: slot.ay + spacing },
    { ax: slot.ax, ay: slot.ay - spacing },
    { ax: slot.ax - spacing, ay: slot.ay },
  ];

  for (const candidate of candidates) {
    const x = clamp(origin.x + facing.x * candidate.ax - facing.y * candidate.ay, 0, worldPixelSize.width);
    const y = clamp(origin.y + facing.y * candidate.ax + facing.x * candidate.ay, 0, worldPixelSize.height);
    const tile = tileOf({ x, y });
    if (!isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)) return { x, y };
  }
  return undefined;
}

/**
 * Which way the formation is pointed, as a unit vector. Taken from where the
 * group is trying to go, not from where it happens to be looking, so every member
 * computes the same axis from the same shared facts:
 *
 * 1. the **guide's** own goal — the first hull in marching order, the way a drill
 *    line dresses on one flank. Averaging everybody's goals instead reads as
 *    noise the moment the group is searching rather than attacking: roam targets
 *    point every which way, their mean sits on top of the group, and a formation
 *    with no axis stops dead. One guide gives the body a direction to commit to;
 * 2. failing that, the centroid of whatever goals there are, so a guide that has
 *    stopped does not pin the rest;
 * 3. failing that (the whole line is stopped and shooting), whatever the guide is
 *    shooting at;
 * 4. failing that, the guide's heading — always defined, so this never degenerates.
 */
function facingOf(
  ctx: GameContext,
  mobile: readonly RobotEntity[],
  goals: readonly Extract<MoveIntent, { kind: 'goal' }>[],
  anchor: Vec2,
  resolved: Map<string, Outcome>,
): Vec2 {
  const guide = marchingOrder(mobile)[0];

  const guideGoal = resolved.get(guide.id)?.move;
  if (guideGoal?.kind === 'goal') {
    const unit = unitFrom(anchor, guideGoal);
    if (unit) return unit;
  }

  if (goals.length > 0) {
    let sx = 0;
    let sy = 0;
    for (const g of goals) {
      sx += g.x;
      sy += g.y;
    }
    const unit = unitFrom(anchor, { x: sx / goals.length, y: sy / goals.length });
    if (unit) return unit;
  }

  const targetId = guide.targetId;
  const target = targetId ? findById(ctx, targetId) : undefined;
  if (target && isPositioned(target)) {
    const unit = unitFrom(anchor, target.position);
    if (unit) return unit;
  }

  return { x: Math.cos(guide.heading), y: Math.sin(guide.heading) };
}

/** Unit vector from `a` to `b`, or undefined when the two coincide. */
function unitFrom(a: Vec2, b: Vec2): Vec2 | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = vecLength(dx, dy);
  if (len < 1e-6) return undefined;
  return { x: dx / len, y: dy / len };
}

/**
 * Whether the group has arrived: somebody is close enough to actually shoot, or a
 * known enemy stands within `bombReleaseRange` of the anchor.
 *
 * "Close enough to shoot" is measured, not read off the intent. `Outcome.fire`
 * names the target a robot has *picked*, which `engageOutcome` sets while it is
 * still walking toward it — reading that as contact released the kamikaze the
 * instant anything was spotted, which on a squad carrying a radar (sight ×2, up
 * to 460 px) meant halfway across the map with nothing in range of anybody.
 *
 * The second half is not redundant with the first: a base does not shoot back and
 * a group can be walking onto one with no fire intents at all, and that is
 * precisely the run a kamikaze is bought for.
 */
function inContact(
  ctx: GameContext,
  mobile: readonly RobotEntity[],
  anchor: Vec2,
  resolved: Map<string, Outcome>,
): boolean {
  for (const e of mobile) {
    const targetId = resolved.get(e.id)?.fire;
    if (targetId === undefined || e.weapon.range <= 0) continue;
    const target = findById(ctx, targetId);
    if (!target || !isPositioned(target)) continue;
    if (distance(e.position.x, e.position.y, target.position.x, target.position.y) <= e.weapon.range) return true;
  }

  const owner = mobile[0].owner;
  const reach = gameConfig.behavior.formation.bombReleaseRange;
  const foes = [...knownEnemyRobots(ctx, owner), ...knownEnemyBases(ctx, owner)];
  return foes.some((f) => distance(anchor.x, anchor.y, f.position.x, f.position.y) <= reach);
}
