/**
 * Placeholder colours. Everything is a coloured shape until real art lands, so
 * all colour choices live here and are keyed by role. Values are 0xRRGGBB ints
 * (the form Pixi's Graphics fill/stroke APIs expect).
 */
export const palette = {
  background: 0x0d1117,
  owner: {
    /** The viewing client's own side, whichever `Owner` that happens to be. */
    player: 0x3b82f6,
    /** The nearest thing to "the enemy colour" — first opponent, and the fallback. */
    ai: 0xef4444,
    neutral: 0x9ca3af,
  },
  /**
   * Colours dealt to opposing sides, in roster order. The local side always takes
   * `owner.player`, so these only ever have to be distinct from each other and
   * from blue — see `pixi/render/ownerColor.ts`.
   */
  opponents: [0xef4444, 0xf59e0b, 0xa855f7] as const,
  obstacle: {
    /** Mountain placeholder (art missing) — raised rock, so the lighter of the two. */
    fill: 0x3a3f4a,
    /** Crater placeholder — a pit, so darker than the mountain and than the ground. */
    crater: 0x161c25,
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
  /** Temporary status effects drawn on a robot. */
  status: {
    /** Directed-energy knock-out: the arc over a robot whose electronics are down. */
    disabled: 0x7dd3fc,
  },
  /** Selection + orders the local player has given (robots, base, rally point). */
  selection: {
    /** Outline around a selected robot or base. */
    ring: 0xfde047,
    /** The selected base's rally flag and its leader line. */
    rally: 0xfde047,
  },
  /**
   * Feedback on the order the player is giving right now: the marker left at a
   * right-clicked point, and the highlight on the enemy under the cursor. One
   * colour for "this is a hostile action" — `attack` is shared by both.
   */
  order: {
    /** Move order dropped on open ground. */
    move: 0x4ade80,
    /** Attack order, and the hover highlight on a target the selection can attack. */
    attack: 0xef4444,
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
