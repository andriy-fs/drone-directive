import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { ObstacleGrid } from '../../engine/obstacles';
import { getObstacleTexture } from '../assets';

/**
 * Draws the (static) obstacle field on the ground layer, rebuilt per match by
 * GameApp from the active context's grid. Each blocked cell gets a seamless
 * one-tile rock sprite (so clusters read as continuous terrain); if the art
 * isn't loaded it falls back to the flat Graphics fill.
 */
export function createObstaclesGraphic(obstacles: ObstacleGrid): Container {
  const { tilePx } = gameConfig.grid;
  const sprite = getObstacleTexture();

  if (!sprite) {
    const g = new Graphics();
    for (let ty = 0; ty < obstacles.length; ty++) {
      const row = obstacles[ty];
      for (let tx = 0; tx < row.length; tx++) {
        if (!row[tx]) continue;
        g.rect(tx * tilePx + 1, ty * tilePx + 1, tilePx - 2, tilePx - 2)
          .fill(palette.obstacle.fill)
          .stroke({ width: 1, color: palette.obstacle.edge });
      }
    }
    g.label = 'obstacles';
    return g;
  }

  const container = new Container();
  container.label = 'obstacles';
  for (let ty = 0; ty < obstacles.length; ty++) {
    const row = obstacles[ty];
    for (let tx = 0; tx < row.length; tx++) {
      if (!row[tx]) continue;
      const img = new Sprite(sprite.texture);
      img.width = tilePx;
      img.height = tilePx;
      img.position.set(tx * tilePx, ty * tilePx);
      container.addChild(img);
    }
  }
  return container;
}
