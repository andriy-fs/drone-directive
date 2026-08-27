import { Owner, TerrainKind } from '@drone-directive/types/enums';
import type { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * Describes how to draw a unit from an image. `frame` is an optional crop (for a
 * sprite sheet); omit it for a clean whole-image, one-unit-per-file asset.
 * `rotationOffset` aligns the art's forward direction with the entity's heading
 * (heading 0 = +x/east); art drawn facing up needs +90°. `targetSize` is the
 * on-field diameter in px.
 *
 * Every `src` below points at a **WebP in `public/`, which is generated** — the
 * PNG masters live in `client/assets-src/sprites/` and are re-encoded (scaled to
 * roughly 2–3× their on-field size) by `scripts/encode-sprites.mjs`. Editing a
 * file in `public/` by hand is therefore pointless; edit the master and re-run
 * the script. Nothing scales off the file's own dimensions except `targetSize`,
 * so the encoded size is free to change without touching this table.
 */
export interface SpriteDef {
  src: string;
  frame?: { x: number; y: number; w: number; h: number };
  rotationOffset?: number;
  targetSize?: number;
}

/** On-field diameter (px) for robot art; ~1.4 tiles. */
const ROBOT_TARGET = 46;
/**
 * On-field diameter (px) for the **walker** chassis alone — the one robot that does
 * not use `ROBOT_TARGET`.
 *
 * `targetSize` scales the whole frame, so it buys presence in proportion to how much
 * of that frame the art actually inks. A tracked hull fills ~86% of its bounding box;
 * a legged one, with six legs and the background between them, fills about half. At a
 * shared 46 px the walker therefore came out the *widest* silhouette on the field and
 * the *lightest*-looking one — precisely backwards for the chassis with the most hp.
 * 52 restores mass parity by area rather than by width.
 *
 * The other half of that fix lives in the art (see `.docs/sprites/robots.md` § Legs):
 * a weapon module is a fixed 30 px on every chassis, so a walker's hull has to be wide
 * enough to carry one, or the module overhangs it and hides the body it is bolted to.
 */
const LEGS_TARGET = 52;
/** On-field size (px) for a base; matches the 3-tile (96 px) footprint. */
const BASE_TARGET = 96;
/**
 * On-field size (px) for a weapon module overlaid on a robot's hardpoint.
 *
 * Two thirds of the 46 px chassis: big enough to carry its weapon-role colour and
 * three or four legible shapes (see `palette.weapon` and
 * `.docs/sprites/weapons.md`), small enough to still read as a part bolted onto a
 * hull rather than a second unit sitting on it. The camera has no zoom, so this
 * is not a starting size — it is the *only* size the module is ever seen at, and
 * the art is composed against it.
 */
export const WEAPON_TARGET = 30;
/** On-field diameter (px) for the observer drone — a light recon flyer, a touch smaller than a robot. */
const DRONE_TARGET = 40;
/**
 * On-field diameter (px) for an FPV strike drone. Smaller than the observer on
 * purpose: five arrive at once, and a swarm must not out-weigh the robot that
 * launched it. Big enough to be read as a threat, small enough to be read as five.
 */
const MUNITION_TARGET = 30;
const PUBLIC_BASE = import.meta.env.BASE_URL;

/**
 * Robot sprites keyed by **owner → chassis**, so each faction has distinct art
 * (see `.docs/sprites`). Whole-image art authored facing up → `rotationOffset:
 * Math.PI / 2`. A missing entry falls back to the Graphics placeholder. Add a
 * chassis/faction by adding a `src`.
 */
export const robotSprites: Partial<Record<Owner, Partial<Record<ChassisType, SpriteDef>>>> = {
  [Owner.Player]: {
    tracks: {
      src: `${PUBLIC_BASE}robot-tracks-player.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    wheels: {
      src: `${PUBLIC_BASE}robot-wheels-player.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    legs: {
      src: `${PUBLIC_BASE}robot-legs-player.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: LEGS_TARGET,
    },
  },
  [Owner.AI]: {
    tracks: {
      src: `${PUBLIC_BASE}robot-tracks-ai.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    wheels: {
      src: `${PUBLIC_BASE}robot-wheels-ai.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: ROBOT_TARGET,
    },
    legs: {
      src: `${PUBLIC_BASE}robot-legs-ai.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: LEGS_TARGET,
    },
  },
};

/** Base sprites keyed by owner (bases don't rotate, so no `rotationOffset`). */
export const baseSprites: Partial<Record<Owner, SpriteDef>> = {
  [Owner.Player]: {
    src: `${PUBLIC_BASE}base-player.webp`,
    targetSize: BASE_TARGET,
  },
  [Owner.AI]: { src: `${PUBLIC_BASE}base-ai.webp`, targetSize: BASE_TARGET },
};

/**
 * Seamless **fill textures** for impassable terrain, keyed by `TerrainKind`.
 *
 * Not tiles: `TerrainView` stretches one `TilingSprite` per kind across the whole
 * world and masks it to that kind's cells, so the texture is continuous in world
 * space and a cluster reads as one landform rather than a grid of cells. Nothing
 * about the landform lives in these files — shadow, rim and depth are drawn
 * procedurally from each cluster's silhouette, which is why the art must carry no
 * lighting of its own. See `.docs/sprites/obstacle-mountain.md`.
 *
 * A missing entry falls back to the flat Graphics fill (the procedural passes
 * still run). Add a terrain type by adding a key here plus one in `TerrainKind`.
 */
export const terrainSprites: Partial<Record<TerrainKind, SpriteDef>> = {
  [TerrainKind.Mountain]: { src: `${PUBLIC_BASE}obstacle-mountain.webp` },
  [TerrainKind.Crater]: { src: `${PUBLIC_BASE}obstacle-crater.webp` },
};

/**
 * A 2×2 sheet cropped into four defs, **in reading order** — top-left, top-right,
 * bottom-left, bottom-right. The decal sheets treat that as an unordered set of
 * variants; the gait sheet treats it as the cycle order, so it is load-bearing there
 * and the art briefs number the cells the same way.
 *
 * `frame` is in the **shipped** texture's pixel space, so a quadrant is half of
 * whatever `scripts/encode-sprites.mjs` encodes that sheet at — the one place in
 * this file coupled to a number over there. The decal sheets ship at 512² (hence
 * 256); the gait sheets ship at 256² (hence 128).
 *
 * `rotationOffset` is passed through to every cell, for sheets whose cells are units
 * authored facing up rather than orientation-free decals.
 */
function sheet2x2(src: string, quadrant: number, targetSize: number, rotationOffset?: number): SpriteDef[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ].map(({ x, y }) => ({
    src,
    frame: { x: x * quadrant, y: y * quadrant, w: quadrant, h: quadrant },
    targetSize,
    rotationOffset,
  }));
}

/**
 * Movement-cycle sheets keyed by **owner → chassis**, drawn instead of the still
 * `robotSprites` entry when present. Four cells in cycle order, and cell 0 is always
 * the pose the unit rests in; `RobotView` advances them by **distance travelled**, so
 * a cycle starts, keeps pace and stops with the unit itself.
 *
 * What cycles differs per chassis (see `.docs/internal/sprites/robots.md`): `legs`
 * re-poses six legs into two tripods, `tracks` scrolls its link ladders, `wheels`
 * turns a marked tire and works its suspension in diagonal pairs. A chassis with no
 * entry here simply doesn't animate — every one has a sheet now, but the fallback is
 * still what a half-loaded sheet lands on (`getRobotGaitTextures` is all-or-nothing).
 *
 * A missing or half-loaded sheet falls back to the still sprite — see
 * `getRobotGaitTextures`, which is all-or-nothing on purpose: a cycle with a hole in
 * it looks worse than honest static art.
 */
export const robotGaitSprites: Partial<Record<Owner, Partial<Record<ChassisType, SpriteDef[]>>>> = {
  [Owner.Player]: {
    legs: sheet2x2(`${PUBLIC_BASE}robot-legs-player-gait.webp`, 128, LEGS_TARGET, Math.PI / 2),
    tracks: sheet2x2(`${PUBLIC_BASE}robot-tracks-player-gait.webp`, 128, ROBOT_TARGET, Math.PI / 2),
    wheels: sheet2x2(`${PUBLIC_BASE}robot-wheels-player-gait.webp`, 128, ROBOT_TARGET, Math.PI / 2),
  },
  [Owner.AI]: {
    legs: sheet2x2(`${PUBLIC_BASE}robot-legs-ai-gait.webp`, 128, LEGS_TARGET, Math.PI / 2),
    tracks: sheet2x2(`${PUBLIC_BASE}robot-tracks-ai-gait.webp`, 128, ROBOT_TARGET, Math.PI / 2),
    wheels: sheet2x2(`${PUBLIC_BASE}robot-wheels-ai-gait.webp`, 128, ROBOT_TARGET, Math.PI / 2),
  },
};

/**
 * How far a unit travels (px) in one full four-cell cycle of its sheet, per chassis.
 *
 * A property of the **art**, not of the balance — it says how long the stride, or how
 * coarse the tread pattern, the artist drew is — which is why it lives here next to
 * the sheets rather than in `gameConfig`. Read against `gameConfig.robots.chassis[…]
 * .speed`, each number is a cycle rate:
 *
 * - `legs` (42 px/s): ~1.75 cycles/s, about 7 texture swaps a second — the plod of
 *   something heavy, not a scurry.
 * - `tracks` (60 px/s): ~3.75 cycles/s. One cycle advances the tread by one link
 *   pitch, so this number *is* the pitch the art has to be drawn at.
 * - `wheels` (135 px/s): ~3.1 cycles/s, so the tires pulse dark-light about 6 times a
 *   second. Not the tire's true geometry — a ~12 px wheel rolls its own circumference
 *   every ~38 px and no one can read that phase from directly above anyway. It was 20
 *   px while the art was a soft tread pattern, which turned out to animate nothing at
 *   this size; the sheet is now drawn as a hard-contrast flicker, and a flicker needs
 *   *fewer* cycles per second than a blur did or its two states average into one tone.
 */
export const GAIT_STRIDE_PX: Record<ChassisType, number> = {
  legs: 24,
  tracks: 16,
  wheels: 44,
};

/**
 * Idle-cycle sheets for the bases, keyed by owner, drawn instead of the still
 * `baseSprites` entry when present. Four cells in cycle order, cell 0 is the rest
 * pose, and the quadrant is 256 because a base sheet ships at 512². **No
 * `rotationOffset`** — a base does not rotate, so its cells are orientation-free.
 *
 * What cycles is four cues at once (see `.docs/internal/sprites/bases.md`): landing
 * lights chasing around the central pad, a radar dish turning a quarter turn per
 * cell, chevrons marching out of the production bay, and the vents breathing. A base
 * is drawn at 96 px and stands still while the player looks at it, so it carries far
 * more simultaneous detail than a 46 px robot could.
 *
 * A missing or half-loaded sheet falls back to the still sprite — `getBaseGaitTextures`
 * is all-or-nothing for the same reason `getRobotGaitTextures` is.
 *
 * The quadrant is 256 because the sheet ships at 512² (`scripts/encode-sprites.mjs`).
 *
 * **An entry here is a *preload* entry**, unlike the encoder's table, which declares
 * a planned asset and skips it with a note. A side listed before its master exists
 * hands the loader a URL that 404s on every page load — console noise, and
 * `npm run shot` exits non-zero on a page error, so it would break the screenshot
 * workflow for everyone. Add a side here only once its `.webp` is committed.
 */
export const baseGaitSprites: Partial<Record<Owner, SpriteDef[]>> = {
  [Owner.Player]: sheet2x2(`${PUBLIC_BASE}base-player-gait.webp`, 256, BASE_TARGET),
  [Owner.AI]: sheet2x2(`${PUBLIC_BASE}base-ai-gait.webp`, 256, BASE_TARGET),
};

/**
 * How long (ms) one full four-cell cycle of a base's idle sheet takes.
 *
 * **The one sheet in this file clocked by time rather than by distance.** A robot's
 * cycle is driven by travel, and `render/gait.ts` explains what that buys: the cycle
 * stops when the unit stops, scales to the chassis speed and slows down when the unit
 * is grinding along behind something. None of it applies to a building — a base never
 * moves, so there is no travel to clock, and a wall-clock period is the whole model.
 *
 * 1200 ms is 300 ms a cell: the radar turns once every 1.2 s and the landing lights
 * chase at ~3.3 lamps a second — awake, not frantic. All four cues on the sheet share
 * this one period by construction, so this is the only knob; raise it if the base
 * reads as jittery rather than alive.
 */
export const BASE_CYCLE_MS = 1200;

/**
 * The observer drone's hover cycle — four cells in cycle order, cell 0 the rest pose.
 * **One sheet for every side**, like `droneSprite` it stands in for, since `DroneView`
 * recolours the art per owner rather than shipping a second set.
 *
 * What cycles is the camera eye breathing and a light running around the four arm
 * tips. What deliberately does *not* is the rotors: they stay soft motion-blur discs,
 * because a ~12 px disc showing four discrete blade positions reads as a **stopped**
 * propeller — the inverse of the `wheels` lesson, and the reason this is spelled out
 * in `.docs/internal/sprites/drone.md` rather than left to taste.
 *
 * The sheet is only half of what makes a drone look airborne. The other half is
 * procedural and needs no art at all — `DroneView` pitches the airframe along its
 * course, trembles it at speed and drifts it up and down on the spot — so the drone
 * animates whether or not this is filled in.
 *
 * **Fill this in only once the `.webp` is committed.** An entry here is a *preload*
 * entry (see `spriteSources`), so declaring a sheet nobody has drawn 404s on every
 * page load and makes `npm run shot` exit non-zero — unlike the encoder's table, which
 * does declare planned art and skips a missing master with a note.
 */
export const droneCycleSprites: SpriteDef[] | undefined = sheet2x2(
  `${PUBLIC_BASE}drone-player-gait.webp`,
  128,
  DRONE_TARGET,
  Math.PI / 2,
);

/**
 * How long (ms) one full four-cell cycle of the drone's hover sheet takes.
 *
 * Timed, not travel-driven, and for a reason `gait.ts` does not cover: a drone hovering
 * dead still is still running — the eye keeps watching, the lights keep blinking. Tying
 * that to distance would switch the machine off whenever it stopped, which is exactly
 * backwards for an aircraft holding station.
 *
 * 1200 ms matches `BASE_CYCLE_MS` on purpose: both are the same kind of "this thing is
 * powered" idle, and two different periods on screen at once read as two unrelated
 * blinkers rather than as one game.
 */
export const DRONE_CYCLE_MS = 1200;

/** On-field size (px) for a ridge decal — ~3 tiles, big enough to be a summit, small enough that a blob fits several. */
const PEAK_TARGET = 90;
/** On-field size (px) for a ground decal — ~5 tiles. */
const GROUND_DECAL_TARGET = 160;

/**
 * Ridge/summit decals laid at the interior high points of a mountain cluster (see
 * `.docs/sprites/terrain-peaks.md`). **The one terrain asset with baked lighting**
 * — it is the lit form itself — so its light direction must match `LIGHT` in
 * `pixi/render/terrain/TerrainView.ts`. Empty/unloaded → clusters draw without
 * peaks, which is a degraded look, not a broken one.
 */
export const peakSprites: SpriteDef[] = sheet2x2(`${PUBLIC_BASE}terrain-peaks.webp`, 256, PEAK_TARGET);

/**
 * The debris halo around a crater cluster, drawn **outside** the blocked footprint
 * on passable ground — which is why it can't be part of the masked fill. Scaled to
 * the cluster's bounding box rather than a fixed size, so it carries no
 * `targetSize`. See `.docs/sprites/terrain-ejecta.md`.
 */
export const ejectaSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}terrain-ejecta.webp`,
};

/**
 * Seamless walkable-ground tile tiled across the whole field (see `createGround`).
 * Undefined → the flat `palette.background` fill.
 */
export const groundSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}ground-tile.webp`,
};

/**
 * The second ground variant, blended over `groundSprite` through a procedural
 * low-frequency mask. Same palette, different surface character: two periods with
 * different phases and a soft mask between them stop the field reading as one
 * repeating texture. Undefined → variant A alone.
 */
export const groundAltSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}ground-tile-alt.webp`,
};

/**
 * Marks scattered over the walkable surface at match start (tracks, scrap,
 * concrete, burn scar). Recognisable objects can't live in the base tiles — they
 * would prove the repeat — so they are placed individually instead. See
 * `.docs/sprites/ground-decals.md`.
 */
export const groundDecalSprites: SpriteDef[] = sheet2x2(`${PUBLIC_BASE}ground-decals.webp`, 256, GROUND_DECAL_TARGET);

/**
 * The species of plateau critter — the small non-combat creatures that sit on the
 * interior of a large mountain cluster and animate there for the whole match.
 *
 * **Deliberately not in `types/src/enums.ts`.** That workspace is the vocabulary the
 * wire protocol and the simulation share; a critter is neither. It is decoration that
 * exists only inside the renderer — no ECS entity, no command, no BARE field, nothing
 * the engine or a peer can even name — so its type has no business travelling that far.
 * See `.docs/internal/sprites/critters.md`.
 */
export const CritterKind = { Warden: 'warden', Crawler: 'crawler', Bloom: 'bloom' } as const;
export type CritterKind = (typeof CritterKind)[keyof typeof CritterKind];

/**
 * On-field diameter (px) per species. Three sizes rather than one because the three
 * silhouettes carry their bulk differently — `warden` is a compact round mass, `crawler`
 * is long and thin and would out-measure it at a shared size while looking lighter (the
 * same area-not-width lesson `LEGS_TARGET` records), and `bloom` is the smallest thing
 * on the field on purpose, since it never moves at all.
 *
 * All three are read against `PEAK_TARGET` (90): a critter must be visibly smaller than
 * the summit decals it shares the plateau with, or it stops being a detail in the
 * landscape and starts being a landmark.
 */
const CRITTER_TARGET: Record<CritterKind, number> = {
  [CritterKind.Warden]: 76,
  [CritterKind.Crawler]: 64,
  [CritterKind.Bloom]: 56,
};

/**
 * Idle-cycle sheets for the plateau critters, one per species. Four cells in cycle
 * order, cell 0 the rest pose, quadrant 256 because each sheet ships at 512².
 *
 * **No `rotationOffset`, and `CritterView` never flips or freely rotates a cell.** Like
 * `peakSprites`, the light is baked into this art (from the upper left, matching `LIGHT`
 * in `pixi/render/terrain/TerrainView.ts`), so turning a cell would move that creature's
 * sun. Species, cycle phase and a few degrees of jitter are all the variety available.
 *
 * A missing or half-loaded sheet means that species simply is not drawn —
 * `getCritterTextures` is all-or-nothing on the same terms as `getBaseGaitTextures`.
 *
 * All three sheets are drawn and preloaded. **Adding a fourth species means adding it to
 * `spriteSources()` only once its `.webp` is committed** — an entry there is a *preload*
 * entry, so declaring art nobody has drawn 404s on every page load and makes
 * `npm run shot` exit non-zero. Until then the defs resolve to `null` and that species is
 * simply not drawn, which is the intended degraded state rather than a broken one.
 */
export const critterSprites: Record<CritterKind, SpriteDef[]> = {
  [CritterKind.Warden]: sheet2x2(`${PUBLIC_BASE}critter-warden-idle.webp`, 256, CRITTER_TARGET[CritterKind.Warden]),
  [CritterKind.Crawler]: sheet2x2(`${PUBLIC_BASE}critter-crawler-idle.webp`, 256, CRITTER_TARGET[CritterKind.Crawler]),
  [CritterKind.Bloom]: sheet2x2(`${PUBLIC_BASE}critter-bloom-idle.webp`, 256, CRITTER_TARGET[CritterKind.Bloom]),
};

/**
 * How long (ms) one full four-cell cycle of a critter's idle sheet takes.
 *
 * Timed rather than travel-driven, for the same reason the base and the drone are: the
 * thing does not move, so there is no distance to clock it by (`render/gait.ts` explains
 * what travel-driven buys and none of it applies here).
 *
 * **Deliberately double `BASE_CYCLE_MS`/`DRONE_CYCLE_MS` (1200), where those two match
 * each other deliberately.** Those are both the "this machine is powered" idle — running
 * lights, a turning dish, a watching camera — and they read as one system because they
 * share a period. A critter is the opposite kind of idle: something breathing, not
 * something switched on. At 1200 it ticks along with the base's landing lights and joins
 * that system; at 2400, 600 ms a cell, it visibly belongs to a slower clock.
 */
export const CRITTER_CYCLE_MS = 2400;

/**
 * The observer drone — **one** art set for every side, unlike the robot and base
 * sprites. `DroneView` recolours it per owner so an enemy drone can't be mistaken
 * for your own. Whole-image art authored facing up → `rotationOffset: Math.PI / 2`.
 * Undefined → the Graphics diamond in `DroneView`. See `.docs/sprites/drone.md`.
 */
export const droneSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}drone-player.webp`,
  rotationOffset: Math.PI / 2,
  targetSize: DRONE_TARGET,
};

/**
 * The single-use FPV strike drone — **one** art set for every side, recoloured by
 * `MunitionView` exactly as the observer is, and for the same reason: a swarm you
 * cannot tell from your own would be misinformation, not a missing polish pass.
 * Undefined → the Graphics dart in `MunitionView`. See `.docs/sprites/drone.md`.
 *
 * **It used to be the odd one out on rotation** — the first master was drawn with its
 * shaped-charge warhead pointing *down*, and since the warhead is the end that reads
 * as "forward", the art was corrected by −90° instead of +90°. The master has since
 * been regenerated nose-up (cone apex and whip antenna at the top), so it now carries
 * the same `Math.PI / 2` as every other whole-image sprite here. Anything that flies
 * backwards after an art change starts here.
 */
export const munitionSprite: SpriteDef | undefined = {
  src: `${PUBLIC_BASE}fpv-munition.webp`,
  rotationOffset: Math.PI / 2,
  targetSize: MUNITION_TARGET,
};

/**
 * Weapon module sprites keyed by **owner → weapon**, overlaid on a robot's
 * central hardpoint (see `.docs/sprites/weapons.md`). A missing entry falls back
 * to the Graphics marker in `RobotView`. Most modules are radially balanced and
 * need no `rotationOffset` even though they inherit the robot's heading; the two
 * barrelled ones (`cannon`, `missiles`) can't be, so they are authored facing up
 * like the robots and carry the same `Math.PI / 2` correction.
 */
export const weaponSprites: Partial<Record<Owner, Partial<Record<WeaponType, SpriteDef>>>> = {
  [Owner.Player]: {
    cannon: {
      src: `${PUBLIC_BASE}weapon-cannon-player.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: WEAPON_TARGET,
    },
    missiles: {
      src: `${PUBLIC_BASE}weapon-missiles-player.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: WEAPON_TARGET,
    },
    radar: {
      src: `${PUBLIC_BASE}weapon-radar-player.webp`,
      targetSize: WEAPON_TARGET,
    },
    bomb: {
      src: `${PUBLIC_BASE}weapon-bomb-player.webp`,
      targetSize: WEAPON_TARGET,
    },
    ew: {
      src: `${PUBLIC_BASE}weapon-ew-player.webp`,
      targetSize: WEAPON_TARGET,
    },
    dew: {
      src: `${PUBLIC_BASE}weapon-dew-player.webp`,
      targetSize: WEAPON_TARGET,
    },
    fpv: {
      src: `${PUBLIC_BASE}weapon-fpv-player.webp`,
      targetSize: WEAPON_TARGET,
    },
  },
  [Owner.AI]: {
    cannon: {
      src: `${PUBLIC_BASE}weapon-cannon-ai.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: WEAPON_TARGET,
    },
    missiles: {
      src: `${PUBLIC_BASE}weapon-missiles-ai.webp`,
      rotationOffset: Math.PI / 2,
      targetSize: WEAPON_TARGET,
    },
    radar: {
      src: `${PUBLIC_BASE}weapon-radar-ai.webp`,
      targetSize: WEAPON_TARGET,
    },
    bomb: {
      src: `${PUBLIC_BASE}weapon-bomb-ai.webp`,
      targetSize: WEAPON_TARGET,
    },
    ew: {
      src: `${PUBLIC_BASE}weapon-ew-ai.webp`,
      targetSize: WEAPON_TARGET,
    },
    dew: {
      src: `${PUBLIC_BASE}weapon-dew-ai.webp`,
      targetSize: WEAPON_TARGET,
    },
    fpv: {
      src: `${PUBLIC_BASE}weapon-fpv-ai.webp`,
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
 * Must stay root-absolute, which `PUBLIC_BASE` now is (`base: '/'`). The value is
 * injected into an inline CSS custom property, so a bare `./menu-backdrop.webp`
 * would resolve against the built CSS bundle under `/assets/` and 404.
 */
export const menuBackdropSrc = `${PUBLIC_BASE}menu-backdrop.webp`;

/**
 * End-of-match splash art, one image per outcome, shown behind `GameOverModal`
 * (see `.docs/sprites/game-over.md`). Same treatment and the same caveats as
 * `menuBackdropSrc`: a DOM background, never a Pixi texture, absent from
 * `spriteSources()`, and a missing file degrades to the plain dark backdrop.
 *
 * `abandoned` is generated but shown by nothing yet — a disconnect currently
 * drops back to the title screen with a line of text in `OnlinePanel`. It is here
 * for the Technical Loss feature to pick up.
 */
export const gameOverBackdropSrc = {
  victory: `${PUBLIC_BASE}game-over-victory.webp`,
  defeat: `${PUBLIC_BASE}game-over-defeat.webp`,
  abandoned: `${PUBLIC_BASE}game-over-abandoned.webp`,
} as const;

/** Unique image sources to preload (robots + bases + weapon modules + terrain + decals). */
export function spriteSources(): string[] {
  const srcs: string[] = [];
  for (const byChassis of Object.values(robotSprites)) {
    if (!byChassis) continue;
    for (const def of Object.values(byChassis)) if (def) srcs.push(def.src);
  }
  // Four defs per sheet, one file — the de-dupe at the end collapses them.
  for (const byChassis of Object.values(robotGaitSprites)) {
    if (!byChassis) continue;
    for (const defs of Object.values(byChassis)) for (const def of defs) srcs.push(def.src);
  }
  for (const def of Object.values(baseSprites)) if (def) srcs.push(def.src);
  // Four defs per sheet, one file — same as the robot gaits above.
  for (const defs of Object.values(baseGaitSprites)) for (const def of defs) srcs.push(def.src);
  for (const byWeapon of Object.values(weaponSprites)) {
    if (!byWeapon) continue;
    for (const def of Object.values(byWeapon)) if (def) srcs.push(def.src);
  }
  for (const def of Object.values(terrainSprites)) if (def) srcs.push(def.src);
  for (const def of peakSprites) srcs.push(def.src);
  for (const def of groundDecalSprites) srcs.push(def.src);
  // Four defs per sheet, three files — the de-dupe at the end collapses them.
  for (const defs of Object.values(critterSprites)) for (const def of defs) srcs.push(def.src);
  if (ejectaSprite) srcs.push(ejectaSprite.src);
  if (groundSprite) srcs.push(groundSprite.src);
  if (groundAltSprite) srcs.push(groundAltSprite.src);
  if (droneSprite) srcs.push(droneSprite.src);
  // Four defs, one file — the de-dupe at the end collapses them.
  if (droneCycleSprites) for (const def of droneCycleSprites) srcs.push(def.src);
  if (munitionSprite) srcs.push(munitionSprite.src);
  return [...new Set(srcs)];
}
