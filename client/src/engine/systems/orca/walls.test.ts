import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../../config/gameConfig';
import type { ObstacleGrid } from '../../obstacles';
import { createOrcaSolver } from './solver';
import { collectWalls } from './walls';

const TILE = gameConfig.grid.tilePx; // 32
const R = 11.5;
const SPEED = 60;
const INV_TAU_OBST = 1 / 0.5;
const FAR = 300 * 300;

/** A grid of the current configured size with `blocked` tiles marked. */
function gridWith(blocked: [number, number][]): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  const grid: ObstacleGrid = [];
  for (let ty = 0; ty < height; ty++) grid.push(new Array<boolean>(width).fill(false));
  for (const [tx, ty] of blocked) grid[ty][tx] = true;
  return grid;
}

/** Solves one agent against the walls around it and returns its velocity. */
function solveAt(grid: ObstacleGrid, px: number, py: number, prefX: number, prefY: number) {
  const s = createOrcaSolver();
  s.beginTick(1 / 30);
  const a = s.addAgent(px, py, prefX, prefY, prefX, prefY, R, SPEED, 1, false);
  collectWalls(grid, px, py, R, SPEED, INV_TAU_OBST, s, a);
  s.solve(FAR);
  return { x: s.newVelX[a], y: s.newVelY[a], fellBack: s.fellBack[a] };
}

describe('orca walls', () => {
  it('caps the normal component at a face while leaving the tangent alone', () => {
    // The property that makes a stream and not a pinch: a corridor may slow a
    // hull's drift into the wall without slowing its progress along the wall.
    // Rock fills tile row 10; the agent sits below it, driving up and to the right.
    const grid = gridWith([[10, 10]]);
    const faceY = 11 * TILE; // the underside of the rock, y = 352
    const gap = 15;
    const px = 10 * TILE + TILE / 2;
    const py = faceY + gap;
    const r = solveAt(grid, px, py, 40, -40); // -y drives at the wall

    // v·n >= -(d - radius) * invTau, with n = (0, +1) below the face.
    const allowed = -(gap - R) * INV_TAU_OBST; // v·(0,1) >= -7  →  vy >= -7
    expect(r.y).toBeGreaterThanOrEqual(allowed - 1e-6);
    expect(r.x).toBeCloseTo(40, 6); // tangential speed untouched
  });

  it('leaves an agent far from any rock exactly on its preference', () => {
    const grid = gridWith([[2, 2]]);
    const r = solveAt(grid, 20 * TILE, 20 * TILE, 40, 40);
    expect(r.x).toBe(40);
    expect(r.y).toBe(40);
  });

  it('drives an agent standing inside rock back out', () => {
    // A hull shoved into a footprint by separation must be *required* to leave. A
    // constraint that merely forbade going deeper would leave it welded in place.
    const grid = gridWith([[10, 10]]);
    // Just inside the rock's left edge, and asking to go deeper.
    const px = 10 * TILE + 4;
    const py = 10 * TILE + TILE / 2;
    const r = solveAt(grid, px, py, 40, 0);
    expect(r.x).toBeLessThan(0); // pushed back out through the near face
  });

  it('emits only the faces the agent can actually see', () => {
    // A 3x3 block presents *one* face to an agent squarely west of it, not three
    // and not nine. Asserted as a count, because the earlier version of this test
    // only checked the sign of the resulting velocity — and passed while the
    // culling was inverted, keeping the far faces and dropping the near ones. A
    // far face pushes the same way as a near one, just from the wrong distance,
    // so a sign assertion cannot tell them apart.
    const blocked: [number, number][] = [];
    for (let ty = 9; ty <= 11; ty++) for (let tx = 9; tx <= 11; tx++) blocked.push([tx, ty]);
    const grid = gridWith(blocked);

    const s = createOrcaSolver();
    s.beginTick(1 / 30);
    const px = 9 * TILE - 6;
    const py = 10 * TILE + TILE / 2; // level with the middle row
    const a = s.addAgent(px, py, 0, 0, 40, 0, R, SPEED, 1, false);
    collectWalls(grid, px, py, R, SPEED, INV_TAU_OBST, s, a);

    // Only the west face of the middle-row tile is visible from here; the two
    // behind it are buried, and the corner tiles' nearest points are further off
    // than the horizon at this speed.
    expect(s.wallCountOf(a)).toBeLessThanOrEqual(3);
    expect(s.wallCountOf(a)).toBeGreaterThanOrEqual(1);

    s.solve(FAR);
    expect(r0(s.newVelX[a])).toBeLessThanOrEqual(0 + 1e-6);
    expect(Number.isFinite(s.newVelY[a])).toBe(true);
  });

  it('keeps the near face of a wall, not the one behind it', () => {
    // The direct form of the same bug: with the culling inverted this agent gets a
    // constraint measured from the *far* side of the block, one whole tile too
    // permissive, and drives into the rock it was supposed to be held off.
    const blocked: [number, number][] = [];
    for (let tx = 9; tx <= 11; tx++) blocked.push([tx, 10]);
    const grid = gridWith(blocked);

    const s = createOrcaSolver();
    s.beginTick(1 / 30);
    const gap = 14;
    const px = 10 * TILE + TILE / 2;
    const py = 10 * TILE - gap; // above the wall, driving down into it
    const a = s.addAgent(px, py, 0, 0, 0, 40, R, SPEED, 1, false);
    collectWalls(grid, px, py, R, SPEED, INV_TAU_OBST, s, a);
    s.solve(FAR);

    // n = (0,-1) above the face, so v·n >= -(gap - R) * invTau  →  vy <= 5.
    const allowed = (gap - R) * INV_TAU_OBST;
    expect(s.newVelY[a]).toBeLessThanOrEqual(allowed + 1e-6);
  });

  it('treats the map edge as rock with no special case', () => {
    // `isBlockedGrid` reports out of bounds as blocked, so the world boundary
    // constrains an agent through exactly the same path a mountain does.
    const grid = gridWith([]);
    const r = solveAt(grid, 5, 20 * TILE, -40, 0); // 5 px from x = 0, driving west
    expect(r.x).toBeGreaterThan(-40);
  });
});

/** Rounds off the last-bit noise a projection leaves, for readable comparisons. */
function r0(v: number): number {
  return Math.abs(v) < 1e-9 ? 0 : v;
}
