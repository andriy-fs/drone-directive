import { Assets, Rectangle, Texture } from 'pixi.js';
import { sound, type Sound } from '@pixi/sound';
import { soundSources } from '../config/sounds';
import { markSoundReady } from './audio/sfx';
import {
  baseSprites,
  droneSprite,
  groundSprite,
  robotSprites,
  spriteSources,
  terrainSprites,
  weaponSprites,
  type SpriteDef,
} from '../config/sprites';
import { Owner, type ChassisType, type TerrainKind, type WeaponType } from '@drone-directive/types/enums';

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

/**
 * Preloads the sound cues and registers each under its alias. Resolves even on
 * failure — a missing file just means that cue stays silent — matching how a
 * missing sprite falls back to its placeholder.
 *
 * Goes through `Assets.load` (the `@pixi/sound` import registers a parser for
 * it) rather than the library's own `preload`, whose fetch is an unguarded
 * `await` inside a floating promise: a 404 there escapes as an unhandled
 * rejection that no callback can catch.
 *
 * Runs at most once per page. The alias registry is module state on the sound
 * library and nothing in `GameApp.destroy` unregisters it, so the second
 * `GameApp.init` of a StrictMode double-mount would otherwise re-add every alias
 * over itself.
 */
let soundLoad: Promise<void> | null = null;

export function loadSoundAssets(): Promise<void> {
  soundLoad ??= registerSounds();
  return soundLoad;
}

async function registerSounds(): Promise<void> {
  const sources = soundSources();
  try {
    const loaded = await Assets.load<Sound>(sources.map((s) => s.src));
    for (const { name, src } of sources) {
      const asset = loaded[src];
      if (!asset) continue;
      // The parser has already registered the file itself, under its basename —
      // `lowThreeTone` rather than `select-group`, since cues point straight at
      // the pack. Register the same Sound under the name the game calls it by,
      // unless the two happen to coincide.
      if (!sound.exists(name)) sound.add(name, asset);
      markSoundReady(name);
    }
  } catch (err) {
    console.error('Failed to load sound assets; the game runs silent', err);
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
 * Which art set a side wears. There are two on disk — the player's and the
 * opponent's — and every side beyond the first opponent reuses the opponent art,
 * told apart by the team tint the views apply (see `render/ownerColor.ts`). Also
 * keeps the texture cache to two entries per lookup instead of one per side.
 */
function artOwner(owner: Owner): Owner {
  return owner === Owner.Player ? Owner.Player : Owner.AI;
}

/**
 * Faction robot sprite for a chassis, or null (→ Graphics placeholder) if that
 * owner/chassis has no art or the image isn't loaded.
 */
export function getRobotTexture(chassis: ChassisType, owner: Owner): ResolvedSprite | null {
  const art = artOwner(owner);
  return cached(`robot:${art}:${chassis}`, robotSprites[art]?.[chassis]);
}

/** Faction base sprite, or null (→ Graphics placeholder) if missing/unloaded. */
export function getBaseTexture(owner: Owner): ResolvedSprite | null {
  const art = artOwner(owner);
  return cached(`base:${art}`, baseSprites[art]);
}

/**
 * Faction weapon-module sprite for the robot hardpoint, or null (→ Graphics
 * marker) if that owner/weapon has no art or the image isn't loaded.
 */
export function getWeaponTexture(weapon: WeaponType, owner: Owner): ResolvedSprite | null {
  const art = artOwner(owner);
  return cached(`weapon:${art}:${weapon}`, weaponSprites[art]?.[weapon]);
}

/** Impassable-terrain tile for one terrain kind, or null (→ flat Graphics fill) if missing/unloaded. */
export function getTerrainTexture(kind: TerrainKind): ResolvedSprite | null {
  return cached(`terrain:${kind}`, terrainSprites[kind]);
}

/** Walkable-ground tile, or null (→ flat background fill) if missing/unloaded. */
export function getGroundTexture(): ResolvedSprite | null {
  return cached('ground', groundSprite);
}

/** Observer-drone sprite, or null (→ Graphics diamond in DroneView) if missing/unloaded. */
export function getDroneTexture(): ResolvedSprite | null {
  return cached('drone', droneSprite);
}
