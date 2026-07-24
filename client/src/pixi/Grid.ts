import { Container, Graphics, TilingSprite } from 'pixi.js';
import { gameConfig, worldPixelSize } from '../config/gameConfig';
import { palette } from '../config/palette';
import { getGroundTexture } from './assets';

/** Texture tiles per grid cell for the ground surface (bump up for a broader, less-repetitive look). */
const GROUND_REPEAT_TILES = 2;

/**
 * The walkable ground surface for the whole field, drawn beneath the grid. Uses
 * the seamless ground tile if loaded, else the flat background fill. Static
 * (built once), like the grid.
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

/**
 * Draws the static top-down battlefield grid into the ground layer. Rendered
 * once (the grid never changes), so this is a plain Graphics object rather than
 * something the game loop touches each frame. The surface fill lives in
 * `createGround` (drawn beneath this), so this draws only the lines.
 */
export function createGrid(): Graphics {
  const g = new Graphics();
  const { tilePx, width, height } = gameConfig.grid;
  const { majorEvery, line, lineMajor } = palette.grid;

  // Vertical lines.
  for (let tx = 0; tx <= width; tx++) {
    const x = tx * tilePx;
    g.moveTo(x, 0).lineTo(x, worldPixelSize.height);
    g.stroke({ width: 1, color: tx % majorEvery === 0 ? lineMajor : line });
  }

  // Horizontal lines.
  for (let ty = 0; ty <= height; ty++) {
    const y = ty * tilePx;
    g.moveTo(0, y).lineTo(worldPixelSize.width, y);
    g.stroke({ width: 1, color: ty % majorEvery === 0 ? lineMajor : line });
  }

  g.label = 'grid';
  return g;
}
