import { Owner, TerrainKind } from '@drone-directive/types/enums';
import type { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * Describes how to draw a unit from a PNG. `frame` is an optional crop (for a
 * sprite sheet); omit it for a clean whole-image, one-unit-per-file PNG.
 * `rotationOffset` aligns the art's forward direction with the entity's heading
 * (heading 0 = +x/east); art drawn facing up needs +90°. `targetSize` is the
 * on-field diameter in px.
 */
export interface SpriteDef {
  src: string;
  frame?: { x: number; y: number; w: number; h: number };
  rotationOffset?: number;
  targetSize?: number;
}

/** On-field diameter (px) for robot art; ~1.4 tiles. */
const ROBOT_TARGET = 46;
/** On-field size (px) for a base; matches the 3-tile (96 px) footprint. */
const BASE_TARGET = 96;
/** On-field size (px) for a weapon module overlaid on a robot's hardpoint. */
const WEAPON_TARGET = 24;
/** On-field diameter (px) for the observer drone — a light recon flyer, a touch smaller than a robot. */
const DRONE_TARGET = 40;
const PUBLIC_BASE = import.meta.env.BASE_URL;

/**
 * Robot sprites keyed by **owner → chassis**, so each faction has distinct art
 * (see `.docs/sprites`). Whole-image PNGs authored facing up → `rotationOffset:
 * Math.PI / 2`. A missing entry falls back to the Graphics placeholder. Add a
 * chassis/faction by adding a `src`.
 */
export const robotSprites: Partial<Record<Owner, Partial<Record<ChassisType, SpriteDef>>>> = {
  [Owner.Player]: {
    tracks: {
      src: `${PUBLIC_BASE}robot-tracks-player.png`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    wheels: {
      src: `${PUBLIC_BASE}robot-wheels-player.png`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    legs: {
      src: `${PUBLIC_BASE}robot-legs-player.png`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
  },
  [Owner.AI]: {
    tracks: {
      src: `${PUBLIC_BASE}robot-tracks-ai.png`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    wheels: {
      src: `${PUBLIC_BASE}robot-wheels-ai.png`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    legs: {
      src: `${PUBLIC_BASE}robot-legs-ai.png`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
  },
};

/** Base sprites keyed by owner (bases don't rotate, so no `rotationOffset`). */
export const baseSprites: Partial<Record<Owner, SpriteDef>> = {
  [Owner.Player]: {
    src: `${PUBLIC_BASE}base-player.png`,
    targetSize: BASE_TARGET,
  },
  [Owner.AI]: { src: `${PUBLIC_BASE}base-ai.png`, targetSize: BASE_TARGET },
};

/**
 * Seamless impassable-terrain tiles keyed by `TerrainKind`, drawn per blocked
 * cell (one game tile wide; `ObstaclesView` scales each to
 * `gameConfig.grid.tilePx`). A missing entry falls back to the flat Graphics
 * fill. Add a terrain type by adding a key here plus one in `TerrainKind` — see
 * `.docs/sprites/obstacle-mountain.md` / `obstacle-crater.md`.
 */
export const terrainSprites: Partial<Record<TerrainKind, SpriteDef>> = {
  [TerrainKind.Mountain]: { src: `${PUBLIC_BASE}obstacle-mountain.png` },
  [TerrainKind.Crater]: { src: `${PUBLIC_BASE}obstacle-crater.png` },
};

/**
 * Seamless walkable-ground tile tiled across the whole field beneath the grid
 * (see `createGround`). Undefined → the flat `palette.background` fill.
 */
export const groundSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}ground-tile.png`,
};

/**
 * The player's observer drone (single faction). Whole-image PNG authored facing
 * up → `rotationOffset: Math.PI / 2`. Undefined → the Graphics diamond in
 * `DroneView`. See `.docs/sprites/drone.md`.
 */
export const droneSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}drone-player.png`,
  rotationOffset: Math.PI / 2,
  targetSize: DRONE_TARGET,
};

/**
 * Weapon module sprites keyed by **owner → weapon**, overlaid on a robot's
 * central hardpoint (see `.docs/sprites/weapons.md`). A missing entry falls back
 * to the Graphics marker in `RobotView`. Modules are radially balanced, so no
 * `rotationOffset` is needed even though they inherit the robot's heading.
 */
export const weaponSprites: Partial<Record<Owner, Partial<Record<WeaponType, SpriteDef>>>> = {
  [Owner.Player]: {
    radar: {
      src: `${PUBLIC_BASE}weapon-radar-player.png`,
      targetSize: WEAPON_TARGET,
    },
    bomb: {
      src: `${PUBLIC_BASE}weapon-bomb-player.png`,
      targetSize: WEAPON_TARGET,
    },
  },
  [Owner.AI]: {
    radar: {
      src: `${PUBLIC_BASE}weapon-radar-ai.png`,
      targetSize: WEAPON_TARGET,
    },
    bomb: {
      src: `${PUBLIC_BASE}weapon-bomb-ai.png`,
      targetSize: WEAPON_TARGET,
    },
  },
};

/**
 * Title-screen splash art, shown behind the main menu before a match starts (see
 * `.docs/sprites/menu-backdrop.md`). Not a Pixi sprite — the menu draws it as a
 * DOM background, so it is deliberately absent from `spriteSources()` and never
 * enters the texture cache. A missing file degrades to the flat `--bg` fill.
 *
 * Keep this as an absolute URL from the current page rather than a bare
 * `./menu-backdrop.webp`: the value is injected into an inline CSS custom
 * property, and in production that relative URL gets resolved against the built
 * CSS bundle under `/assets/`, which causes the GitHub Pages 404.
 */
export const menuBackdropSrc =
  typeof window === 'undefined'
    ? `${PUBLIC_BASE}menu-backdrop.webp`
    : new URL('menu-backdrop.webp', window.location.href).toString();

/** Unique image sources to preload (robots + bases + weapon modules + terrain). */
export function spriteSources(): string[] {
  const srcs: string[] = [];
  for (const byChassis of Object.values(robotSprites)) {
    if (!byChassis) continue;
    for (const def of Object.values(byChassis)) if (def) srcs.push(def.src);
  }
  for (const def of Object.values(baseSprites)) if (def) srcs.push(def.src);
  for (const byWeapon of Object.values(weaponSprites)) {
    if (!byWeapon) continue;
    for (const def of Object.values(byWeapon)) if (def) srcs.push(def.src);
  }
  for (const def of Object.values(terrainSprites)) if (def) srcs.push(def.src);
  if (groundSprite) srcs.push(groundSprite.src);
  if (droneSprite) srcs.push(droneSprite.src);
  return [...new Set(srcs)];
}
