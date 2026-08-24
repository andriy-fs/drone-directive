import { Assets, Rectangle, Texture } from 'pixi.js';
import { sound, type Sound } from '@pixi/sound';
import { soundSources, type SoundTier } from '../config/sounds';
import { markSoundReady } from './audio/sfx';
import {
  baseGaitSprites,
  baseSprites,
  droneSprite,
  ejectaSprite,
  groundAltSprite,
  groundDecalSprites,
  groundSprite,
  munitionSprite,
  peakSprites,
  robotGaitSprites,
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

/**
 * Loaded **one source at a time via `allSettled`**, not as one `Assets.load(array)`.
 *
 * Several sprites are optional by contract — the terrain decals in particular,
 * whose whole design is "missing file → that pass is skipped" (see
 * `.docs/sprites/terrain-peaks.md`). A batched `Assets.load` rejects as a unit, so
 * one 404 would take the settled promise down with it and every *other* sprite
 * would be left resolving to `null` for the life of the page. Settling per source
 * makes the optional-asset contract actually hold.
 */
async function loadSprites(): Promise<void> {
  const sources = spriteSources();
  const results = await Promise.allSettled(sources.map((src) => Assets.load(src)));
  const failed = sources.filter((_, i) => results[i].status === 'rejected');
  if (failed.length) {
    console.error(`Failed to load ${failed.length} sprite asset(s); using placeholders`, failed);
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

/**
 * The movement-cycle frames for a chassis in cycle order, or null if that
 * owner/chassis has no sheet drawn yet (see `robotGaitSprites`).
 *
 * **All or nothing.** One unresolved cell returns null for the whole cycle rather
 * than a shorter one: a gait that skips a phase reads as a stutter, which is a worse
 * failure than the still sprite the caller falls back to. In practice the four cells
 * share a single file, so they resolve or fail together anyway — this just makes the
 * contract say so.
 */
export function getRobotGaitTextures(chassis: ChassisType, owner: Owner): ResolvedSprite[] | null {
  const art = artOwner(owner);
  const defs = robotGaitSprites[art]?.[chassis];
  if (!defs?.length) return null;
  const frames: ResolvedSprite[] = [];
  for (const [i, def] of defs.entries()) {
    const frame = cached(`robot:${art}:${chassis}:gait:${i}`, def);
    if (!frame) return null;
    frames.push(frame);
  }
  return frames;
}

/** Faction base sprite, or null (→ Graphics placeholder) if missing/unloaded. */
export function getBaseTexture(owner: Owner): ResolvedSprite | null {
  const art = artOwner(owner);
  return cached(`base:${art}`, baseSprites[art]);
}

/**
 * The idle-cycle frames for a base in cycle order, or null if that faction has no
 * sheet drawn yet (see `baseGaitSprites`).
 *
 * **All or nothing**, on the same terms as `getRobotGaitTextures`: one unresolved
 * cell drops the whole base back to the still sprite rather than to a cycle with a
 * hole in it. A base is the largest thing on the field and it never moves off the
 * spot, so a stutter here is about as visible as a bug can be.
 */
export function getBaseGaitTextures(owner: Owner): ResolvedSprite[] | null {
  const art = artOwner(owner);
  const defs = baseGaitSprites[art];
  if (!defs?.length) return null;
  const frames: ResolvedSprite[] = [];
  for (const [i, def] of defs.entries()) {
    const frame = cached(`base:${art}:gait:${i}`, def);
    if (!frame) return null;
    frames.push(frame);
  }
  return frames;
}

/**
 * Faction weapon-module sprite for the robot hardpoint, or null (→ Graphics
 * marker) if that owner/weapon has no art or the image isn't loaded.
 */
export function getWeaponTexture(weapon: WeaponType, owner: Owner): ResolvedSprite | null {
  const art = artOwner(owner);
  return cached(`weapon:${art}:${weapon}`, weaponSprites[art]?.[weapon]);
}

/** Impassable-terrain fill texture for one terrain kind, or null (→ flat Graphics fill) if missing/unloaded. */
export function getTerrainTexture(kind: TerrainKind): ResolvedSprite | null {
  return cached(`terrain:${kind}`, terrainSprites[kind]);
}

/** How many ridge decal variants exist — callers pick one by hash, so they need the count. */
export const peakVariantCount = peakSprites.length;

/** One ridge/summit decal variant, or null (→ cluster draws without peaks) if missing/unloaded. */
export function getPeakTexture(variant: number): ResolvedSprite | null {
  const i = variant % peakSprites.length;
  return cached(`peak:${i}`, peakSprites[i]);
}

/** The crater debris halo, or null (→ crater draws without one) if missing/unloaded. */
export function getEjectaTexture(): ResolvedSprite | null {
  return cached('ejecta', ejectaSprite);
}

/** Walkable-ground tile, or null (→ flat background fill) if missing/unloaded. */
export function getGroundTexture(): ResolvedSprite | null {
  return cached('ground', groundSprite);
}

/** The second ground variant blended over the first, or null (→ variant A alone) if missing/unloaded. */
export function getGroundAltTexture(): ResolvedSprite | null {
  return cached('ground:alt', groundAltSprite);
}

/** How many ground decal variants exist — callers pick one by hash. */
export const groundDecalVariantCount = groundDecalSprites.length;

/** One ground decal variant, or null (→ ground draws without decals) if missing/unloaded. */
export function getGroundDecalTexture(variant: number): ResolvedSprite | null {
  const i = variant % groundDecalSprites.length;
  return cached(`groundDecal:${i}`, groundDecalSprites[i]);
}

/** Observer-drone sprite, or null (→ Graphics diamond in DroneView) if missing/unloaded. */
export function getDroneTexture(): ResolvedSprite | null {
  return cached('drone', droneSprite);
}

/** FPV strike-drone sprite, or null (→ Graphics dart in MunitionView) if missing/unloaded. */
export function getMunitionTexture(): ResolvedSprite | null {
  return cached('munition', munitionSprite);
}
