import { Assets, Rectangle, Texture } from 'pixi.js';
import { sound, type Sound } from '@pixi/sound';
import { soundSources, type SoundTier } from '../config/sounds';
import { markSoundReady } from './audio/sfx';
import {
  baseSprites,
  droneSprite,
  groundSprite,
  munitionSprite,
  robotSprites,
  spriteSources,
  terrainSprites,
  weaponSprites,
  type SpriteDef,
} from '../config/sprites';
import { Owner, type ChassisType, type TerrainKind, type WeaponType } from '@drone-directive/types/enums';

/**
 * Starts fetching the sprites at low priority, without waiting for them.
 *
 * `backgroundLoad` pulls one file at a time and yields to anything the page asks
 * for outright, which is the point: on the title screen the only asset that is
 * actually *visible* is the menu backdrop (preloaded from `index.html`), and the
 * sprites have no business racing it. A later `Assets.load` of the same URL
 * promotes it to full priority and awaits the very same promise, so nothing is
 * fetched twice.
 */
export function warmGameAssets(): void {
  // Not awaited anywhere, so its own failure has to be swallowed here or it
  // surfaces as an unhandled rejection; `loadGameAssets` reports for real.
  void Assets.backgroundLoad(spriteSources()).catch(() => {});
}

/**
 * Resolves once every sprite is decoded and `getRobotTexture` & co. can answer.
 * Resolves even on failure (a missing/failed image simply means those units keep
 * the Graphics placeholder), so asset problems never block the game from starting.
 *
 * **A match must not be built before this resolves.** A texture lookup that misses
 * is memoized as `null` for the life of the page (see `cached` below), and the
 * views resolve their texture once, in their constructor — so a world populated a
 * moment too early keeps Graphics placeholders until the page is reloaded rather
 * than picking the art up when it lands. `GameApp` holds the start request until
 * this promise is in hand.
 *
 * Memoized like `loadSoundAssets`: called from the match-start gate, which can
 * run many times per page.
 */
let spriteLoad: Promise<void> | null = null;

export function loadGameAssets(): Promise<void> {
  spriteLoad ??= loadSprites();
  return spriteLoad;
}

async function loadSprites(): Promise<void> {
  try {
    await Assets.load(spriteSources());
  } catch (err) {
    console.error('Failed to load sprite assets; using placeholders', err);
  }
}

/**
 * Preloads one tier of sound cues and registers each under its alias. Resolves
 * even on failure — a missing file just means that cue stays silent — matching
 * how a missing sprite falls back to its placeholder.
 *
 * Goes through `Assets.load` (the `@pixi/sound` import registers a parser for
 * it) rather than the library's own `preload`, whose fetch is an unguarded
 * `await` inside a floating promise: a 404 there escapes as an unhandled
 * rejection that no callback can catch.
 *
 * Runs at most once per tier per page. The alias registry is module state on the
 * sound library and nothing in `GameApp.destroy` unregisters it, so the second
 * `GameApp.init` of a StrictMode double-mount — or simply a second match — would
 * otherwise re-add every alias over itself.
 *
 * Unlike the sprites, no caller ever needs to *wait* on this: `sfx.play` checks
 * readiness per call, so a cue that is still decoding is skipped on that shot and
 * heard on the next.
 */
const soundLoads = new Map<SoundTier, Promise<void>>();

export function loadSoundAssets(tier: SoundTier): Promise<void> {
  let load = soundLoads.get(tier);
  if (!load) {
    load = registerSounds(tier);
    soundLoads.set(tier, load);
  }
  return load;
}

async function registerSounds(tier: SoundTier): Promise<void> {
  const sources = soundSources(tier);
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

/** FPV strike-drone sprite, or null (→ Graphics dart in MunitionView) if missing/unloaded. */
export function getMunitionTexture(): ResolvedSprite | null {
  return cached('munition', munitionSprite);
}
