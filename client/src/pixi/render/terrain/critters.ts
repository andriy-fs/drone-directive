import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';
import { CritterKind } from '../../../config/sprites';
import {
  depthField,
  findClusters,
  peakAnchors,
  PEAK_SEPARATION,
  type Cluster,
  type DepthField,
  type Tile,
} from './clusters';
import { hashInt, hashRange, hashUnit } from './hash';

/**
 * Where the plateau critters go — the decorative creatures that sit on the interior of
 * a large mountain cluster and animate there for the whole match.
 *
 * A pure function of the `TerrainGrid`, like everything else in this folder, and for the
 * same reason: it is the part of the decoration that has an answer worth testing.
 *
 * **The mountain interior is the only place on the map safe to put scenery.** It is
 * impassable and it blocks line of fire, so nothing the player controls can ever reach
 * it, drive through the art, or shoot the creature standing on it. That is what lets
 * these exist without touching the simulation at all — no ECS entity, no hit test, no
 * collision, nothing in `types/`, `net/` or the command stream.
 *
 * **Randomness comes from `hash.ts` and never from the engine `Rng`.** That generator's
 * stream *is* the simulation: a renderer drawing one extra decal would advance it and
 * desync the lockstep match, on one peer only. A coordinate hash is stateless, so two
 * players on the same seed get the same creatures in the same places for free.
 */

/** One placed critter: which species, which tile, and its own animation offsets. */
export interface CritterAnchor {
  tx: number;
  ty: number;
  kind: CritterKind;
  /** Cycle offset in turns, so two critters on one map never breathe in step. */
  phase: number;
  /** Rotation in radians. Tiny — the art's light is baked, so it cannot be turned far. */
  jitter: number;
}

/**
 * At most this many critters exist on a map, however many plateaus qualify.
 *
 * Two is the point of the feature, not a budget: a field dotted with creatures would read
 * as a unit type the player cannot select rather than as wildlife. Most generated maps do
 * hit this cap (see `MIN_DEPTH`), so it is the number the player usually sees, not a rare
 * ceiling.
 */
const MAX_CRITTERS = 2;

/**
 * How far inside a cluster a critter's tile must be, in Chebyshev tiles from open ground.
 *
 * Depth 2 means every one of the anchor's eight neighbours is rock too, so the stone
 * reaches 1.5 tiles — 48 px — from the tile's centre in every direction, diagonals
 * included. The widest species is 76 px, half of which is 38 px, so it sits wholly on
 * rock with room to spare. Nothing here is drawn in perspective, so a creature that
 * overhangs the edge simply appears to stand on the open ground beside the mountain.
 *
 * **3 was tried first and is too strict.** It costs nothing in correctness and everything
 * in presence: over 300 generated maps it left 57% of them with no critter at all, which
 * makes a feature the player is supposed to notice something they mostly never see. At 2
 * the same 300 maps come out 3% empty, 28% with one and 68% with two.
 */
const MIN_DEPTH = 2;

/**
 * Smallest cluster that may hold a critter, in tiles.
 *
 * `MIN_DEPTH` alone already excludes thin blobs, but a long 3-deep ribbon can pass it
 * while still looking like a wall rather than a plateau. 24 tiles is the area at which a
 * mountain reads as a place with a middle.
 */
const MIN_TILES = 24;

/**
 * Chebyshev tiles a critter must keep from every ridge decal on its cluster.
 *
 * Both are placed at the local maxima of the same depth field — `peakAnchors` puts a
 * summit exactly where the rock is thickest, which is exactly where this function wants
 * to stand a creature. Without the clearance the two land on the same tile and a 90 px
 * peak is drawn straight over a 76 px critter.
 */
const PEAK_CLEARANCE = 2;

/** Salts, so the four hash reads off one anchor can't correlate with each other. */
const SALT = { PICK: 0x5c, KIND: 0x6d, PHASE: 0x7e, JITTER: 0x8f } as const;

/** Does this cluster have a big enough interior to hold a creature at all? */
function qualifies(cluster: Cluster, depth: DepthField): boolean {
  return cluster.kind === TerrainKind.Mountain && cluster.tiles.length >= MIN_TILES && depth.max >= MIN_DEPTH;
}

/**
 * The tiles on one cluster a critter may stand on: deep enough inside, and clear of the
 * summits. Sorted deepest-first with a coordinate tie-break, exactly as `peakAnchors`
 * sorts, so the choice made from it is identical on every peer.
 */
function candidates(cluster: Cluster, depth: DepthField): Tile[] {
  const peaks = peakAnchors(cluster, depth, PEAK_SEPARATION);
  const open = cluster.tiles.filter((t) => {
    if (depth.at(t.tx, t.ty) < MIN_DEPTH) return false;
    return peaks.every((p) => Math.max(Math.abs(p.tx - t.tx), Math.abs(p.ty - t.ty)) >= PEAK_CLEARANCE);
  });

  open.sort((a, b) => {
    const byDepth = depth.at(b.tx, b.ty) - depth.at(a.tx, a.ty);
    if (byDepth !== 0) return byDepth;
    if (a.ty !== b.ty) return a.ty - b.ty;
    return a.tx - b.tx;
  });
  return open;
}

/**
 * Picks the critters for a match — at most `MAX_CRITTERS`, on the largest qualifying
 * mountain clusters, one apiece.
 *
 * **A map with no big plateau gets none, and that is a normal outcome.** Terrain is
 * generated from the match seed and nothing guarantees a cluster of any particular size,
 * so the alternative would be forcing a creature onto a ridge too small to hold it.
 */
export function critterAnchors(terrain: TerrainGrid): CritterAnchor[] {
  const eligible: { cluster: Cluster; depth: DepthField }[] = [];
  for (const cluster of findClusters(terrain)) {
    const depth = depthField(cluster);
    if (qualifies(cluster, depth)) eligible.push({ cluster, depth });
  }

  // Biggest plateaus first — those are the ones whose size "permits" a creature — with a
  // coordinate tie-break so two clusters of equal area can't order differently per peer.
  eligible.sort((a, b) => {
    const byArea = b.cluster.tiles.length - a.cluster.tiles.length;
    if (byArea !== 0) return byArea;
    if (a.cluster.bbox.minTy !== b.cluster.bbox.minTy) return a.cluster.bbox.minTy - b.cluster.bbox.minTy;
    return a.cluster.bbox.minTx - b.cluster.bbox.minTx;
  });

  const kinds = Object.values(CritterKind);
  const anchors: CritterAnchor[] = [];
  for (const { cluster, depth } of eligible) {
    if (anchors.length >= MAX_CRITTERS) break;
    const open = candidates(cluster, depth);
    if (!open.length) continue;

    // Keyed off the cluster's bbox corner rather than the winning tile: the tile is what
    // we are choosing, so it cannot also be the input to the choice.
    const { minTx, minTy } = cluster.bbox;
    const tile = open[hashInt(minTx, minTy, SALT.PICK, open.length)];
    anchors.push({
      tx: tile.tx,
      ty: tile.ty,
      kind: kinds[hashInt(tile.tx, tile.ty, SALT.KIND, kinds.length)],
      phase: hashUnit(tile.tx, tile.ty, SALT.PHASE),
      jitter: hashRange(tile.tx, tile.ty, SALT.JITTER, -0.12, 0.12),
    });
  }

  return anchors;
}
