/**
 * Graphics quality: how many pixels the renderer is asked to fill.
 *
 * Exists because fill rate turned out to be what the field costs
 * (`.docs/tasks/terrain-render-cost.md`). Two levers dominate everything else and
 * neither belongs in a constant: MSAA cost scales with the number of passes, and
 * `devicePixelRatio` squares the whole scene — at dpr 2 every layer shades four
 * fragments per CSS pixel. Capping dpr at 1.5 removes 44% of them across units,
 * terrain and UI alike, which is wider than any single-layer optimisation can
 * reach.
 *
 * That is a trade the player should make, not the code: it buys frames with
 * sharpness, and which side of that is right depends on their machine and their
 * screen. So this module owns the choice, persists it and applies what it can
 * live — the same shape as `audio/sfx.ts`, and for the same reason (a preference
 * that outlives any match and that the world never reads).
 *
 * **Only the resolution cap applies live.** `antialias` is a WebGL context
 * creation flag, so changing it needs the renderer rebuilt; the UI says so rather
 * than pretending otherwise.
 */

export const GRAPHICS_QUALITIES = ['high', 'medium', 'low'] as const;
export type GraphicsQuality = (typeof GRAPHICS_QUALITIES)[number];

const STORAGE_KEY = 'dd:gfxQuality';
/**
 * **`medium`, not `high`** — the default has to be the setting that renders at a
 * sane number of pixels, because `high` deliberately puts *no* ceiling on
 * `devicePixelRatio` at all.
 *
 * Measured in Firefox on one machine, same seed, same spot: `high` (res 2) on a
 * 60×60 map ran at 56 fps / 17.9 ms mean, while res 1 on an *80×80* map — a bigger,
 * more expensive field — ran at 78 fps / 12.8 ms. Nothing changed but the pixel
 * count. Across the same runs the main thread stayed ~90% idle (`busy` 1.3–1.9 ms
 * against a 12–18 ms frame), so none of that time was the game's own code: it was
 * fill rate, and no optimisation reaches it. Only fewer pixels do.
 *
 * `high` stays available and unchanged for whoever has the GPU for it. What it must
 * not be is what an unknown machine gets handed on first boot, where at dpr 2 it is
 * 4× the fragments and on a 4K screen considerably worse.
 */
const DEFAULT: GraphicsQuality = 'medium';

/**
 * Per level: whether MSAA is on, and the ceiling put on `devicePixelRatio`.
 *
 * **`medium` drops MSAA and keeps the sharper buffer, which is the opposite of what
 * this table used to do.** The old ordering assumed the resolution step was the
 * better trade — cheaper in frames, dearer in looks — and that turned out to be
 * backwards on cost. Measured in Firefox on the large map, same seed, same eight
 * units on the field, same `resolution: 1.5`, MSAA the only variable:
 *
 * - MSAA on — 57 fps, 17.5 ms mean
 * - MSAA off — 71 fps, 14.0 ms mean
 *
 * 3.5 ms, a fifth of the frame. The step from 1.5 to 1 buys about 1.2 ms by
 * comparison, so sharpness is roughly three times cheaper per frame than smooth
 * edges. `medium` now spends its budget accordingly, and `low` remains the level
 * that also gives up pixels.
 *
 * `high` keeps MSAA *and* leaves `devicePixelRatio` uncapped, so it stays the level
 * for whoever has the GPU to spend on both. It is no longer the default; see
 * `DEFAULT`.
 *
 * **Two things this does not rest on, and a later measurement may move it back.**
 * The numbers above are one browser on one machine: MSAA is resolved by the driver,
 * and Firefox's WebGL and Chrome's ANGLE do not take the same path to it, so the
 * ratio is not safe to assume elsewhere. And what the old ordering claimed was half
 * a *taste* judgement — that aliased Graphics edges are worse to look at than a
 * softer buffer — which no frame time can settle either way. Flipping the table
 * decided that too, on the grounds that the complaint being answered was about
 * frame rate.
 */
const LEVELS: Record<GraphicsQuality, { antialias: boolean; maxResolution: number }> = {
  high: { antialias: true, maxResolution: Number.POSITIVE_INFINITY },
  medium: { antialias: false, maxResolution: 1.5 },
  low: { antialias: false, maxResolution: 1 },
};

function isQuality(value: unknown): value is GraphicsQuality {
  return typeof value === 'string' && (GRAPHICS_QUALITIES as readonly string[]).includes(value);
}

function load(): GraphicsQuality {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isQuality(stored) ? stored : DEFAULT;
  } catch {
    // Private-mode / blocked storage. A preference that cannot be saved is not
    // worth failing a boot over.
    return DEFAULT;
  }
}

let current = load();
const listeners = new Set<(resolution: number) => void>();

/**
 * The antialias flag the renderer was actually created with. Captured at module
 * load — which is before `GameApp.init` reads it — so "does this need a reload"
 * can be answered by comparing against what is really on screen rather than
 * against the previous setting. Picking `low` and then `high` again should stop
 * asking for a reload, and comparing to the previous value would not notice.
 */
const bootAntialias = LEVELS[current].antialias;

/** Device pixel ratio clamped by the current level. Never above what the display offers. */
function resolutionFor(quality: GraphicsQuality): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(dpr, LEVELS[quality].maxResolution);
}

export const graphicsQuality = {
  get(): GraphicsQuality {
    return current;
  },

  set(quality: GraphicsQuality): void {
    if (quality === current) return;
    current = quality;
    try {
      localStorage.setItem(STORAGE_KEY, quality);
    } catch {
      // Same as above: the setting still applies for this session.
    }
    for (const listener of listeners) listener(resolutionFor(quality));
  },

  /** Read once, when the renderer is created — see the note about the context flag. */
  antialias(): boolean {
    return LEVELS[current].antialias;
  },

  resolution(): number {
    return resolutionFor(current);
  },

  /** True when the current setting differs from what is on screen and needs a reload to fully apply. */
  needsReload(): boolean {
    return LEVELS[current].antialias !== bootAntialias;
  },

  /** `GameApp` subscribes to push the live half of the change into the renderer. */
  onResolutionChange(listener: (resolution: number) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
