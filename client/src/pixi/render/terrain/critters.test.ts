import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';
import { CritterKind } from '../../../config/sprites';
import { critterAnchors } from './critters';
import { depthField, findClusters, peakAnchors, PEAK_SEPARATION } from './clusters';

function field(w: number, h: number): TerrainGrid {
  return Array.from({ length: h }, () => new Array<TerrainKind>(w).fill(TerrainKind.Open));
}

/** Stamps a solid rectangle of one kind. A 9×9 block is the smallest that qualifies comfortably. */
function block(grid: TerrainGrid, kind: TerrainKind, x0: number, y0: number, size: number): TerrainGrid {
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) grid[y][x] = kind;
  return grid;
}

describe('critterAnchors', () => {
  it('puts one critter deep inside a large mountain plateau', () => {
    const terrain = block(field(13, 13), TerrainKind.Mountain, 2, 2, 9);
    const [anchor, ...rest] = critterAnchors(terrain);

    expect(rest).toHaveLength(0);
    expect(terrain[anchor.ty][anchor.tx]).toBe(TerrainKind.Mountain);
    // Rock on all eight sides, so the art sits wholly on stone rather than overhanging.
    const [cluster] = findClusters(terrain);
    expect(depthField(cluster).at(anchor.tx, anchor.ty)).toBeGreaterThanOrEqual(2);
  });

  it('never places more than two, however many plateaus qualify', () => {
    let terrain = field(31, 13);
    terrain = block(terrain, TerrainKind.Mountain, 1, 2, 9);
    terrain = block(terrain, TerrainKind.Mountain, 11, 2, 9);
    terrain = block(terrain, TerrainKind.Mountain, 21, 2, 9);

    expect(critterAnchors(terrain)).toHaveLength(2);
  });

  it('leaves a plateau too small to hold one empty', () => {
    // 16 tiles: deep enough at its centre, but a bump rather than a place with a middle.
    expect(critterAnchors(block(field(9, 9), TerrainKind.Mountain, 2, 2, 4))).toEqual([]);
  });

  it('leaves a thin ridge empty however long it runs', () => {
    // Every tile of a 2-wide wall is a boundary tile, so nothing on it is ever inside.
    const terrain = field(24, 7);
    for (let y = 3; y < 5; y++) for (let x = 1; x < 23; x++) terrain[y][x] = TerrainKind.Mountain;
    expect(critterAnchors(terrain)).toEqual([]);
  });

  it('ignores craters — a pit is not a plateau', () => {
    expect(critterAnchors(block(field(13, 13), TerrainKind.Crater, 2, 2, 9))).toEqual([]);
  });

  it('keeps clear of the ridge decals', () => {
    // Both are placed at the thickest part of the same depth field, so without the
    // clearance a 90 px summit lands straight on top of the creature.
    const terrain = block(field(13, 13), TerrainKind.Mountain, 2, 2, 9);
    const [cluster] = findClusters(terrain);
    const peaks = peakAnchors(cluster, depthField(cluster), PEAK_SEPARATION);
    expect(peaks.length).toBeGreaterThan(0);

    for (const anchor of critterAnchors(terrain)) {
      for (const peak of peaks) {
        expect(Math.max(Math.abs(peak.tx - anchor.tx), Math.abs(peak.ty - anchor.ty))).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('is deterministic — two peers on one seed must see the same creatures', () => {
    const terrain = block(block(field(31, 13), TerrainKind.Mountain, 1, 2, 9), TerrainKind.Mountain, 11, 2, 9);
    expect(critterAnchors(terrain)).toEqual(critterAnchors(terrain));
  });

  it('gives every critter a real species, its own phase and only a hint of rotation', () => {
    const terrain = block(field(13, 13), TerrainKind.Mountain, 2, 2, 9);
    for (const anchor of critterAnchors(terrain)) {
      expect(Object.values(CritterKind)).toContain(anchor.kind);
      expect(anchor.phase).toBeGreaterThanOrEqual(0);
      expect(anchor.phase).toBeLessThan(1);
      expect(Math.abs(anchor.jitter)).toBeLessThanOrEqual(0.12);
    }
  });
});
