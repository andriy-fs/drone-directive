import { describe, expect, it } from 'vitest';
import { cliffGeometry, type CliffOptions } from './cliffs';
import type { Contour, ContourPoint } from './contours';

const HEIGHT = 22;

const options: CliffOptions = {
  height: HEIGHT,
  repeatPx: 128,
  facingLo: 0.15,
  facingHi: 0.7,
  apron: 0,
  apronV0: 0.78,
  scree: { perPx: 0, minSize: 5, maxSize: 11, spread: 14 },
};

/**
 * A closed outline whose normals turn once around the compass, sampled every 8 px —
 * a stand-in for the loop `clusterContours` traces, built by hand so a test can say
 * exactly which stretch faces south.
 */
function ring(count = 32, radius = 64): Contour {
  const points: ContourPoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    points.push({ x: 200 + nx * radius, y: 200 + ny * radius, nx, ny, s: (i / count) * 2 * Math.PI * radius });
  }
  return { points, length: 2 * Math.PI * radius, hole: false, key: { cx: 3, cy: 5 } };
}

function attribute(geometry: NonNullable<ReturnType<typeof cliffGeometry>>, name: string): Float32Array {
  const buffer = geometry.attributes[name].buffer;
  if (typeof buffer === 'number' || Array.isArray(buffer)) throw new Error('expected a typed array');
  return buffer.data as Float32Array;
}

describe('cliffGeometry', () => {
  it('draws nothing where the outline is not turned away from the light', () => {
    // A ring that faces north everywhere is the top of the rock, not a wall.
    const north = ring();
    for (const p of north.points) {
      p.ny = -1;
      p.nx = 0;
    }
    expect(cliffGeometry([north], options)).toBeNull();
  });

  it('keeps the wall to the south-facing arc', () => {
    const geometry = cliffGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    // Half a ring faces south at all; each sample there is two vertices, and the arc
    // carries one sample of zero facing at each end where it tapers out.
    const alpha = attribute(geometry, 'aAlpha');
    expect(alpha.length).toBeLessThan(ring().points.length * 2);
    expect(Math.max(...alpha)).toBeCloseTo(1, 6);
    expect(Math.min(...alpha)).toBe(0);
  });

  it('anchors v at the base of the sheet, so a short wall shows its foot', () => {
    const geometry = cliffGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const v = attribute(geometry, 'aV');
    const lip = attribute(geometry, 'aLip');
    const alpha = attribute(geometry, 'aAlpha');

    for (let i = 0; i < v.length; i++) {
      if (lip[i] === 1) {
        // Top of the wall: v is 1 minus how much of the sheet's height it stands.
        expect(v[i]).toBeCloseTo(1 - alpha[i], 6);
      } else {
        // Base of the wall — always the bottom of the sheet, whatever the height.
        expect(v[i]).toBe(1);
      }
    }
    // A full-height stretch shows the sheet from its very top.
    expect(Math.min(...v)).toBeCloseTo(0, 6);
  });

  it('runs u along the contour rather than restarting', () => {
    const geometry = cliffGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const u = attribute(geometry, 'aU');
    // Two vertices per sample, both at the same u, and u only ever climbs — which is
    // what makes a wall stepping down a staircase one continuous strip of art.
    for (let i = 2; i < u.length; i += 2) {
      expect(u[i]).toBeGreaterThan(u[i - 2]);
      expect(u[i]).toBe(u[i + 1]);
    }
  });

  it('marks only the top of the wall as the lip', () => {
    const geometry = cliffGeometry([ring()], { ...options, apron: 7 });
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const lip = attribute(geometry, 'aLip');
    // One vertex in four is a wall top once the apron is on; nothing else may carry a
    // lip, or the shader would draw a highlight across loose rubble.
    expect(lip.filter((v) => v === 1)).toHaveLength(lip.length / 4);
    for (let i = 0; i < lip.length; i++) expect(lip[i]).toBe(i % 4 === 0 ? 1 : 0);
  });
});
