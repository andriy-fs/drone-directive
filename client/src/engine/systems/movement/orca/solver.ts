/**
 * ORCA (Optimal Reciprocal Collision Avoidance) — the velocity-space solver.
 *
 * Pure and ECS-free on purpose: it knows about agents as numbers in typed arrays
 * and nothing about entities, the world, or the game. That keeps it unit-testable
 * without a context and keeps the engine's layering intact.
 *
 * **What it is for.** `separationSystem` is corrective — it pushes apart whatever
 * already overlaps, one tick too late. The avoidance layer it replaces
 * (`steerAround`) is preventive but *one-sided*: each unit deflects off the other's
 * current position, both can choose the same side, and it looks exactly one step
 * ahead (1.4–4.5 px at 30 Hz). ORCA instead has each pair split the correction
 * 50/50 in velocity space over a horizon of ~1 s, which is what produces a stream
 * through a narrow pass rather than a shoving match.
 *
 * **Determinism.** This runs inside a lockstep simulation, so:
 * - arithmetic is `+ - * /` and `Math.sqrt` only — never `Math.hypot`, which is an
 *   algorithm rather than an operation and disagrees in the last bit between
 *   engines (see `utils/math.ts`, and `hygiene.test.ts` which enforces it);
 * - no trigonometry, no clock, no `Math.random`;
 * - **the order agents are registered in is part of the answer.** The linear
 *   program walks its constraints in order and stops at the first that cannot be
 *   satisfied, so two peers must register agents identically. The caller gets that
 *   from miniplex query order, which is spawn order, which lockstep pins.
 *
 * **Zero allocation.** Every buffer is allocated once in `ensureCapacity` and
 * reused for the life of the match. `solve` creates no object, array or closure —
 * every intermediate vector is a pair of `const` numbers in function scope. That
 * is a hard requirement, not an aspiration: this runs 30 times a second for the
 * whole match, and `solver.test.ts` asserts the buffers never move.
 *
 * Transcribed from van den Berg et al.'s RVO2 reference implementation, with the
 * per-agent time horizon and the passive-agent rule noted at their call sites.
 */

/** How many agent+wall constraints one agent can carry beyond the other agents. */
const WALL_SLOTS = 8;

const RVO_EPSILON = 1e-5;

export interface OrcaSolver {
  /** Drops last tick's agents. Does not reallocate. */
  beginTick(dt: number): void;
  /** Grows the buffers to hold `n` agents. Idempotent; a no-op after warm-up. */
  ensureCapacity(n: number): void;
  /**
   * Registers one agent and returns its index. **Registration order is part of the
   * answer** — see the determinism note above.
   *
   * `invTau` is `1 / timeHorizon` for this agent; `passive` marks an agent that
   * will not solve and will not yield, so movers take the whole correction against
   * it (a disabled hull, or one landing exactly on its waypoint).
   */
  addAgent(
    px: number, py: number,
    vx: number, vy: number,
    prefX: number, prefY: number,
    radius: number, maxSpeed: number,
    invTau: number, passive: boolean,
  ): number;
  /** One static half-plane for `agent`: outward normal `(nx,ny)`, cap on `v·n`. */
  addWall(agent: number, nx: number, ny: number, limit: number): void;
  /** Solves every non-passive agent, filling `newVelX`/`newVelY`. */
  solve(neighborDistSq: number): void;

  readonly count: number;
  readonly newVelX: Float64Array;
  readonly newVelY: Float64Array;
  /** 1 where the constraints were infeasible and LP3 chose least-penetrating. */
  readonly fellBack: Uint8Array;
  /** Times the buffers were (re)allocated — `solver.test.ts` asserts this stays 1. */
  readonly allocations: number;
  /** How many wall half-planes `agent` is carrying. For tests and diagnostics. */
  wallCountOf(agent: number): number;
  /** Cumulative agents solved, and how many of those needed the LP3 fallback. */
  readonly solveCount: number;
  readonly fallbackCount: number;
}

export function createOrcaSolver(initialCapacity = 64): OrcaSolver {
  let cap = 0;
  let count = 0;
  let invDt = 30;
  let allocations = 0;
  let solveCount = 0;
  let fallbackCount = 0;

  let posX = new Float64Array(0);
  let posY = new Float64Array(0);
  let velX = new Float64Array(0);
  let velY = new Float64Array(0);
  let prefX = new Float64Array(0);
  let prefY = new Float64Array(0);
  let radius = new Float64Array(0);
  let maxSpeed = new Float64Array(0);
  let invTau = new Float64Array(0);
  let passive = new Uint8Array(0);
  let newVelX = new Float64Array(0);
  let newVelY = new Float64Array(0);
  let fellBack = new Uint8Array(0);

  // Walls, CSR-style: agent `i` owns slots [i*WALL_SLOTS, i*WALL_SLOTS + wallCount[i]).
  let wallCount = new Int32Array(0);
  let wallNX = new Float64Array(0);
  let wallNY = new Float64Array(0);
  let wallLimit = new Float64Array(0);

  // Per-agent constraint scratch, reused across agents by resetting `lineCount`.
  let linePX = new Float64Array(0);
  let linePY = new Float64Array(0);
  let lineDX = new Float64Array(0);
  let lineDY = new Float64Array(0);
  let projPX = new Float64Array(0);
  let projPY = new Float64Array(0);
  let projDX = new Float64Array(0);
  let projDY = new Float64Array(0);

  function ensureCapacity(n: number): void {
    if (n <= cap) return;
    let next = cap === 0 ? initialCapacity : cap;
    while (next < n) next *= 2;
    cap = next;
    allocations++;

    posX = new Float64Array(cap);
    posY = new Float64Array(cap);
    velX = new Float64Array(cap);
    velY = new Float64Array(cap);
    prefX = new Float64Array(cap);
    prefY = new Float64Array(cap);
    radius = new Float64Array(cap);
    maxSpeed = new Float64Array(cap);
    invTau = new Float64Array(cap);
    passive = new Uint8Array(cap);
    newVelX = new Float64Array(cap);
    newVelY = new Float64Array(cap);
    fellBack = new Uint8Array(cap);

    wallCount = new Int32Array(cap);
    wallNX = new Float64Array(cap * WALL_SLOTS);
    wallNY = new Float64Array(cap * WALL_SLOTS);
    wallLimit = new Float64Array(cap * WALL_SLOTS);

    const lines = cap + WALL_SLOTS;
    linePX = new Float64Array(lines);
    linePY = new Float64Array(lines);
    lineDX = new Float64Array(lines);
    lineDY = new Float64Array(lines);
    projPX = new Float64Array(lines);
    projPY = new Float64Array(lines);
    projDX = new Float64Array(lines);
    projDY = new Float64Array(lines);
  }

  ensureCapacity(initialCapacity);

  function beginTick(step: number): void {
    count = 0;
    invDt = 1 / step;
  }

  function addAgent(
    px: number, py: number,
    vx: number, vy: number,
    pfx: number, pfy: number,
    r: number, speed: number,
    tauInv: number, isPassive: boolean,
  ): number {
    ensureCapacity(count + 1);
    const i = count++;
    posX[i] = px;
    posY[i] = py;
    velX[i] = vx;
    velY[i] = vy;
    prefX[i] = pfx;
    prefY[i] = pfy;
    radius[i] = r;
    maxSpeed[i] = speed;
    invTau[i] = tauInv;
    passive[i] = isPassive ? 1 : 0;
    wallCount[i] = 0;
    fellBack[i] = 0;
    newVelX[i] = pfx;
    newVelY[i] = pfy;
    return i;
  }

  function addWall(agent: number, nx: number, ny: number, limit: number): void {
    const n = wallCount[agent];
    if (n >= WALL_SLOTS) return;
    const slot = agent * WALL_SLOTS + n;
    wallNX[slot] = nx;
    wallNY[slot] = ny;
    wallLimit[slot] = limit;
    wallCount[agent] = n + 1;
  }

  // --- the linear program -------------------------------------------------
  // Result of the 1-D and 2-D programs is written here rather than returned as a
  // pair, so nothing allocates.
  let resX = 0;
  let resY = 0;

  /**
   * The 1-D program: the best point on line `k` that satisfies lines `0..k-1` and
   * lies inside the speed circle. Returns false when that segment is empty.
   */
  function linearProgram1(
    k: number, speed: number,
    optX: number, optY: number,
    directionOpt: boolean,
    lpx: Float64Array, lpy: Float64Array, ldx: Float64Array, ldy: Float64Array,
  ): boolean {
    const dotProduct = lpx[k] * ldx[k] + lpy[k] * ldy[k];
    const discriminantSq = dotProduct * dotProduct + speed * speed - (lpx[k] * lpx[k] + lpy[k] * lpy[k]);
    if (discriminantSq < 0) return false; // the line misses the speed circle entirely

    const discriminant = Math.sqrt(discriminantSq);
    let tLeft = -dotProduct - discriminant;
    let tRight = -dotProduct + discriminant;

    for (let i = 0; i < k; i++) {
      const denominator = ldx[k] * ldy[i] - ldy[k] * ldx[i];
      const numerator = ldx[i] * (lpy[i] - lpy[k]) - ldy[i] * (lpx[i] - lpx[k]);

      if (Math.abs(denominator) <= RVO_EPSILON) {
        // Lines are parallel: either constraint `i` already excludes this whole
        // line, or it is irrelevant to it.
        if (numerator < 0) return false;
        continue;
      }

      const t = numerator / denominator;
      if (denominator >= 0) tRight = Math.min(tRight, t);
      else tLeft = Math.max(tLeft, t);
      if (tLeft > tRight) return false;
    }

    if (directionOpt) {
      // Optimising a direction rather than a point: take whichever end of the
      // segment goes furthest that way.
      const t = optX * ldx[k] + optY * ldy[k] > 0 ? tRight : tLeft;
      resX = lpx[k] + t * ldx[k];
      resY = lpy[k] + t * ldy[k];
      return true;
    }

    let t = ldx[k] * (optX - lpx[k]) + ldy[k] * (optY - lpy[k]);
    if (t < tLeft) t = tLeft;
    else if (t > tRight) t = tRight;
    resX = lpx[k] + t * ldx[k];
    resY = lpy[k] + t * ldy[k];
    return true;
  }

  /**
   * The 2-D program: the feasible velocity closest to `(optX,optY)`. Returns the
   * number of lines satisfied — `n` on success, or the index of the first
   * infeasible one.
   */
  function linearProgram2(
    n: number, speed: number,
    optX: number, optY: number,
    directionOpt: boolean,
    lpx: Float64Array, lpy: Float64Array, ldx: Float64Array, ldy: Float64Array,
  ): number {
    if (directionOpt) {
      // `opt` is a unit direction: start on the rim of the speed circle.
      resX = optX * speed;
      resY = optY * speed;
    } else if (optX * optX + optY * optY > speed * speed) {
      const len = Math.sqrt(optX * optX + optY * optY);
      resX = (optX / len) * speed;
      resY = (optY / len) * speed;
    } else {
      resX = optX;
      resY = optY;
    }

    for (let i = 0; i < n; i++) {
      // Left of the line is feasible; a positive determinant means we are right of it.
      if (ldx[i] * (lpy[i] - resY) - ldy[i] * (lpx[i] - resX) <= 0) continue;
      const tempX = resX;
      const tempY = resY;
      if (!linearProgram1(i, speed, optX, optY, directionOpt, lpx, lpy, ldx, ldy)) {
        resX = tempX;
        resY = tempY;
        return i;
      }
    }
    return n;
  }

  /**
   * The fallback: no velocity satisfies everything, so find the one that minimises
   * the worst penetration. Walls are passed as `numObstLines` and are never
   * relaxed — a unit may be allowed to clip a neighbour, never a rock.
   */
  function linearProgram3(n: number, numObstLines: number, beginLine: number, speed: number): void {
    let distance = 0;

    for (let i = beginLine; i < n; i++) {
      if (lineDX[i] * (linePY[i] - resY) - lineDY[i] * (linePX[i] - resX) <= distance) continue;

      let numProj = 0;
      for (let j = 0; j < numObstLines; j++) {
        projPX[numProj] = linePX[j];
        projPY[numProj] = linePY[j];
        projDX[numProj] = lineDX[j];
        projDY[numProj] = lineDY[j];
        numProj++;
      }

      for (let j = numObstLines; j < i; j++) {
        const determinant = lineDX[i] * lineDY[j] - lineDY[i] * lineDX[j];
        let px: number;
        let py: number;

        if (Math.abs(determinant) <= RVO_EPSILON) {
          // Parallel constraints: if they face the same way, `j` adds nothing.
          if (lineDX[i] * lineDX[j] + lineDY[i] * lineDY[j] > 0) continue;
          px = (linePX[i] + linePX[j]) * 0.5;
          py = (linePY[i] + linePY[j]) * 0.5;
        } else {
          const t = (lineDX[j] * (linePY[i] - linePY[j]) - lineDY[j] * (linePX[i] - linePX[j])) / determinant;
          px = linePX[i] + t * lineDX[i];
          py = linePY[i] + t * lineDY[i];
        }

        let dx = lineDX[j] - lineDX[i];
        let dy = lineDY[j] - lineDY[i];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len <= RVO_EPSILON) continue;
        dx /= len;
        dy /= len;

        projPX[numProj] = px;
        projPY[numProj] = py;
        projDX[numProj] = dx;
        projDY[numProj] = dy;
        numProj++;
      }

      const tempX = resX;
      const tempY = resY;
      // Push out along the constraint's inward normal as little as possible.
      if (linearProgram2(numProj, speed, -lineDY[i], lineDX[i], true, projPX, projPY, projDX, projDY) < numProj) {
        resX = tempX;
        resY = tempY;
      }
      distance = lineDX[i] * (linePY[i] - resY) - lineDY[i] * (linePX[i] - resX);
    }
  }

  function solve(neighborDistSq: number): void {
    for (let i = 0; i < count; i++) {
      if (passive[i] === 1) {
        newVelX[i] = velX[i];
        newVelY[i] = velY[i];
        continue;
      }

      let lineCount = 0;

      // Walls first, so LP3 can treat them as the constraints it may never relax.
      const wallBase = i * WALL_SLOTS;
      for (let w = 0; w < wallCount[i]; w++) {
        const nx = wallNX[wallBase + w];
        const ny = wallNY[wallBase + w];
        const limit = wallLimit[wallBase + w];
        // `v·n >= limit` as a directed line: a point on the boundary, and a
        // direction whose **left** side is the feasible half-plane — which is what
        // `linearProgram2`'s determinant test reads. The rotation is `(ny, -nx)`,
        // not `(-ny, nx)`: the other one passes every test that only checks the
        // tangent and silently inverts the constraint, admitting exactly the
        // velocities it was added to forbid.
        linePX[lineCount] = nx * limit;
        linePY[lineCount] = ny * limit;
        lineDX[lineCount] = ny;
        lineDY[lineCount] = -nx;
        lineCount++;
      }
      const numObstLines = lineCount;

      const pxi = posX[i];
      const pyi = posY[i];
      const vxi = velX[i];
      const vyi = velY[i];
      const ri = radius[i];
      const tau = invTau[i];

      for (let j = 0; j < count; j++) {
        if (j === i) continue;
        const rpx = posX[j] - pxi;
        const rpy = posY[j] - pyi;
        const distSq = rpx * rpx + rpy * rpy;
        if (distSq > neighborDistSq) continue;

        const rvx = vxi - velX[j];
        const rvy = vyi - velY[j];
        const combined = ri + radius[j];
        const combinedSq = combined * combined;

        let dirX: number;
        let dirY: number;
        let ux: number;
        let uy: number;

        if (distSq > combinedSq) {
          // Not touching yet: the velocity obstacle is a truncated cone.
          const wx = rvx - tau * rpx;
          const wy = rvy - tau * rpy;
          const wLengthSq = wx * wx + wy * wy;
          const dotProduct1 = wx * rpx + wy * rpy;

          if (dotProduct1 < 0 && dotProduct1 * dotProduct1 > combinedSq * wLengthSq) {
            // In front of the cut-off circle: project onto it.
            const wLength = Math.sqrt(wLengthSq);
            const unitWX = wx / wLength;
            const unitWY = wy / wLength;
            dirX = unitWY;
            dirY = -unitWX;
            const u = combined * tau - wLength;
            ux = u * unitWX;
            uy = u * unitWY;
          } else {
            // Project onto whichever leg of the cone is nearer.
            const leg = Math.sqrt(distSq - combinedSq);
            if (rpx * wy - rpy * wx > 0) {
              dirX = (rpx * leg - rpy * combined) / distSq;
              dirY = (rpx * combined + rpy * leg) / distSq;
            } else {
              dirX = -(rpx * leg + rpy * combined) / distSq;
              dirY = (rpx * combined - rpy * leg) / distSq;
            }
            const dotProduct2 = rvx * dirX + rvy * dirY;
            ux = dotProduct2 * dirX - rvx;
            uy = dotProduct2 * dirY - rvy;
          }
        } else {
          // Already overlapping: get out within one step, not within tau.
          const wx = rvx - invDt * rpx;
          const wy = rvy - invDt * rpy;
          const wLength = Math.sqrt(wx * wx + wy * wy);
          const unitWX = wx / wLength;
          const unitWY = wy / wLength;
          dirX = unitWY;
          dirY = -unitWX;
          const u = combined * invDt - wLength;
          ux = u * unitWX;
          uy = u * unitWY;
        }

        // The reciprocity split. Half each against another mover — that shared
        // correction is what makes a stream instead of a shoving match. A passive
        // neighbour will not move aside, so the mover takes all of it.
        const share = passive[j] === 1 ? 1.0 : 0.5;
        linePX[lineCount] = vxi + share * ux;
        linePY[lineCount] = vyi + share * uy;
        lineDX[lineCount] = dirX;
        lineDY[lineCount] = dirY;
        lineCount++;
      }

      const speed = maxSpeed[i];
      const solved = linearProgram2(lineCount, speed, prefX[i], prefY[i], false, linePX, linePY, lineDX, lineDY);
      solveCount++;
      if (solved < lineCount) {
        linearProgram3(lineCount, numObstLines, solved, speed);
        fellBack[i] = 1;
        fallbackCount++;
      }
      newVelX[i] = resX;
      newVelY[i] = resY;
    }
  }

  return {
    beginTick,
    ensureCapacity,
    addAgent,
    addWall,
    solve,
    wallCountOf: (agent: number) => wallCount[agent],
    get solveCount() {
      return solveCount;
    },
    get fallbackCount() {
      return fallbackCount;
    },
    get count() {
      return count;
    },
    get newVelX() {
      return newVelX;
    },
    get newVelY() {
      return newVelY;
    },
    get fellBack() {
      return fellBack;
    },
    get allocations() {
      return allocations;
    },
  };
}
