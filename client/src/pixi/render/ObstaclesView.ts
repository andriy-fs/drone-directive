import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { TerrainGrid } from '../../engine/obstacles';
import { TerrainKind } from '@drone-directive/types/enums';
import { getTerrainTexture } from '../assets';

/**
 * Draws the (static) obstacle field on the ground layer, rebuilt per match by
 * GameApp from the active context's terrain. Each blocked cell gets the seamless
 * one-tile sprite for its `TerrainKind` (so clusters read as continuous terrain —
 * generation keeps a cluster all one kind); cells whose art isn't loaded fall
 * back to the flat Graphics fill.
 */
export function createObstaclesGraphic(terrain: TerrainGrid): Container {
  const { tilePx } = gameConfig.grid;
  const container = new Container();
  container.label = 'obstacles';
  const fallback = new Graphics();
  let usedFallback = false;

  for (let ty = 0; ty < terrain.length; ty++) {
    const row = terrain[ty];
    for (let tx = 0; tx < row.length; tx++) {
      const kind = row[tx];
      if (kind === TerrainKind.Open) continue;

      const sprite = getTerrainTexture(kind);
      if (!sprite) {
        const fill = kind === TerrainKind.Crater ? palette.obstacle.crater : palette.obstacle.fill;
        fallback
          .rect(tx * tilePx + 1, ty * tilePx + 1, tilePx - 2, tilePx - 2)
          .fill(fill)
          .stroke({ width: 1, color: palette.obstacle.edge });
        usedFallback = true;
        continue;
      }
      const img = new Sprite(sprite.texture);
      img.width = tilePx;
      img.height = tilePx;
      img.position.set(tx * tilePx, ty * tilePx);
      container.addChild(img);
    }
  }

  if (usedFallback) container.addChildAt(fallback, 0);
  else fallback.destroy();
  return container;
}
