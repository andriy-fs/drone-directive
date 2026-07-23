import { Assets, Rectangle, Texture } from 'pixi.js';
import {
  baseSprites,
  droneSprite,
  groundSprite,
  obstacleSprite,
  robotSprites,
  spriteSources,
  weaponSprites,
  type SpriteDef,
} from '../config/sprites';
import type { ChassisType, Owner, WeaponType } from '../types/enums';

/**
 * Preloads all sprite images. Resolves even on failure (a missing/failed image
 * simply means those units keep the Graphics placeholder), so asset problems
 * never block the game from starting.
 */
export async function loadGameAssets(): Promise<void> {
  try {
    await Assets.load(spriteSources());
  } catch (err) {
    console.error('Failed to load sprite assets; using placeholders', err);
  }
}

/** A resolved sprite: the (possibly cropped) texture plus its definition. */
export interface ResolvedSprite {
  texture: Texture;
  def: SpriteDef;
}

const cache = new Map<string, ResolvedSprite | null>();

/** Builds the (possibly cropped) texture for a def, or null if it isn't loaded. */
function resolve(def: SpriteDef | undefined): ResolvedSprite | null {
  const base = def ? Assets.get<Texture>(def.src) : undefined;
  if (!def || !base) return null;
  const texture = def.frame
    ? new Texture({
        source: base.source,
        frame: new Rectangle(def.frame.x, def.frame.y, def.frame.w, def.frame.h),
      })
    : base;
  return { texture, def };
}

/** Cached lookup helper: resolve once per key, reusing the shared base texture. */
function cached(key: string, def: SpriteDef | undefined): ResolvedSprite | null {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const resolved = resolve(def);
  cache.set(key, resolved);
  return resolved;
}

/**
 * Faction robot sprite for a chassis, or null (→ Graphics placeholder) if that
 * owner/chassis has no art or the image isn't loaded.
 */
export function getRobotTexture(chassis: ChassisType, owner: Owner): ResolvedSprite | null {
  return cached(`robot:${owner}:${chassis}`, robotSprites[owner]?.[chassis]);
}

/** Faction base sprite, or null (→ Graphics placeholder) if missing/unloaded. */
export function getBaseTexture(owner: Owner): ResolvedSprite | null {
  return cached(`base:${owner}`, baseSprites[owner]);
}

/**
 * Faction weapon-module sprite for the robot hardpoint, or null (→ Graphics
 * marker) if that owner/weapon has no art or the image isn't loaded.
 */
export function getWeaponTexture(weapon: WeaponType, owner: Owner): ResolvedSprite | null {
  return cached(`weapon:${owner}:${weapon}`, weaponSprites[owner]?.[weapon]);
}

/** Impassable-terrain tile, or null (→ flat Graphics fill) if missing/unloaded. */
export function getObstacleTexture(): ResolvedSprite | null {
  return cached('obstacle', obstacleSprite);
}

/** Walkable-ground tile, or null (→ flat background fill) if missing/unloaded. */
export function getGroundTexture(): ResolvedSprite | null {
  return cached('ground', groundSprite);
}

/** Observer-drone sprite, or null (→ Graphics diamond in DroneView) if missing/unloaded. */
export function getDroneTexture(): ResolvedSprite | null {
  return cached('drone', droneSprite);
}
