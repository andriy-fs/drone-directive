/**
 * Placeholder colours. Everything is a coloured shape until real art lands, so
 * all colour choices live here and are keyed by role. Values are 0xRRGGBB ints
 * (the form Pixi's Graphics fill/stroke APIs expect).
 */
export const palette = {
  background: 0x0d1117,
  grid: {
    line: 0x1f2733,
    lineMajor: 0x2e3a4a,
    /** Every Nth line is drawn with the "major" colour. */
    majorEvery: 5,
  },
  owner: {
    player: 0x3b82f6,
    ai: 0xef4444,
    neutral: 0x9ca3af,
  },
  obstacle: {
    fill: 0x3a3f4a,
    edge: 0x555c68,
  },
  vision: {
    /** Sight-radius ring drawn around the player's own robots/bases. */
    zone: 0x60a5fa,
    /** Highlight ring on an enemy the instant it's spotted (within sight). */
    spotted: 0xf59e0b,
  },
  blast: {
    /** Kamikaze blast-radius ring, shown on every bomb-armed robot, both sides. */
    zone: 0xef4444,
  },
  fog: {
    /** Overlay colour for both fog states (unexplored + remembered). */
    color: 0x0d1117,
    /** Never-seen tiles: opaque, hides the terrain beneath. */
    hiddenAlpha: 1,
    /** Explored-but-not-currently-visible tiles: dimmed, terrain remembered. */
    dimAlpha: 0.5,
  },
  /** The player's observer drone marker. */
  drone: {
    body: 0x22d3ee,
    edge: 0x0e7490,
  },
} as const;
