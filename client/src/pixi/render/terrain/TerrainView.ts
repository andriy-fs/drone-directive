import { Container, Graphics, Mesh, Sprite } from 'pixi.js';
import { gameConfig } from '../../../config/gameConfig';
import { palette } from '../../../config/palette';
import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';
import { getEjectaTexture, getPeakTexture, getTerrainTexture, peakVariantCount } from '../../assets';
import { hashInt, hashRange } from './hash';
import { perfFlags } from '../../perf/perfFlags';
import { QuadBuilder } from './quads';
import { createFillShader, createShadowShader } from './terrainShaders';
import {
  boundaryEdges,
  depthField,
  findClusters,
  peakAnchors,
  type Cluster,
  type DepthField,
  type Side,
} from './clusters';

/**
 * Draws the static terrain field, rebuilt per match by `GameApp` from the active
 * context's `TerrainGrid`.
 *
 * **Terrain is drawn as landforms, not as cells.** The previous renderer put one
 * sprite on every blocked cell, which gave the field a 32 px period — the smallest
 * one possible — and left every cluster a staircase of identical squares with no
 * edge and no height. Here the art supplies only *material* — a seamless fill
 * sampled in world space — and the *form* is derived from each cluster's own
 * silhouette: a cast shadow, a boundary rim, and shading from the distance
 * transform in `clusters.ts`.
 *
 * **Three things this layer must never do**, all three learned by measuring
 * (`.docs/tasks/terrain-render-cost.md`):
 *
 * 1. **No `RenderTexture`.** The app renders at `devicePixelRatio`, so baking the
 *    world would cost ~105 MB of VRAM on the large map at dpr 2, and baking at
 *    resolution 1 would be visibly soft on a retina display.
 * 2. **No filters — and a `Sprite` used as a mask is a filter.** Pixi routes a
 *    `Sprite` mask through `AlphaMask`, which allocates an offscreen target at the
 *    renderer's resolution *with MSAA* and composites it, every frame. This layer
 *    was written to avoid `BlurFilter` and then paid for one anyway, through a
 *    mask, in `createGround`. A `Graphics`/`Container` mask is a cheap stencil;
 *    a `Sprite` mask is not.
 * 3. **No world-sized quads.** A quad spanning the map rasterises across the whole
 *    viewport whatever the stencil then discards. Geometry covers the blocked
 *    tiles instead.
 *
 * Softness is geometric: gradients are interpolated vertex attributes, not stacked
 * copies and not blurs. What remains is a handful of static meshes built once per
 * match, with nothing recomputed per frame.
 */

/**
 * Global light direction, as the offset a cast shadow takes. Light comes from the
 * **north-west**, so shadows fall south-east and the `n`/`w` faces of a mountain
 * are the lit ones.
 *
 * `terrain-peaks` art is authored against this exact direction (see
 * `.docs/sprites/terrain-peaks.md`) — changing it here means regenerating that
 * sheet, and it is the only art in the game with a baked light direction.
 */
const LIGHT_FROM: { readonly [K in Side]: boolean } = { n: true, w: true, s: false, e: false };

/** How far the cast shadow is offset from the mass, in px. */
const SHADOW_REACH = 9;
/** Width of the soft edge feathered outward from the shadow's silhouette, in px. */
const SHADOW_FEATHER = 7;
/** Opacity of the shadow body. */
const SHADOW_ALPHA = 0.5;
/** Shadow colour, linear 0..1 — the shader outputs premultiplied. */
const SHADOW_COLOR = [0.016, 0.024, 0.04];

/** Cells of ground one repeat of a terrain fill covers. Higher = larger, calmer rock forms. */
const ROCK_REPEAT_TILES = 6;

/**
 * Colour the fill is mixed toward at a cluster's deepest point, and how far the mix
 * goes. A rise catches light, a pit loses it, so the two go opposite ways — and the
 * pit needs far more of it, because "deep" has to survive being read against ground
 * that is already nearly black.
 */
const DEPTH_TINT = { mountain: [0.525, 0.592, 0.722], crater: [0, 0, 0] } as const;
const DEPTH_STRENGTH = { mountain: 0.24, crater: 0.55 } as const;

/** Thickness of the boundary rim, in px. */
const RIM_WIDTH = 3;

/** Chebyshev tiles two ridge decals must be apart. Also what keeps a small blob to one. */
const PEAK_SEPARATION = 3;
/** How much wider than its cluster's bounding box the debris halo is drawn. */
const EJECTA_SPREAD = 1.55;

const { tilePx } = gameConfig.grid;

/** Builds the whole terrain field. Caller owns the container and destroys it. */
export function createTerrainView(terrain: TerrainGrid): Container {
  const container = new Container();
  container.label = 'terrain';

  const clusters = findClusters(terrain);
  const depths = new Map<Cluster, DepthField>();
  for (const c of clusters) depths.set(c, depthField(c));

  // Bottom to top. Ejecta first because it is the one thing that lies *outside*
  // the blocked footprint: on passable ground, under the fill, so the fill always
  // wins where the two meet and the footprint stays exactly what it is.
  container.addChild(ejectaLayer(clusters), shadowLayer(terrain), fillLayer(terrain, normalisedDepth(clusters, depths)));
  if (perfFlags.rim) container.addChild(rimLayer(terrain));
  if (perfFlags.peaks) container.addChild(peakLayer(clusters, depths));

  return container;
}

/** Depth of one tile, normalised to its own cluster's maximum. 0 outside any cluster. */
type TileValue = (tx: number, ty: number) => number;

/**
 * Flattens the per-cluster distance transforms into one lookup.
 *
 * Normalising **per cluster** rather than globally is deliberate: a small blob and
 * a huge massif should both read as fully raised at their thickest point. Scaling
 * everything by the map's deepest cluster would leave every modest hill looking
 * flat.
 */
function normalisedDepth(clusters: Cluster[], depths: Map<Cluster, DepthField>): TileValue {
  const map = new Map<string, number>();
  for (const cluster of clusters) {
    const depth = depths.get(cluster);
    if (!depth || depth.max === 0) continue;
    for (const t of cluster.tiles) map.set(`${t.tx},${t.ty}`, depth.at(t.tx, t.ty) / depth.max);
  }
  return (tx, ty) => map.get(`${tx},${ty}`) ?? 0;
}

/**
 * Depth at a grid **corner** — the mean of the up-to-four tiles meeting there.
 *
 * Averaging is what gives the gradient a soft edge: a corner on the cluster's
 * boundary has open ground on some of its sides, contributing zero, so the shading
 * fades to nothing exactly at the footprint instead of stopping at a hard line.
 */
function cornerSampler(depthOf: TileValue): (cx: number, cy: number) => number {
  return (cx, cy) => (depthOf(cx - 1, cy - 1) + depthOf(cx, cy - 1) + depthOf(cx - 1, cy) + depthOf(cx, cy)) / 4;
}

/** The debris halo around each crater — see `.docs/sprites/terrain-ejecta.md`. */
function ejectaLayer(clusters: Cluster[]): Container {
  const layer = new Container();
  layer.label = 'terrain-ejecta';
  const art = getEjectaTexture();
  if (!art) return layer;

  for (const cluster of clusters) {
    if (cluster.kind !== TerrainKind.Crater) continue;
    const { bbox } = cluster;
    const w = (bbox.maxTx - bbox.minTx + 1) * tilePx;
    const h = (bbox.maxTy - bbox.minTy + 1) * tilePx;
    const sprite = new Sprite(art.texture);
    sprite.anchor.set(0.5);
    sprite.position.set((bbox.minTx * tilePx + w / 2) | 0, (bbox.minTy * tilePx + h / 2) | 0);
    sprite.width = w * EJECTA_SPREAD;
    sprite.height = h * EJECTA_SPREAD;
    // The art is flat-lit, so it can be rotated freely — unlike the peak decals,
    // which carry a baked light direction.
    sprite.rotation = hashRange(bbox.minTx, bbox.minTy, 0x1f, 0, Math.PI * 2);
    layer.addChild(sprite);
  }
  return layer;
}

/**
 * Cast shadows for the mountains only — a crater sinks, and giving it a shadow
 * would say the opposite of everything else drawn on it.
 *
 * **One pass.** The silhouette is offset toward the light-away direction at a flat
 * alpha, and its soft edge is a *skirt*: a band extruded outward from each boundary
 * edge, alpha ramping to zero across it. The rasteriser interpolates that ramp per
 * pixel.
 *
 * The previous version stacked five offset copies and let their overlap be the
 * gradient — five times the overdraw over every mountain on every frame, to
 * approximate something the hardware does for free. The skirt is both cheaper and
 * smoother.
 *
 * Corners where two skirt bands meet overlap slightly rather than mitring. At a
 * 7 px feather against 32 px tiles that is not visible, and mitring would need the
 * boundary traced as ordered polygons — real work for no perceptible gain.
 */
function shadowLayer(terrain: TerrainGrid): Container {
  const layer = new Container();
  layer.label = 'terrain-shadow';
  if (!perfFlags.shadow) return layer;

  const quads = new QuadBuilder();
  const solid = () => SHADOW_ALPHA;
  const off = SHADOW_REACH;

  for (let ty = 0; ty < terrain.length; ty++) {
    const row = terrain[ty];
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] !== TerrainKind.Mountain) continue;
      quads.addTile(tx * tilePx + off, ty * tilePx + off, tilePx, solid, tx, ty);
    }
  }

  const f = SHADOW_FEATHER;
  const a = SHADOW_ALPHA;
  for (const { tx, ty, side } of boundaryEdges(terrain, TerrainKind.Mountain)) {
    const x = tx * tilePx + off;
    const y = ty * tilePx + off;
    const x2 = x + tilePx;
    const y2 = y + tilePx;
    if (side === 'n') quads.add(x, y, a, x2, y, a, x2, y - f, 0, x, y - f, 0);
    else if (side === 's') quads.add(x, y2, a, x2, y2, a, x2, y2 + f, 0, x, y2 + f, 0);
    else if (side === 'w') quads.add(x, y, a, x, y2, a, x - f, y2, 0, x - f, y, 0);
    else quads.add(x2, y, a, x2, y2, a, x2 + f, y2, 0, x2 + f, y, 0);
  }

  if (quads.empty) return layer;
  const mesh = new Mesh({ geometry: quads.build('aAlpha'), shader: createShadowShader(SHADOW_COLOR) });
  mesh.label = 'shadow';
  layer.addChild(mesh);
  return layer;
}

/**
 * One `Mesh` per terrain kind, covering exactly that kind's cells, with the
 * fill texture sampled in **world space** and the cluster depth carried per vertex.
 *
 * World-space sampling is what makes a cluster read as one landform: the texture
 * continues from one cell into the next, so there is no seam inside a cluster and
 * no per-cell repeat to disguise.
 *
 * This replaced a world-sized `TilingSprite` masked to the cells, and the mask is
 * the reason: a quad spanning the whole map is rasterised across the entire
 * viewport and the stencil then discards ~80% of it, every frame. Geometry that
 * covers only the blocked tiles is both less fill and less geometry than the mask
 * it removes — 811 tiles on the medium map is 1622 triangles across both meshes.
 *
 * The depth attribute carries what used to be a separate layer of ~7300 quantised
 * rectangles (see `quads.ts`). A kind whose art is missing falls back to the flat
 * palette fill and every other pass still runs, so terrain degrades to shaded
 * silhouettes rather than vanishing.
 */
function fillLayer(terrain: TerrainGrid, depthOf: TileValue): Container {
  const layer = new Container();
  layer.label = 'terrain-fill';

  for (const kind of [TerrainKind.Crater, TerrainKind.Mountain]) {
    const cells = cellsOf(terrain, kind);
    if (!cells.length) continue;

    const art = getTerrainTexture(kind);
    if (!art) {
      const flat = new Graphics();
      for (const { tx, ty } of cells) flat.rect(tx * tilePx, ty * tilePx, tilePx, tilePx);
      flat.fill(kind === TerrainKind.Crater ? palette.obstacle.crater : palette.obstacle.fill);
      layer.addChild(flat);
      continue;
    }

    // Sampling by world position needs the source to wrap. Safe to set here
    // because the fills are whole-image assets with a source of their own; a
    // `frame`-cropped sheet shares its source and would bleed between quadrants.
    art.texture.source.addressMode = 'repeat';

    const corner = cornerSampler(depthOf);
    const quads = new QuadBuilder();
    for (const { tx, ty } of cells) {
      quads.addTile(tx * tilePx, ty * tilePx, tilePx, corner, tx, ty);
    }

    const crater = kind === TerrainKind.Crater;
    const mesh = new Mesh({
      geometry: quads.build('aDepth'),
      shader: createFillShader(
        art.texture,
        tilePx * ROCK_REPEAT_TILES,
        crater ? DEPTH_TINT.crater : DEPTH_TINT.mountain,
        perfFlags.depth ? (crater ? DEPTH_STRENGTH.crater : DEPTH_STRENGTH.mountain) : 0,
      ),
    });
    mesh.label = crater ? 'fill-crater' : 'fill-mountain';
    layer.addChild(mesh);
  }

  return layer;
}

/**
 * The lit/shadowed edge along every cluster boundary — and **the thing that tells
 * the two terrain kinds apart at a glance**, which matters because they behave
 * differently: shots cross a crater and are stopped by a mountain
 * (`sightGrid` in `engine/obstacles.ts`).
 *
 * A mountain is a wall rising toward the light, so its north and west edges are
 * bright. A crater's north and west edges are inner walls turned away from the
 * light, so they are dark and the far side is the lit one. The inversion is the
 * whole trick, and it is gameplay information rather than decoration.
 *
 * Edges are drawn as rects inset into the footprint rather than as strokes on a
 * traced path: strokes would also run along the internal edges shared between two
 * cells of the same kind, painting the grid back on.
 */
function rimLayer(terrain: TerrainGrid): Graphics {
  const g = new Graphics();
  g.label = 'terrain-rim';

  for (const kind of [TerrainKind.Crater, TerrainKind.Mountain]) {
    const edges = boundaryEdges(terrain, kind);
    if (!edges.length) continue;
    const crater = kind === TerrainKind.Crater;

    for (const lit of [false, true]) {
      let any = false;
      for (const { tx, ty, side } of edges) {
        // A crater's rim reads inverted: the edge facing the light is the inner
        // wall turned away from it.
        if ((LIGHT_FROM[side] !== crater) !== lit) continue;
        const x = tx * tilePx;
        const y = ty * tilePx;
        if (side === 'n') g.rect(x, y, tilePx, RIM_WIDTH);
        else if (side === 's') g.rect(x, y + tilePx - RIM_WIDTH, tilePx, RIM_WIDTH);
        else if (side === 'w') g.rect(x, y, RIM_WIDTH, tilePx);
        else g.rect(x + tilePx - RIM_WIDTH, y, RIM_WIDTH, tilePx);
        any = true;
      }
      if (!any) continue;
      g.fill(lit ? { color: 0x7d8ea8, alpha: 0.8 } : { color: 0x04060b, alpha: 0.75 });
    }
  }

  return g;
}

/**
 * Ridge decals at each mountain cluster's interior high points — the internal
 * structure neither the flat fill nor the smooth depth gradient can provide, and
 * what makes a massif read as a range rather than a dome.
 *
 * **Not rotated freely.** This is the one asset in the game with a baked light
 * direction, so a decal turned any distance would light that part of the cluster
 * from somewhere else. Variant and a few degrees of jitter are all the variety
 * available, which is why there are four variants on the sheet.
 */
function peakLayer(clusters: Cluster[], depths: Map<Cluster, DepthField>): Container {
  const layer = new Container();
  layer.label = 'terrain-peaks';
  if (!getPeakTexture(0)) return layer;

  for (const cluster of clusters) {
    if (cluster.kind !== TerrainKind.Mountain) continue;
    const depth = depths.get(cluster);
    if (!depth) continue;

    for (const anchor of peakAnchors(cluster, depth, PEAK_SEPARATION)) {
      const art = getPeakTexture(hashInt(anchor.tx, anchor.ty, 0x2b, peakVariantCount));
      if (!art) continue;
      const sprite = new Sprite(art.texture);
      sprite.anchor.set(0.5);
      sprite.position.set((anchor.tx + 0.5) * tilePx, (anchor.ty + 0.5) * tilePx);
      // Thicker ground carries a bigger summit.
      const bulk = Math.min(depth.at(anchor.tx, anchor.ty), 3) / 3;
      const target = (art.def.targetSize ?? tilePx * 3) * (0.75 + 0.35 * bulk);
      sprite.scale.set(target / (art.texture.width || target));
      sprite.rotation = hashRange(anchor.tx, anchor.ty, 0x3d, -0.2, 0.2);
      layer.addChild(sprite);
    }
  }

  return layer;
}

function cellsOf(terrain: TerrainGrid, kind: TerrainKind) {
  const cells: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < terrain.length; ty++) {
    const row = terrain[ty];
    for (let tx = 0; tx < row.length; tx++) if (row[tx] === kind) cells.push({ tx, ty });
  }
  return cells;
}
