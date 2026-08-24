import { Container, Graphics, Mesh, Sprite } from 'pixi.js';
import { gameConfig } from '../../../config/gameConfig';
import { palette } from '../../../config/palette';
import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';
import { getEjectaTexture, getPeakTexture, getTerrainTexture, peakVariantCount } from '../../assets';
import { hashInt, hashRange } from './hash';
import { perfFlags } from '../../perf/perfFlags';
import { QuadBuilder } from './quads';
import { createDebrisShader, createFillShader, createFlatShader } from './terrainShaders';
import { debrisGeometry } from './debris';
import { clusterContours, offsetPoint, smoothstep, type Contour, type ContourPoint } from './contours';
import { warpedCorner } from './warp';
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
 * Global light direction, as a unit vector pointing **toward** the sun. Light comes
 * from the **north-west**, so shadows fall south-east and the `n`/`w` faces of a
 * mountain are the lit ones.
 *
 * A vector rather than the per-side flags this used to be, because the boundary is no
 * longer made of sides: the bevel reads a contour's own normal and shades it by
 * `dot(n, LIGHT_DIR)`. The flags could only ever say lit or dark, so an outline
 * turning from north to east flipped between the two in one step at a tile corner —
 * which is a good part of what made the edge read as a flat cut.
 *
 * `terrain-peaks` art is authored against this exact direction (see
 * `.docs/sprites/terrain-peaks.md`) — changing it here means regenerating that
 * sheet, and it is the only art in the game with a baked light direction.
 */
const LIGHT_DIR = [-Math.SQRT1_2, -Math.SQRT1_2] as const;

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

/**
 * The bevel along a boundary — three bands, where the rim was one.
 *
 * A single band ramping inward can only say "there is an edge here", and softly. What
 * it cannot say is that the edge has a *thickness*: rock stops on a lip that catches
 * the light, and the ground right up against it is occluded. Without those two the
 * outline reads as paper cut with a soft eraser, however good the texture on it.
 *
 * - `OCC` reaches **outward**, onto the ground, and is the half nothing here used to
 *   draw at all — the micro-shadow that puts the mass *in* the surface.
 * - `LIP` is a narrow band of constant alpha right at the boundary: the crisp step.
 *   It is deliberately not a ramp; the highlight on a bevel is a line, and a ramp
 *   from the boundary is the thing this replaces.
 * - `WIDTH` is where the soft inner ramp finally reaches zero, as before.
 *
 * `TERMINATOR` is how far past head-on the shading takes to fall off, in `dot(n,
 * light)` — small enough that most of an outline is decidedly lit or decidedly dark,
 * wide enough that the two meet through a gradient instead of at a step.
 */
const BEVEL = {
  WIDTH: 6,
  LIP: 1.5,
  OCC: 6,
  /** The lip itself: a bright line, and the fraction of it the ramp behind it starts at. */
  LIT_ALPHA: 0.62,
  DARK_ALPHA: 0.62,
  FALLOFF: 0.42,
  OCC_ALPHA: 0.5,
  TERMINATOR: 0.35,
} as const;
/** The lit band's colour, linear 0..1 — the old `0x7d8ea8`. The dark bands share `SHADOW_COLOR`. */
const BEVEL_LIT_COLOR = [0.49, 0.557, 0.659];

/**
 * Where the loose stone at the foot of a mountain goes, and how far out.
 *
 * There was a **wall** here — a strip of baked cliff art standing on the south-facing
 * arcs of the contour, with this rubble spilling from its base. It is gone: from
 * straight overhead it read as a differently lit piece of art laid along the
 * silhouette, and it fought the peaks, which are the assets that actually carry the
 * mass's light. Height now has to come from the fill's own micro-relief, the peak
 * decals and the bevel.
 *
 * `FACING` is measured on the contour normal's southward component: due south gets
 * the full scatter and the full contact shadow, a stretch turning east or west gets
 * neither. `REACH` is where the scatter starts, just outside the footprint —
 * decoration only, exactly as `ejectaLayer` has always been. Nothing about the
 * collision grid moves.
 */
const DEBRIS = { FACING: { LO: 0.15, HI: 0.7 }, REACH: 3, SHADE: 0.78 } as const;

/** How far apart a contour's samples are, in px — the resolution every outline is drawn at. */
const CONTOUR = { SPACING: 8 } as const;

/**
 * Loose stones on the ground below a mountain's shaded side.
 *
 * Two per tile's worth (`perPx` is per px of contour, since there are no tile edges
 * down here any more) is enough because they are not meant to be counted — they are
 * meant to interrupt the straight line the footprint draws. A gradient can soften
 * that line; only something with its own silhouette can break it.
 */
const SCREE = { perPx: 2 / 32, minSize: 5, maxSize: 11, spread: 14 } as const;

/**
 * The dirty ground under a mass: wider than the contact shadow and much fainter.
 *
 * This is the "haze" half of making rock sit *in* a surface rather than on it. The
 * contact shadow says where the stone touches; this says the ground near it is not
 * clean. Cheap — one more quad per run in a mesh that already exists.
 */
const HAZE = { REACH: 30, ALPHA: 0.14 } as const;

/**
 * The dark line of contact where a mountain meets the ground.
 *
 * `KNEE` splits the falloff in two: the first band runs from full alpha down to
 * `KNEE_ALPHA` of it over `KNEE` of the reach, the second from there to nothing. One
 * band would ramp linearly, and a linear ramp reads as a slab of shadow with a hard
 * start — this bends it, dark and tight against the stone, then a long tail.
 */
const CONTACT = { REACH: 14, ALPHA: 0.6, KNEE: 0.38, KNEE_ALPHA: 0.42 } as const;

/** Chebyshev tiles two ridge decals must be apart. Also what keeps a small blob to one. */
const PEAK_SEPARATION = 3;
/** How much wider than its cluster's bounding box the debris halo is drawn. */
const EJECTA_SPREAD = 1.55;

const { tilePx } = gameConfig.grid;

/** Where a grid corner is drawn — every pass that touches the silhouette goes through this. */
const warped = (cx: number, cy: number): { x: number; y: number } => warpedCorner(cx, cy, tilePx);

/** The two warped endpoints of one tile edge, in the order the side runs. */
function edgeEnds(tx: number, ty: number, side: Side): [{ x: number; y: number }, { x: number; y: number }] {
  if (side === 'n') return [warped(tx, ty), warped(tx + 1, ty)];
  if (side === 's') return [warped(tx, ty + 1), warped(tx + 1, ty + 1)];
  if (side === 'w') return [warped(tx, ty), warped(tx, ty + 1)];
  return [warped(tx + 1, ty), warped(tx + 1, ty + 1)];
}

/** A cluster with its traced outlines — what the bevel and the wall are both drawn from. */
interface Outline {
  cluster: Cluster;
  contours: Contour[];
}

/** Builds the whole terrain field. Caller owns the container and destroys it. */
export function createTerrainView(terrain: TerrainGrid): Container {
  const container = new Container();
  container.label = 'terrain';

  const clusters = findClusters(terrain);
  const depths = new Map<Cluster, DepthField>();
  for (const c of clusters) depths.set(c, depthField(c));

  // Traced once, for every layer that draws the silhouette. Three of them used to
  // rebuild it from tile edges apiece, which is why the wall and the top of the rock
  // could disagree about what shape the mountain was.
  const outlines: Outline[] = clusters.map((cluster) => ({
    cluster,
    contours: clusterContours(cluster, { corner: warped, spacing: CONTOUR.SPACING }),
  }));

  // Bottom to top. Ejecta first because it is the one thing that lies *outside*
  // the blocked footprint: on passable ground, under the fill, so the fill always
  // wins where the two meet and the footprint stays exactly what it is.
  container.addChild(ejectaLayer(clusters), shadowLayer(terrain), fillLayer(terrain, normalisedDepth(clusters, depths)));
  if (perfFlags.rim) container.addChild(bevelLayer(outlines));
  if (perfFlags.debris) container.addChild(debrisLayer(outlines));
  if (perfFlags.peaks) container.addChild(peakLayer(clusters, depths));

  return container;
}

/**
 * How much of the shaded side a contour sample is on: 1 where the outline faces due
 * south, 0 where it has turned east or west. Both the contact shadow and the debris
 * are weighted by it.
 */
function southFacing(p: ContourPoint): number {
  return smoothstep(DEBRIS.FACING.LO, DEBRIS.FACING.HI, p.ny);
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

  const quads = new QuadBuilder(warped);
  const solid = () => SHADOW_ALPHA;
  const off = SHADOW_REACH;

  for (let ty = 0; ty < terrain.length; ty++) {
    const row = terrain[ty];
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] !== TerrainKind.Mountain) continue;
      quads.addTile(tilePx, solid, tx, ty, off, off);
    }
  }

  const f = SHADOW_FEATHER;
  const a = SHADOW_ALPHA;
  for (const { tx, ty, side } of boundaryEdges(terrain, TerrainKind.Mountain)) {
    // Both ends on the warped grid, offset toward the light with the body: a skirt
    // hanging off the straight grid line would show the silhouette this layer exists
    // to hide, drawn in shadow.
    const [p, q] = edgeEnds(tx, ty, side);
    const x = p.x + off;
    const y = p.y + off;
    const x2 = q.x + off;
    const y2 = q.y + off;
    if (side === 'n') quads.add(x, y, a, x2, y2, a, x2, y2 - f, 0, x, y - f, 0);
    else if (side === 's') quads.add(x, y, a, x2, y2, a, x2, y2 + f, 0, x, y + f, 0);
    else if (side === 'w') quads.add(x, y, a, x2, y2, a, x2 - f, y2, 0, x - f, y, 0);
    else quads.add(x, y, a, x2, y2, a, x2 + f, y2, 0, x + f, y, 0);
  }

  if (quads.empty) return layer;
  const mesh = new Mesh({ geometry: quads.build('aAlpha'), shader: createFlatShader(SHADOW_COLOR) });
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
    const quads = new QuadBuilder(warped);
    for (const { tx, ty } of cells) {
      quads.addTile(tilePx, corner, tx, ty);
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
 * What a mountain does to the ground it stands on: the haze and the line of contact
 * under its shaded side, and the loose stone that has come off it.
 *
 * **This is what is left of the wall.** A strip of baked cliff art used to stand on
 * these same arcs of the contour, and it was the layer that answered "how tall is
 * this". It came off deliberately: seen from directly overhead it read as a second
 * piece of art with its own light direction pasted along the silhouette, and it
 * competed with `terrain-peaks`, which is the asset that carries the mass's form.
 * Height is now the fill's own relief, the peaks, and the bevel. What could not go is
 * the debris — a mass whose stone ends exactly on its footprint line reads as a
 * decal, and only something with a silhouette of its own breaks that line.
 *
 * Two decisions kept from the wall, both measured off the generated maps (20 seeds,
 * 40×40: ~10 mountain clusters per map, median 16 tiles, 47% of them one tile thick):
 *
 * 1. **Drawn on the contour, weighted by facing.** The shadow hugs a diagonal stretch
 *    as closely as a horizontal one, and it thins out where the outline turns toward
 *    the light instead of stopping on a tile boundary.
 * 2. **Only the debris crosses the footprint line**, and it is decoration — the
 *    precedent is `ejectaLayer`, which has drawn a crater's halo on passable ground
 *    all along.
 *
 * Two static meshes for the whole map: one for all the soft darkness, one for the
 * stone.
 */
function debrisLayer(outlines: readonly Outline[]): Container {
  const layer = new Container();
  layer.label = 'terrain-debris';

  const contours = outlines
    .filter((o) => o.cluster.kind === TerrainKind.Mountain)
    .flatMap((o) => o.contours);
  if (!contours.length) return layer;

  // Haze and contact in one mesh: the same flat colour with a per-vertex ramp, so
  // they cost one draw call between them however many mountains the map has. Each
  // band is offset along the contour's own normal.
  const quads = new QuadBuilder();
  const knee = CONTACT.REACH * CONTACT.KNEE;
  const kneeAlpha = CONTACT.ALPHA * CONTACT.KNEE_ALPHA;
  for (const contour of contours) {
    const pts = contour.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const fp = southFacing(p);
      const fq = southFacing(q);
      if (fp <= 0 && fq <= 0) continue;

      const band = (from: number, to: number, aFrom: number, aTo: number): void => {
        const p0 = offsetPoint(p, from);
        const q0 = offsetPoint(q, from);
        const q1 = offsetPoint(q, to);
        const p1 = offsetPoint(p, to);
        quads.add(p0.x, p0.y, aFrom * fp, q0.x, q0.y, aFrom * fq, q1.x, q1.y, aTo * fq, p1.x, p1.y, aTo * fp);
      };

      // Haze first and widest: the ground itself dirtying up toward the rock. Without
      // it the mass stands on a clean floor, which is most of what "pasted on" means.
      band(0, HAZE.REACH, HAZE.ALPHA, 0);

      // Contact, in two bands rather than one. A single quad ramps linearly, and a
      // straight ramp is a wall of shadow with a hard start — light does not fall off
      // like that. Two bands bend the falloff: dark and tight against the stone, then a
      // long tail.
      band(0, knee, CONTACT.ALPHA, kneeAlpha);
      band(knee, CONTACT.REACH, kneeAlpha, 0);
    }
  }
  if (!quads.empty) {
    const shadow = new Mesh({ geometry: quads.build('aAlpha'), shader: createFlatShader(SHADOW_COLOR) });
    shadow.label = 'debris-contact';
    layer.addChild(shadow);
  }

  // The stone itself, cut out of the mountain fill — no sheet of its own, so a map
  // whose fill is missing simply has no debris rather than debris made of something
  // else.
  const art = getTerrainTexture(TerrainKind.Mountain);
  if (!art) return layer;
  const geometry = debrisGeometry(contours, {
    repeatPx: tilePx * ROCK_REPEAT_TILES,
    facingLo: DEBRIS.FACING.LO,
    facingHi: DEBRIS.FACING.HI,
    scree: SCREE,
    reach: DEBRIS.REACH,
  });
  if (geometry) {
    const stones = new Mesh({ geometry, shader: createDebrisShader(art.texture, DEBRIS.SHADE) });
    stones.label = 'debris-scree';
    layer.addChild(stones);
  }

  return layer;
}

/**
 * The bevel along every cluster boundary — and **the thing that tells the two terrain
 * kinds apart at a glance**, which matters because they behave differently: shots
 * cross a crater and are stopped by a mountain (`sightGrid` in `engine/obstacles.ts`).
 *
 * A mountain is a wall rising toward the light, so its north-west side is bright. A
 * crater's north-west side is an inner wall turned away from the light, so it is dark
 * and the far side is the lit one. The inversion is the whole trick, and it is
 * gameplay information rather than decoration.
 *
 * **Three bands, not one, and one of them is outside.** This was a single 6 px ramp
 * fading inward from each tile edge, and before that a 3 px stroke. Both said only
 * "an edge is here": nothing about the edge having a thickness, and nothing at all on
 * the ground side. That is what reads as a shape cut out of paper and laid on the
 * field. What a real break in rock has, and what is drawn here, is an occluded strip
 * of ground just outside it, a crisp lit lip on the stone itself, and only then the
 * soft fall of light away from that lip.
 *
 * **Shading is continuous.** Every sample is weighted by `dot(normal, LIGHT_DIR)`
 * instead of by which side of a tile it sat on, so an outline curving from north to
 * east passes through a terminator rather than switching in one step at a corner.
 *
 * **It runs the whole way round.** It used to stand aside on the south-facing arcs,
 * where a rock face drew its own lip and its own contact shadow; with the face gone
 * the bevel is the only thing describing those stretches, and they are the ones the
 * light does not reach. The contact shadow under them is drawn by `debrisLayer` and
 * sits *outside* the footprint, so the two stack the way a lip and the ground below
 * it should rather than doubling up.
 */
function bevelLayer(outlines: readonly Outline[]): Container {
  const layer = new Container();
  layer.label = 'terrain-bevel';

  // One builder per colour, not per kind: a mountain's lit edge and a crater's lit
  // edge are the same band and belong in the same mesh, so the whole layer is two
  // draw calls whatever the map looks like. The dark bands share the cast shadow's
  // colour, which is what they always were.
  const builders = { lit: new QuadBuilder(), dark: new QuadBuilder() };

  for (const { cluster, contours } of outlines) {
    const crater = cluster.kind === TerrainKind.Crater;
    const occDir = crater ? -1 : 1; // a pit's occlusion is inside it

    for (const contour of contours) {
      const pts = contour.points;
      const weights = pts.map((p) => {
        const lam = (p.nx * LIGHT_DIR[0] + p.ny * LIGHT_DIR[1]) * (crater ? -1 : 1);
        const dark = smoothstep(0, BEVEL.TERMINATOR, -lam);
        return {
          lit: BEVEL.LIT_ALPHA * smoothstep(0, BEVEL.TERMINATOR, lam),
          dark: BEVEL.DARK_ALPHA * dark,
          occ: BEVEL.OCC_ALPHA * (0.6 + 0.4 * dark),
        };
      });

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const j = (i + 1) % pts.length;
        const q = pts[j];
        const wp = weights[i];
        const wq = weights[j];

        const band = (
          quads: QuadBuilder,
          from: number,
          to: number,
          aFrom: readonly [number, number],
          aTo: readonly [number, number],
        ): void => {
          if (aFrom[0] <= 0 && aFrom[1] <= 0 && aTo[0] <= 0 && aTo[1] <= 0) return;
          const p0 = offsetPoint(p, from);
          const q0 = offsetPoint(q, from);
          const q1 = offsetPoint(q, to);
          const p1 = offsetPoint(p, to);
          quads.add(p0.x, p0.y, aFrom[0], q0.x, q0.y, aFrom[1], q1.x, q1.y, aTo[1], p1.x, p1.y, aTo[0]);
        };

        // Outward: the micro-shadow on the ground, ramping to nothing.
        band(builders.dark, 0, BEVEL.OCC * occDir, [wp.occ, wq.occ], [0, 0]);
        // The lip: constant alpha over a narrow band. A highlight on a bevel is a
        // line, so this one deliberately does not ramp.
        band(builders.lit, 0, -BEVEL.LIP, [wp.lit, wq.lit], [wp.lit, wq.lit]);
        band(builders.dark, 0, -BEVEL.LIP, [wp.dark, wq.dark], [wp.dark, wq.dark]);
        // Then the soft fall away from it, inward, as the rim always did — but
        // starting well below the lip, so the lip stays a line on top of a gradient
        // rather than the bright end of one. A ramp all the way from the boundary is
        // what read as a stroke with blurry edges.
        const f = BEVEL.FALLOFF;
        band(builders.lit, -BEVEL.LIP, -BEVEL.WIDTH, [wp.lit * f, wq.lit * f], [0, 0]);
        band(builders.dark, -BEVEL.LIP, -BEVEL.WIDTH, [wp.dark * f, wq.dark * f], [0, 0]);
      }
    }
  }

  for (const [name, quads] of Object.entries(builders)) {
    if (quads.empty) continue;
    const mesh = new Mesh({
      geometry: quads.build('aAlpha'),
      shader: createFlatShader(name === 'lit' ? BEVEL_LIT_COLOR : SHADOW_COLOR),
    });
    mesh.label = `bevel-${name}`;
    layer.addChild(mesh);
  }

  return layer;
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
