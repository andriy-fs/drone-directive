import { gameConfig } from '../../../config/gameConfig';
import type { ObstacleGrid } from '../../obstacles';
import type { RobotEntity } from '../../ecs/archetypes';
import { createOrcaSolver, type OrcaSolver } from './solver';
import { collectWalls } from './walls';

/**
 * The ECS side of ORCA — the steering system the game actually calls.
 *
 * Split from `solver.ts` on purpose: the solver knows about numbers in typed
 * arrays and nothing else, so it can be tested without a world, while everything
 * that knows what a robot *is* lives here.
 *
 * **Why this is an object with buffers rather than a plain function.** Zero
 * allocation per tick means the buffers must outlive the tick, and that state has
 * to live somewhere. It lives on `GameContext` — one per match, created with the
 * context and dying with it, so there is no `reset()` for anyone to forget. A
 * module-level singleton would pass today, because `GameEngine.tick` is
 * synchronous and the two engines in `game/determinism.test.ts` never interleave
 * a `begin()`/`solve()` pair; it would just be correct for a reason nothing
 * enforces.
 *
 * **Order is the contract.** Agents must be registered in miniplex query order
 * (= spawn order, which lockstep pins on both peers), because the linear program
 * walks its constraints in order. Never sort here.
 */

/** What `movementSystem` decided a robot is doing this tick. */
export type Intent =
  /** Driving toward its waypoint: ORCA solves for it. */
  | 'drive'
  /**
   * Parked with nowhere to go (preference zero), or landing on its waypoint
   * (preference = the landing velocity): solved, so it gives way when pressed and
   * does what it preferred otherwise. This is what RVO2 does with an arrived
   * agent, and it is what keeps a lattice of parked hulls passable — a `passive`
   * holder owes movers nothing, and two of them 40 px apart leave a gap ORCA's
   * 2x23 px hold distance can never thread, which parked a mover in the pocket
   * mouth in a permanent micro-orbit (see
   * `.docs/investigation/orca-spin-and-open-field-deadlock.md`).
   */
  | 'hold'
  /** Retreating or disabled: registered so others flow around it, never solved. */
  | 'passive';

export interface OrcaSteering {
  /** Starts a tick and drops last tick's agents. Allocates nothing. */
  begin(dt: number): void;
  /**
   * Registers one robot. `prefX`/`prefY` is the velocity it would drive with no
   * neighbours; `distToWaypoint` sets its effective horizon. Returns the agent
   * index, which the caller keeps to read the answer back.
   */
  register(e: RobotEntity, intent: Intent, prefX: number, prefY: number, distToWaypoint: number): number;
  /** Adds the static half-planes around every registered agent, then solves. */
  solve(grid: ObstacleGrid): void;
  /** The solved velocity for `agent`, valid until the next `begin`. */
  velocityX(agent: number): number;
  velocityY(agent: number): number;
  /** True when the constraints were infeasible and a least-penetrating velocity was used. */
  fellBack(agent: number): boolean;
  readonly solver: OrcaSolver;
}

export function createOrcaSteering(): OrcaSteering {
  const solver = createOrcaSolver();
  // Parallel to the solver's agent slots: what each registered agent needs during
  // the wall pass. Grown, never reallocated per tick.
  let radii: Float64Array = new Float64Array(0);
  let speeds: Float64Array = new Float64Array(0);
  let posX: Float64Array = new Float64Array(0);
  let posY: Float64Array = new Float64Array(0);
  let solved: Uint8Array = new Uint8Array(0);
  let count = 0;

  function grow(n: number): void {
    if (n <= radii.length) return;
    let next = radii.length === 0 ? 64 : radii.length;
    while (next < n) next *= 2;
    radii = new Float64Array(next);
    speeds = new Float64Array(next);
    posX = new Float64Array(next);
    posY = new Float64Array(next);
    solved = new Uint8Array(next);
  }

  return {
    solver,

    begin(dt: number): void {
      count = 0;
      solver.beginTick(dt);
    },

    register(e: RobotEntity, intent: Intent, prefX: number, prefY: number, distToWaypoint: number): number {
      const cfg = gameConfig.behavior.orca;
      const m = e.movement;
      const radius = gameConfig.robots.radius + cfg.radiusPadding;
      const passive = intent === 'passive';

      // Look no further ahead than the time left to drive. Without this a hull
      // 36 px from its formation slot is capped at ~13 px/s and the box never
      // dresses — `spacing.box` is exactly 36. See the config comment.
      const speed = m.speed;
      const travel = speed > 1e-6 ? distToWaypoint / speed : cfg.timeHorizon;
      const tau = travel < cfg.timeHorizonMin ? cfg.timeHorizonMin : travel > cfg.timeHorizon ? cfg.timeHorizon : travel;

      grow(count + 1);
      const agent = solver.addAgent(
        e.position.x,
        e.position.y,
        m.velX,
        m.velY,
        prefX,
        prefY,
        radius,
        speed,
        1 / tau,
        passive,
      );
      radii[agent] = radius;
      speeds[agent] = speed;
      posX[agent] = e.position.x;
      posY[agent] = e.position.y;
      solved[agent] = passive ? 0 : 1;
      count = agent + 1;
      return agent;
    },

    solve(grid: ObstacleGrid): void {
      const cfg = gameConfig.behavior.orca;
      const invTauObst = 1 / cfg.timeHorizonObst;
      // Walls only for agents that will actually be solved — a passive hull's
      // velocity is copied through untouched, so constraints on it are wasted work.
      // Walls use the **true hull radius**, not the padded ORCA radius. The
      // padding exists for one reason — to hold agents a hair further apart than
      // the distance `separationSystem` fires at — and geometry knows nothing
      // about that. Spending it on walls too narrows every corridor by a
      // millimetre of nothing, and on a one-tile pass (32 px against a 22 px
      // hull) that millimetre is the difference between the two wall constraints
      // being jointly satisfiable and being infeasible, at which point the unit
      // stops dead. It must match the clearance `smoothPath`/`hasClearance`
      // guaranteed when the route was built, or ORCA refuses to drive routes A*
      // has already promised are drivable.
      const hull = gameConfig.robots.radius;
      for (let i = 0; i < count; i++) {
        if (solved[i] === 0) continue;
        collectWalls(grid, posX[i], posY[i], hull, speeds[i], invTauObst, solver, i);
      }
      solver.solve(cfg.neighborDist * cfg.neighborDist);
    },

    velocityX: (agent: number) => solver.newVelX[agent],
    velocityY: (agent: number) => solver.newVelY[agent],
    fellBack: (agent: number) => solver.fellBack[agent] === 1,
  };
}
