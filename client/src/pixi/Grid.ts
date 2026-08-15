import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { gameConfig, worldPixelSize } from '../config/gameConfig';
import { palette } from '../config/palette';
import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../engine/obstacles';
import { getGroundAltTexture, getGroundDecalTexture, getGroundTexture, groundDecalVariantCount } from './assets';
import { hashInt, hashRange, hashUnit } from './render/terrain/hash';
import { createGroundMesh } from './render/GroundMesh';
import { perfFlags } from './perf/perfFlags';

/**
 * The walkable ground surface for the whole field — the bottom-most thing drawn,
 * under terrain, units and projectiles. Static (built once per match).
 *
 * A single tile repeated across a 1280–2560 px field looks machine-made no matter
 * how seamless it is: seamlessness hides the *seam*, not the *period*, and a
 * uniform texture is uniform everywhere. Three things break that here, and only
 * the first is art the field can't do without:
 *
 * 1. variant A, tiled — the surface itself;
 * 2. variant B over it through a **procedural low-frequency mask**, so two periods
 *    with different phases are cross-faded by patches hundreds of pixels wide;
 * 3. **decals** — tracks, scrap, concrete, burn scars — placed individually.
 *    Recognisable objects can't live in the base tiles, because a recognisable
 *    object repeating every 256 px is precisely what proves the repeat.
 *
 * Everything past step 1 degrades cleanly: a missing texture just means that pass
 * is skipped.
 */

/** Texture tiles per grid cell for the ground surface (bump up for a broader, less-repetitive look). */
const GROUND_REPEAT_TILES = 8;

/** Resolution of the procedural blend mask, in cells. Low on purpose — these are broad drifts, not noise. */
const BLEND_MASK_CELLS = 12;
/** Cells apart the decal scatter tests candidate positions. */
const DECAL_STRIDE_TILES = 6;
/** Share of candidate positions that actually get a decal. */
const DECAL_CHANCE = 0.34;

/**
 * Builds the ground for one match.
 *
 * Takes the terrain because the decal scatter has to avoid it: a scrap pile drawn
 * under a mountain is wasted, and one drawn inside a base's clear margin sits on
 * the spawn apron the player reads most closely.
 */
export function createGround(terrain: TerrainGrid): Container {
  const container = new Container();
  container.label = 'ground';

  const base = getGroundTexture();
  if (!base) {
    // No art at all: the flat fill, exactly as before. Nothing else can be layered
    // on a surface that isn't there, so this is the whole ground.
    const g = new Graphics();
    g.rect(0, 0, worldPixelSize.width, worldPixelSize.height).fill(palette.background);
    g.label = 'ground-fill';
    container.addChild(g);
    return container;
  }

  const alt = perfFlags.groundAlt ? getGroundAltTexture() : null;
  container.addChild(
    createGroundMesh(
      base.texture,
      alt?.texture ?? null,
      blendMaskTexture(),
      gameConfig.grid.tilePx * GROUND_REPEAT_TILES,
    ),
  );

  const decals = decalLayer(terrain);
  if (decals) container.addChild(decals);

  return container;
}

/**
 * A tiny grayscale noise texture stretched over the world, driving the blend
 * between the two ground variants. **Opaque, with the weight in the red channel**
 * — it feeds a `mix()` in the shader now, not a mask, so nothing reads its alpha.
 *
 * Deliberately tiny: at `BLEND_MASK_CELLS` across, one texel covers a hundred-odd
 * pixels of field, and the GPU's linear filtering does the smoothing for free. The
 * values come from the same pure hash the terrain renderer uses rather than from
 * the engine's seeded `Rng` — consuming that stream from the renderer would desync
 * a lockstep match.
 */
function blendMaskTexture(): Texture {
  const n = BLEND_MASK_CELLS;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;
  const image = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Biased toward the low end so variant B reads as occasional drifts over
      // variant A rather than an even half-and-half mix.
      const weight = Math.round(255 * Math.pow(hashUnit(x, y, 0x51), 1.8));
      const i = (y * n + x) * 4;
      image.data[i] = weight;
      image.data[i + 1] = weight;
      image.data[i + 2] = weight;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

/**
 * Scatters decals over open ground.
 *
 * Candidates sit on a coarse lattice and are then filtered and jittered by hash,
 * which keeps the whole thing pure — every peer draws the identical field without
 * anything reading or advancing simulation state. Tiles that are blocked, or that
 * fall inside a base's protected margin, are skipped; the margin is read from the
 * same config `generateObstacles` uses rather than duplicated.
 */
function decalLayer(terrain: TerrainGrid): Container | null {
  if (!perfFlags.groundDecals || !getGroundDecalTexture(0)) return null;

  const { tilePx } = gameConfig.grid;
  const layer = new Container();
  layer.label = 'ground-decals';
  const protectedTiles = baseProtectedTiles();

  for (let ty = 0; ty < terrain.length; ty += DECAL_STRIDE_TILES) {
    const row = terrain[ty];
    for (let tx = 0; tx < row.length; tx += DECAL_STRIDE_TILES) {
      if (hashUnit(tx, ty, 0x7c) > DECAL_CHANCE) continue;

      // Jitter off the lattice, then re-check: the lattice must not be visible,
      // and the tile that matters is the one the decal actually lands on.
      const jx = tx + Math.floor(hashRange(tx, ty, 0x11, 0, DECAL_STRIDE_TILES));
      const jy = ty + Math.floor(hashRange(tx, ty, 0x12, 0, DECAL_STRIDE_TILES));
      if (jy >= terrain.length || jx >= terrain[jy].length) continue;
      if (terrain[jy][jx] !== TerrainKind.Open) continue;
      if (protectedTiles.has(`${jx},${jy}`)) continue;

      const art = getGroundDecalTexture(hashInt(jx, jy, 0x2f, groundDecalVariantCount));
      if (!art) continue;
      const sprite = new Sprite(art.texture);
      sprite.anchor.set(0.5);
      sprite.position.set((jx + 0.5) * tilePx, (jy + 0.5) * tilePx);
      const target = (art.def.targetSize ?? tilePx * 5) * hashRange(jx, jy, 0x33, 0.7, 1.25);
      sprite.scale.set(target / (art.texture.width || target));
      // Flat-lit art, so free rotation costs nothing.
      sprite.rotation = hashRange(jx, jy, 0x44, 0, Math.PI * 2);
      sprite.alpha = hashRange(jx, jy, 0x55, 0.55, 0.95);
      layer.addChild(sprite);
    }
  }

  return layer.children.length ? layer : null;
}

/** Tiles inside any base's clear margin — the same protected region obstacle generation keeps free. */
function baseProtectedTiles(): Set<string> {
  const set = new Set<string>();
  const fp = gameConfig.bases.footprintTiles;
  const margin = gameConfig.obstacles.baseClearMargin;
  for (const p of gameConfig.bases.placements) {
    for (let y = p.ty - margin; y < p.ty + fp + margin; y++) {
      for (let x = p.tx - margin; x < p.tx + fp + margin; x++) set.add(`${x},${y}`);
    }
  }
  return set;
}
