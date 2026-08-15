import { Geometry } from 'pixi.js';

/**
 * Accumulates axis-aligned or extruded quads into one `Geometry`, with a single
 * float carried per vertex.
 *
 * This exists because the terrain's shading used to be *drawn* rather than
 * *interpolated*: the depth gradient was thousands of `Graphics` rects, each tile
 * split 3×3 and quantised into six alpha buckets, because a `Graphics` fill has
 * one colour and cannot ramp across a shape. A mesh can — the rasteriser
 * interpolates vertex attributes for free — so the gradient becomes one float per
 * corner and the entire layer disappears. It also comes out smoother than the
 * geometry it replaces, since the ramp is now per-pixel rather than in ~11 px steps.
 *
 * Vertices are not shared between quads. Sharing them would save a little memory
 * and cost the ability to give two neighbouring tiles different values at the same
 * corner, which is exactly what the boundary rim and the shadow skirt need.
 */
export class QuadBuilder {
  private readonly positions: number[] = [];
  private readonly values: number[] = [];
  private readonly indices: number[] = [];

  /** Corners must be given in order around the quad (winding is irrelevant, both faces draw). */
  add(
    x0: number,
    y0: number,
    v0: number,
    x1: number,
    y1: number,
    v1: number,
    x2: number,
    y2: number,
    v2: number,
    x3: number,
    y3: number,
    v3: number,
  ): void {
    const base = this.positions.length / 2;
    this.positions.push(x0, y0, x1, y1, x2, y2, x3, y3);
    this.values.push(v0, v1, v2, v3);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An axis-aligned tile-sized quad whose four corner values come from a lookup. */
  addTile(x: number, y: number, size: number, corner: (cx: number, cy: number) => number, cx: number, cy: number): void {
    this.add(
      x,
      y,
      corner(cx, cy),
      x + size,
      y,
      corner(cx + 1, cy),
      x + size,
      y + size,
      corner(cx + 1, cy + 1),
      x,
      y + size,
      corner(cx, cy + 1),
    );
  }

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /** `attribute` is the name the vertex shader reads the per-vertex float under. */
  build(attribute: string): Geometry {
    return new Geometry({
      attributes: {
        aPosition: { buffer: new Float32Array(this.positions), format: 'float32x2' },
        [attribute]: { buffer: new Float32Array(this.values), format: 'float32' },
      },
      indexBuffer: new Uint32Array(this.indices),
    });
  }
}
