import { describe, expect, it } from 'vitest';
import { debrisGeometry, type DebrisOptions } from './debris';
import type { Contour, ContourPoint } from './contours';

/** `CORNERS` in `debris.ts` — duplicated, because a test that imports the number it checks checks nothing. */
const CORNERS = 6;

const options: DebrisOptions = {
  repeatPx: 192,
  facingLo: 0.15,
  facingHi: 0.7,
  scree: { perPx: 2 / 32, minSize: 5, maxSize: 11, spread: 14 },
  reach: 3,
};

/**
 * A closed outline whose normals turn once around the compass, sampled every 8 px —
 * a stand-in for the loop `clusterContours` traces, built by hand so a test can say
 * exactly which stretch faces south.
 */
function ring(count = 64, radius = 82): Contour {
  const points: ContourPoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    points.push({ x: 200 + nx * radius, y: 200 + ny * radius, nx, ny, s: (i / count) * 2 * Math.PI * radius });
  }
  return { points, length: 2 * Math.PI * radius, hole: false, key: { cx: 3, cy: 5 } };
}

function attribute(geometry: NonNullable<ReturnType<typeof debrisGeometry>>, name: string): Float32Array {
  const buffer = geometry.attributes[name].buffer;
  if (typeof buffer === 'number' || Array.isArray(buffer)) throw new Error('expected a typed array');
  return buffer.data as Float32Array;
}

describe('debrisGeometry', () => {
  it('draws nothing where the outline is turned toward the light', () => {
    const north = ring();
    for (const p of north.points) {
      p.nx = 0;
      p.ny = -1;
    }
    expect(debrisGeometry([north], options)).toBeNull();
  });

  it('gives every stone an irregular silhouette rather than a square', () => {
    const geometry = debrisGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const pos = attribute(geometry, 'aPosition');
    const stride = 2 * (CORNERS + 1);
    for (let i = 0; i < pos.length; i += stride) {
      const radii: number[] = [];
      for (let c = 1; c <= CORNERS; c++) {
        radii.push(Math.hypot(pos[i + 2 * c] - pos[i], pos[i + 2 * c + 1] - pos[i + 1]));
      }
      // A scatter of squares is the tile grid this layer exists to hide.
      expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii) * 1.05);
    }
  });

  it('drops its stones below the shaded side only', () => {
    const geometry = debrisGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const pos = attribute(geometry, 'aPosition');
    // Every stone lies south of the ring's centre, and outside it: rubble collects at
    // the foot of the faces turned away from the light, on open ground.
    for (let i = 0; i < pos.length; i += 2) {
      expect(pos[i + 1]).toBeGreaterThan(200);
      expect(Math.hypot(pos[i] - 200, pos[i + 1] - 200)).toBeGreaterThan(80);
    }
  });

  it('gives each stone its own crop of the fill', () => {
    const geometry = debrisGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const uv = attribute(geometry, 'aUv');
    const stride = 2 * (CORNERS + 1);
    const centres = new Set<string>();
    for (let i = 0; i < uv.length; i += stride) centres.add(`${uv[i]},${uv[i + 1]}`);
    // Sampling in world space would make a huddle of stones one continuous piece of
    // rock, which reads as a hole in the ground rather than as chips on top of it.
    expect(centres.size).toBe(uv.length / stride);
  });

  it('fades a stone by how far out it landed', () => {
    const geometry = debrisGeometry([ring()], options);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    const alpha = attribute(geometry, 'aAlpha');
    expect(Math.min(...alpha)).toBeGreaterThan(0);
    expect(Math.max(...alpha)).toBeLessThanOrEqual(0.9);
    // One alpha per stone, shared by its centre and every corner.
    const stride = CORNERS + 1;
    for (let i = 0; i < alpha.length; i += stride) {
      for (let c = 1; c < stride; c++) expect(alpha[i + c]).toBe(alpha[i]);
    }
  });

  it('scatters nothing when asked for no stones', () => {
    expect(debrisGeometry([ring()], { ...options, scree: { ...options.scree, perPx: 0 } })).toBeNull();
  });
});
