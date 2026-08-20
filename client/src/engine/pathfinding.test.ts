import { describe, expect, it } from 'vitest';
import { gameConfig } from '../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { hasClearance, tileCentre, type ObstacleGrid } from './obstacles';
import { findPath, smoothPath } from './pathfinding';

/**
 * `smoothPath` is what stops a robot driving the staircase `findPath` returns.
 * The staircase is not a cosmetic problem: it swings half a tile either side of
 * the line the robot wants, and every zag is another obstacle edge to hit — worth
 * ~26% of all anti-jam retreats when it was removed
 * (`.docs/tasks/local-avoidance.md`). The invariants that keep it honest are
 * "never cuts through rock" and "still ends exactly where it was asked to".
 */

const RADIUS = gameConfig.robots.radius;

/** Open ground with the listed tiles blocked. */
function grid(blocked: [number, number][] = []): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  const g: ObstacleGrid = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  for (const [tx, ty] of blocked) g[ty][tx] = true;
  return g;
}

/** Total length of the polyline `from` → …points. */
function length(from: Vec2, points: readonly Vec2[]): number {
  let total = 0;
  let prev = from;
  for (const p of points) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

describe('smoothPath', () => {
  it('collapses a diagonal staircase to one straight leg over open ground', () => {
    const g = grid();
    const from = tileCentre(2, 2);
    const to = tileCentre(12, 12);
    const raw = findPath(g, from, to);
    expect(raw.length).toBeGreaterThan(5); // A* really does return a staircase

    const smooth = smoothPath(g, from, raw, RADIUS);
    expect(smooth).toHaveLength(1);
    expect(smooth[0]).toEqual(to);
  });

  it('never cuts a corner a hull cannot drive through', () => {
    // A wall with one gap, so the route has to bend around something real.
    const blocked: [number, number][] = [];
    for (let ty = 0; ty < 10; ty++) blocked.push([8, ty]);
    const g = grid(blocked);
    const from = tileCentre(3, 3);
    const to = tileCentre(14, 3);

    const smooth = smoothPath(g, from, findPath(g, from, to), RADIUS);
    let prev = from;
    for (const p of smooth) {
      expect(hasClearance(g, prev, p, RADIUS)).toBe(true);
      prev = p;
    }
  });

  it('is never longer than the staircase it replaces, and keeps the exact goal', () => {
    const blocked: [number, number][] = [];
    for (let ty = 0; ty < 10; ty++) blocked.push([8, ty]);
    const g = grid(blocked);
    const from = tileCentre(3, 3);
    const to = { x: 14 * gameConfig.grid.tilePx + 7, y: 3 * gameConfig.grid.tilePx + 11 };

    const raw = findPath(g, from, to);
    const smooth = smoothPath(g, from, raw, RADIUS);

    expect(smooth.length).toBeLessThanOrEqual(raw.length);
    expect(length(from, smooth)).toBeLessThanOrEqual(length(from, raw) + 1e-6);
    // The last waypoint is the caller's own point, untouched — anything that
    // needs an exact stop (a formation slot, a rally point) depends on it.
    expect(smooth[smooth.length - 1]).toEqual(to);
  });

  it('passes an empty path through, so "no route" stays "no route"', () => {
    expect(smoothPath(grid(), tileCentre(1, 1), [], RADIUS)).toEqual([]);
  });

  it('keeps the escape hop when it starts inside rock, and straightens only the tail', () => {
    // `findPath` prefixes a hop out of a blocked start — the only thing that
    // unfreezes a robot shoved inside a base footprint. `hasClearance` samples
    // its own anchor first, so from inside rock every candidate fails and the hop
    // survives by construction, not by luck. This test is what makes that a rule.
    const g = grid([[5, 5]]);
    const from = tileCentre(5, 5);
    const raw = findPath(g, from, tileCentre(16, 12));
    const smooth = smoothPath(g, from, raw, RADIUS);

    expect(smooth[0]).toEqual(raw[0]); // the hop, untouched
    expect(smooth.length).toBeLessThan(raw.length); // the tail, straightened
    let prev = raw[0];
    for (const p of smooth.slice(1)) {
      expect(hasClearance(g, prev, p, RADIUS)).toBe(true);
      prev = p;
    }
  });
});
