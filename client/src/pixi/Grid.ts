import { Container, Graphics, TilingSprite } from 'pixi.js';
import { gameConfig, worldPixelSize } from '../config/gameConfig';
import { palette } from '../config/palette';
import { getGroundTexture } from './assets';

/** Texture tiles per grid cell for the ground surface (bump up for a broader, less-repetitive look). */
const GROUND_REPEAT_TILES = 4;

/**
 * The walkable ground surface for the whole field — the bottom-most thing drawn,
 * under obstacles, units and projectiles. Uses the seamless ground tile if loaded,
 * else the flat background fill. Static (built once per match).
 */
export function createGround(): Container {
  const sprite = getGroundTexture();
  if (!sprite) {
    const g = new Graphics();
    g.rect(0, 0, worldPixelSize.width, worldPixelSize.height).fill(palette.background);
    g.label = 'ground-fill';
    return g;
  }
  const ground = new TilingSprite({
    texture: sprite.texture,
    width: worldPixelSize.width,
    height: worldPixelSize.height,
  });
  const dim = sprite.texture.width || gameConfig.grid.tilePx;
  ground.tileScale.set((gameConfig.grid.tilePx * GROUND_REPEAT_TILES) / dim);
  ground.label = 'ground';
  return ground;
}
