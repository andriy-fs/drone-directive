import { gameConfig } from '../config/gameConfig';

/** A point in continuous world space (pixels), before camera transform. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** A discrete grid cell. */
export interface TilePoint {
  tx: number;
  ty: number;
}

/** Centre of a tile in world coordinates. */
export function tileToWorld(tx: number, ty: number): WorldPoint {
  const { tilePx } = gameConfig.grid;
  return {
    x: tx * tilePx + tilePx / 2,
    y: ty * tilePx + tilePx / 2,
  };
}

/** Tile containing a world-space point. */
export function worldToTile(wx: number, wy: number): TilePoint {
  const { tilePx } = gameConfig.grid;
  return {
    tx: Math.floor(wx / tilePx),
    ty: Math.floor(wy / tilePx),
  };
}

/** True when a tile is inside the battlefield bounds. */
export function isInBounds(tx: number, ty: number): boolean {
  const { width, height } = gameConfig.grid;
  return tx >= 0 && ty >= 0 && tx < width && ty < height;
}
