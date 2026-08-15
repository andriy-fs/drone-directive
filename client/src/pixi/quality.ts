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
const DEFAULT: GraphicsQuality = 'high';

/**
 * Per level: whether MSAA is on, and the ceiling put on `devicePixelRatio`.
 *
 * `medium` keeps antialiasing and only caps the resolution because that ordering
 * matched the measurements — dropping to 1.5 costs less visible quality than
 * losing MSAA on every Graphics edge in the HUD, and saves more.
 */
const LEVELS: Record<GraphicsQuality, { antialias: boolean; maxResolution: number }> = {
  high: { antialias: true, maxResolution: Number.POSITIVE_INFINITY },
  medium: { antialias: true, maxResolution: 1.5 },
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
