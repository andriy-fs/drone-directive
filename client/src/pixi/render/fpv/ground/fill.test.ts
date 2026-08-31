import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../../../config/gameConfig';
import type { TerrainGrid } from '../../../../engine/obstacles';
import { surfaceFacets } from './fill';
import { heightField } from './geometry';

/**
 * The lit surface. What is checked here is what a screenshot cannot settle: that the
 * facets tile the map exactly, that they stand on the same corners the lattice is
 * stroked from — a surface half a pixel off its own wireframe is the one failure that
 * would read as a rendering fault rather than as a style — and that the shading
 * carries orientation rather than height, which is the whole point of a lit fill over
 * a coloured one.
 */

const O = TerrainKind.Open;
const M = TerrainKind.Mountain;

/** `.` open, `#` mountain, `o` crater — one character per tile. */
function grid(...rows: string[]): TerrainGrid {
  return rows.map((row) => [...row].map((c) => (c === '#' ? M : c === 'o' ? TerrainKind.Crater : O)));
}

const { tilePx } = gameConfig.grid;

describe('surfaceFacets', () => {
  it('covers every tile with two triangles', () => {
    const terrain = grid('....', '....', '....');
    expect(surfaceFacets(heightField(terrain))).toHaveLength(4 * 3 * 2);
  });

  it('stands on the same corners the lattice is drawn from', () => {
    // Not "close to" — the same numbers. The fill and the lines are two passes over
    // one height field, and any drift between them shows as the wireframe floating.
    const terrain = grid('.....', '.###.', '.###.', '.....');
    const h = heightField(terrain);
    for (const facet of surfaceFacets(h)) {
      for (const [x, y, height] of facet.corners) {
        expect(height).toBe(h.corner(Math.round(x / tilePx), Math.round(y / tilePx)));
      }
    }
  });

  it('lights a slope differently from the flat around it', () => {
    // The one thing a filled surface can say that a wireframe cannot.
    const terrain = grid('.....', '.###.', '.###.', '.....');
    const h = heightField(terrain);
    const shades = new Set(surfaceFacets(h).map((f) => f.shade.toFixed(4)));
    expect(shades.size).toBeGreaterThan(3);
  });

  it('never lets a facet go dark', () => {
    // A black facet reads as a hole in the ground rather than as a face turned away
    // from the light — see AMBIENT.
    const terrain = grid('.....', '.#o#.', '.o#o.', '.....');
    for (const facet of surfaceFacets(heightField(terrain))) {
      expect(facet.shade).toBeGreaterThan(0.3);
      expect(facet.shade).toBeLessThanOrEqual(1);
    }
  });

  it('shades flat ground almost evenly', () => {
    // Almost, not exactly: the micro-relief tilts every facet on the plain a little,
    // and that faint unevenness is what keeps a filled plain from reading as a sheet
    // of card. It must stay faint — a plain that flickered would be worse than a flat
    // one.
    const shades = surfaceFacets(heightField(grid('......', '......', '......', '......'))).map((f) => f.shade);
    const min = Math.min(...shades);
    const max = Math.max(...shades);
    expect(max - min).toBeLessThan(0.25); // MICRO_PX is set against this number
  });
});
