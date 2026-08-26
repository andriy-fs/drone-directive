import { BufferImageSource, Texture } from 'pixi.js';
import type { FogState } from '../../../engine/game/context';

/**
 * The fog of war as a texture the wireframe shader can sample: one texel per tile,
 * one byte per texel, holding the weight a line at that tile is drawn at.
 *
 * **This is the reason the ground geometry can be static.** The mesh is the entire
 * map, built once per match, and drawing all of it would be a free survey of ground
 * this side has never approached. Masking it in the fragment stage keeps the
 * geometry untouched while the mask changes for the whole match — the alternative,
 * rebuilding the buffer whenever the fog moves, would put a full re-tessellation of
 * the map on the frame that a scout crests a ridge.
 *
 * `FogView` does the same job for the top view with `Graphics` rectangles and the
 * same `fog.version` redraw gate. It stays rectangles there because the top view
 * needs an *opaque* cover over remembered terrain; here the mask is a multiplier,
 * which is a texture's natural shape.
 *
 * Filtered **linearly**, not nearest. A grid line sits exactly on a tile boundary,
 * where nearest sampling picks one of the two neighbouring tiles essentially at
 * random and the edge of the explored region comes out ragged. Linear gives that
 * line the average of the two, so it fades in over its last tile. It cannot leak
 * intel: bilinear reaches half a tile past a texel centre, so a line one tile beyond
 * the explored boundary samples two unexplored texels and stays at zero.
 */

/** Weight for ground currently in sight — the mask is a multiplier, so full brightness. */
const VISIBLE = 255;
/** Explored but not currently seen: remembered relief, and clearly dimmer than live ground. */
const REMEMBERED = 92;

export class FpvFogMask {
  readonly texture: Texture;
  private readonly source: BufferImageSource;
  private readonly data: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  private lastVersion = -1;

  /** Sized in tiles, so it is rebuilt per match like the geometry it masks. */
  constructor(tilesX: number, tilesY: number) {
    this.width = Math.max(tilesX, 1);
    this.height = Math.max(tilesY, 1);
    this.data = new Uint8Array(this.width * this.height * 4);
    this.source = new BufferImageSource({
      resource: this.data,
      width: this.width,
      height: this.height,
      format: 'rgba8unorm',
      scaleMode: 'linear',
      addressMode: 'clamp-to-edge',
      // A tile is one texel; asking the GPU for a chain of ever-blurrier copies of
      // an 80×80 mask would only give the fade something wrong to interpolate.
      autoGenerateMipmaps: false,
    });
    this.texture = new Texture({ source: this.source });
  }

  /**
   * Re-upload when the mask has actually moved. `fog.version` is the engine's own
   * "something changed" flag — the same gate `FogView` uses, so the two views never
   * disagree about what this side has seen.
   */
  update(fog: FogState | null | undefined): void {
    if (!fog) {
      if (this.lastVersion === -1) return;
      this.data.fill(0);
      this.lastVersion = -1;
      this.source.update();
      return;
    }
    if (fog.version === this.lastVersion) return;
    this.lastVersion = fog.version;

    for (let ty = 0; ty < this.height; ty++) {
      const explored = fog.explored[ty];
      const visible = fog.visible[ty];
      for (let tx = 0; tx < this.width; tx++) {
        const weight = visible?.[tx] ? VISIBLE : explored?.[tx] ? REMEMBERED : 0;
        const i = (ty * this.width + tx) * 4;
        this.data[i] = weight;
        // Only the red channel is read, but alpha has to be opaque: the texture is
        // uploaded unpremultiplied and a zero alpha would take red down with it.
        this.data[i + 3] = 255;
      }
    }
    this.source.update();
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}
