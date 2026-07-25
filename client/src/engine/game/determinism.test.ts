import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type GameSettings } from '../../config/gameSettings';
import type { ObstacleGrid } from '../obstacles';
import { GameEngine } from './engine';

/**
 * The lockstep networking premise: two peers that start from the same seed and
 * apply the same inputs must simulate bit-identical worlds. These tests run two
 * independent engines through the deterministic pipeline (online mode, so the bot
 * AI is gated off) and assert the resulting state matches for equal seeds and
 * diverges for different ones.
 */

const DT = 1 / 30;
const SEED = 0x1234abcd;

function onlineSettings(): GameSettings {
  const s = createDefaultSettings();
  s.match.online = true;
  return s;
}

interface UnitSnap {
  id: string;
  owner: string;
  x: number;
  y: number;
  hp: number;
  targetId: string | null;
}

function snapshot(engine: GameEngine): UnitSnap[] {
  const world = engine.world;
  const units = [
    ...world.with('base', 'position').entities,
    ...world.with('robot', 'position').entities,
  ].map((e) => ({
    id: e.id,
    owner: e.owner ?? 'neutral',
    x: e.position.x,
    y: e.position.y,
    hp: e.hp ?? 0,
    targetId: e.targetId ?? null,
  }));
  return units.sort((a, b) => a.id.localeCompare(b.id));
}

function runMatch(seed: number, ticks: number): { units: UnitSnap[]; obstacles: ObstacleGrid } {
  const engine = new GameEngine();
  engine.startMatch(onlineSettings(), seed);
  const obstacles = engine.context!.obstacles;
  for (let i = 0; i < ticks; i++) engine.tick(DT);
  return { units: snapshot(engine), obstacles };
}

describe('lockstep determinism', () => {
  it('produces bit-identical world state for the same seed', () => {
    const a = runMatch(SEED, 150);
    const b = runMatch(SEED, 150);
    expect(b.units).toEqual(a.units);
    expect(b.obstacles).toEqual(a.obstacles);
  });

  it('generates a different battlefield for a different seed', () => {
    const a = runMatch(SEED, 0);
    const c = runMatch(SEED ^ 0x9e3779b9, 0);
    expect(c.obstacles).not.toEqual(a.obstacles);
  });
});
