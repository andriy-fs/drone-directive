/**
 * The radio's bus adapter — a third app-layer observer next to `GameApp.wireBus`
 * and `attachSelectionAudio`.
 *
 * What it is responsible for: turning engine events into *lines the local player
 * is entitled to hear*, and handing out callsigns. What it is deliberately not
 * responsible for: pacing (`radioBudget.ts`) and wording (`radio/`).
 *
 * Two rules shape everything below.
 *
 * **It speaks for one side only.** Every handler filters on `localSide`, the same
 * way the factory pip and the drone notice already do in `wireBus`. In a
 * free-for-all the AI corners are fighting each other constantly; narrating that
 * would drown the player's own war in other people's news.
 *
 * **Callsigns live here, not in the ECS.** The engine's ids share one global
 * counter across every entity ever spawned, so `robot_412` is normal a minute in
 * and useless as a name. The numbering is assigned on first mention instead,
 * per side and chassis. That makes it presentation state, which is exactly what
 * it should be: two lockstep peers may hand out different numbers and nothing
 * about the simulation notices, because the feed never leaves this client.
 */
import type { Owner, ChassisType, WeaponType } from '@drone-directive/types/enums';
import type { Vec2 } from '@drone-directive/types/entities';
import type { RobotEntity } from '../../engine/ecs/archetypes';
import { robots } from '../../engine/ecs/queries';
import type { EcsWorld } from '../../engine/ecs/world';
import type { GameBus } from '../../engine/game/eventBus';
import { atRobotCap } from '../../engine/systems/production';
import { radioConfig } from '../../config/radio';
import { loadBank } from '../../radio/bank';
import type { RadioKey, RadioParams, UnitRef } from '../../radio/types';
import { useGameStore } from '../../store/gameStore';
import type { RadioLine } from '../../store/types';
import { worldToTile } from '../coords';
import { createRadioBudget, type PendingLine } from './radioBudget';

/**
 * Everything the director needs from the outside. Injected rather than imported
 * so the whole thing can be driven by a test with a fake bus and a hand-cranked
 * clock — `attachRadio` below is the thin binding to the real ones.
 */
export interface RadioDeps {
  bus: GameBus;
  world: EcsWorld;
  /** Read late: the local side is decided per match, and the director outlives one. */
  localSide: () => Owner;
  /**
   * Has the local side found this base? `GameApp.hearsBase`, which the dome cues
   * already use. Bases carry no attacker, so this is the only thing standing
   * between the player and news about a building they have never seen.
   */
  knowsBase: (owner: Owner, baseId: string) => boolean;
  now: () => number;
  push: (line: RadioLine) => void;
  clear: () => void;
}

export interface RadioDirector {
  /** Drain at most one queued line. Called once per simulated tick. */
  pump: () => void;
  destroy: () => void;
}

export function createRadioDirector(deps: RadioDeps): RadioDirector {
  const budget = createRadioBudget();
  const callsigns = new Map<string, UnitRef>();
  const counters = new Map<string, number>();
  const unsubs: (() => void)[] = [];
  let nextLineId = 1;
  let matchStartedAt = deps.now();
  /**
   * Edge detection for the robot cap. Being at the cap is a *state*, not a bus
   * event — nothing is emitted when production quietly declines to refill — so it
   * is sampled per tick in `pump` and only the crossing into it is offered.
   */
  let wasAtCap = false;

  /**
   * A unit's name, minted on first mention and kept afterwards — including past
   * its death, which is what lets `lost` name the casualty that is already gone
   * from the world by the time anyone reads the line.
   */
  function nameOf(id: string, chassis: ChassisType, weapon: WeaponType): UnitRef {
    const existing = callsigns.get(id);
    if (existing) return existing;
    const bucket = `${chassis}`;
    const n = (counters.get(bucket) ?? 0) + 1;
    counters.set(bucket, n);
    const ref: UnitRef = { chassis, weapon, n };
    callsigns.set(id, ref);
    return ref;
  }

  function findRobot(id: string): RobotEntity | undefined {
    for (const e of robots(deps.world)) if (e.id === id) return e;
    return undefined;
  }

  /** Names a robot by id if it is still in the world; otherwise nothing can speak. */
  function refFor(id: string): UnitRef | undefined {
    const cached = callsigns.get(id);
    if (cached) return cached;
    const e = findRobot(id);
    return e ? nameOf(e.id, e.chassis, e.weaponType) : undefined;
  }

  /**
   * Who reports a contact. `enemySpotted` names no observer — vision is resolved
   * for a side as a whole — so the nearest living unit of ours gets the line. It
   * is a guess, but it is always a plausible one: something of ours *is* within
   * sight range of that position, or the event would not exist.
   */
  function nearestOwn(pos: Vec2): { id: string; ref: UnitRef } | null {
    const side = deps.localSide();
    let best: RobotEntity | null = null;
    let bestD = Infinity;
    for (const e of robots(deps.world)) {
      if (e.owner !== side || e.hp <= 0) continue;
      // Squared distance: this runs per contact and only the ordering matters.
      const d = (e.position.x - pos.x) ** 2 + (e.position.y - pos.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return null;
    return { id: best.id, ref: nameOf(best.id, best.chassis, best.weaponType) };
  }

  function offer(key: RadioKey, params: RadioParams, unitId: string | null): void {
    budget.offer({ key, params, unitId, at: deps.now() }, deps.now());
  }

  /** Tile coordinates for the `{x}`/`{y}` slots — pixels mean nothing to a player. */
  function at(pos: Vec2): { x: number; y: number } {
    const { tx, ty } = worldToTile(pos.x, pos.y);
    return { x: tx, y: ty };
  }

  function say(line: PendingLine, now: number): void {
    deps.push({
      id: nextLineId++,
      key: line.key,
      // Plain `Math.random`, not the seeded engine RNG: this must not consume a
      // draw the simulation depends on, and two peers picking different wording
      // is not a desync — it is the point.
      seed: Math.floor(Math.random() * 0x7fffffff),
      params: line.params,
      alert: radioConfig.alert[line.key],
      at: now,
      elapsedMs: now - matchStartedAt,
    });
  }

  function startMatch(): void {
    budget.reset();
    callsigns.clear();
    counters.clear();
    nextLineId = 1;
    matchStartedAt = deps.now();
    wasAtCap = false;
    deps.clear();
    // Kick the chunk off now rather than on the first line: it is a few tens of
    // kilobytes and the feed simply renders nothing until it lands.
    void loadBank(useGameStore.getState().locale);
  }

  unsubs.push(
    deps.bus.on('sceneChanged', ({ scene }) => {
      if (scene === 'game') startMatch();
      else {
        budget.reset();
        deps.clear();
      }
    }),
  );

  unsubs.push(
    deps.bus.on('enemySpotted', ({ owner, targetKind, pos }) => {
      if (owner !== deps.localSide()) return;
      // An enemy *drone* overhead is a contact like any other, but saying so every
      // time the opposing eye drifts past would be constant. Ground and buildings
      // only.
      if (targetKind === 'drone') return;
      const speaker = nearestOwn(pos);
      offer(
        targetKind === 'base' ? 'spottedBase' : 'spotted',
        { speaker: speaker?.ref, ...at(pos) },
        speaker?.id ?? null,
      );
    }),
  );

  unsubs.push(
    deps.bus.on('entityDestroyed', ({ id, kind, owner, killerId }) => {
      const side = deps.localSide();
      // A downed observer drone already has the toast and the view-sync handoff;
      // a third channel saying the same thing is noise.
      if (kind === 'drone') return;

      if (owner === side) {
        if (kind === 'base') return offer('baseLost', {}, null);
        // Named before the entity leaves the world — a moment later there is
        // nothing left to read a chassis off.
        return offer('lost', { unit: refFor(id) }, null);
      }

      if (kind === 'base') {
        // Bases carry no `threat`, so no `killerId` ever arrives for one — which
        // leaves nothing tying the event to us. The knowledge gate is what stops
        // the feed announcing a building on the far side of the fog that two AI
        // corners were fighting over.
        if (owner !== undefined && deps.knowsBase(owner, id)) offer('killedBase', {}, null);
        return;
      }
      // Someone else's robot. Only ours claiming the kill makes it our news —
      // in a free-for-all the AI corners kill each other constantly.
      if (!killerId) return;
      const killer = findRobot(killerId);
      if (!killer || killer.owner !== side) return;
      const ref = nameOf(killer.id, killer.chassis, killer.weaponType);
      offer('killed', { speaker: ref }, killer.id);
    }),
  );

  unsubs.push(
    deps.bus.on('entitySpawned', ({ id, kind, owner }) => {
      if (kind !== 'robot' || owner !== deps.localSide()) return;
      const ref = refFor(id);
      if (ref) offer('produced', { speaker: ref }, id);
    }),
  );

  // The dome speaks only for our own base. An enemy dome going up is visible on
  // screen and needs no narrator; our HQ announcing it would read as if it were ours.
  unsubs.push(
    deps.bus.on('shieldRaised', ({ owner }) => {
      if (owner === deps.localSide()) offer('shieldUp', {}, null);
    }),
  );
  unsubs.push(
    deps.bus.on('shieldEnded', ({ owner, shattered }) => {
      if (owner === deps.localSide()) offer(shattered ? 'shieldShattered' : 'shieldDown', {}, null);
    }),
  );

  unsubs.push(
    deps.bus.on('sideEliminated', ({ owner }) => {
      // Our own elimination is the defeat line, which `gameOver` delivers a moment
      // later — announcing both would say the same thing twice.
      if (owner !== deps.localSide()) offer('enemyEliminated', {}, null);
    }),
  );

  unsubs.push(
    deps.bus.on('gameOver', ({ winner }) => {
      offer(winner === deps.localSide() ? 'victory' : 'defeat', {}, null);
    }),
  );

  return {
    pump: () => {
      const now = deps.now();
      // Sampled here rather than in a handler: the player reaches the cap by
      // queueing as well as by rolling a unit out, and nothing on the bus covers
      // the first. The line itself is rate-limited like any other (`keyCooldownMs`).
      const atCap = atRobotCap(deps.world, deps.localSide());
      if (atCap && !wasAtCap) offer('capReached', {}, null);
      wasAtCap = atCap;

      const line = budget.take(now);
      if (line) say(line, now);
    },
    destroy: () => {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
    },
  };
}

/**
 * Bind the director to the real store and clock. `GameApp` calls this next to
 * `attachSelectionAudio` and pumps it from its per-tick hook.
 */
export function attachRadio(
  bus: GameBus,
  world: EcsWorld,
  knowsBase: (owner: Owner, baseId: string) => boolean,
): RadioDirector {
  const store = useGameStore.getState;
  return createRadioDirector({
    bus,
    world,
    localSide: () => store().localSide,
    knowsBase,
    now: () => performance.now(),
    push: (line) => store().pushRadioLine(line),
    clear: () => store().clearRadio(),
  });
}
