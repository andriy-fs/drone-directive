import { Container } from 'pixi.js';

/**
 * Named world-space containers, stacked back-to-front. Every world object is
 * added to one of these so draw order is controlled by layer, not insertion
 * order. All layers live under the camera container (see Camera.ts).
 */
export interface Layers {
  root: Container;
  ground: Container;
  /** Fog of war — sits above terrain but below units, so it darkens ground only. */
  fog: Container;
  units: Container;
  projectiles: Container;
  fx: Container;
  overlay: Container;
}

export function createLayers(): Layers {
  const root = new Container();
  const ground = new Container();
  const fog = new Container();
  const units = new Container();
  const projectiles = new Container();
  const fx = new Container();
  const overlay = new Container();

  ground.label = 'ground';
  fog.label = 'fog';
  units.label = 'units';
  projectiles.label = 'projectiles';
  fx.label = 'fx';
  overlay.label = 'overlay';

  root.addChild(ground, fog, units, projectiles, fx, overlay);

  return { root, ground, fog, units, projectiles, fx, overlay };
}
