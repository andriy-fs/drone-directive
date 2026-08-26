/**
 * Placeholder colours. Everything is a coloured shape until real art lands, so
 * all colour choices live here and are keyed by role. Values are 0xRRGGBB ints
 * (the form Pixi's Graphics fill/stroke APIs expect).
 *
 * **`weapon` is the exception to "placeholder".** Those seven are the colour code
 * the *art* is authored against as well — `.docs/sprites/weapons.md` quotes this
 * table, so a change here is a change to the sprite briefs and means regenerating
 * the modules. Everything else in this file is free to move on its own.
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
  /**
   * **Which gun a robot carries, told by colour.** A weapon module is drawn 30 px
   * wide and the camera has no zoom, so that is the only size a player ever sees
   * it at — and a 64:1 downscale of the master averages fine detail away while
   * preserving mean colour exactly. Colour is therefore the highest-fidelity
   * channel left at that size, and these seven are what it carries.
   *
   * Two rules govern the values, and both are load-bearing:
   *
   * 1. **Muted, "material" tones only.** The saturated part of the wheel is spoken
   *    for by *state* elsewhere in this file (`order.attack`, `selection.ring`,
   *    `vision.spotted`, `status.disabled`, `opponents`). A permanent property of
   *    a unit must not wear the colour of a passing one, or "this robot has a
   *    cannon" reads as "this robot is under attack".
   * 2. **Spread by lightness, not just hue.** Roughly 8% of men cannot separate
   *    red from green, so the ladder below (dew brightest → missiles darkest) is
   *    the fallback channel, and the grayscale check in the sprite briefs is what
   *    proves it still holds.
   *
   * `dew` deliberately shares its cold white-blue with `status.disabled`: that is
   * the weapon and the effect it inflicts, and they *should* rhyme.
   */
  weapon: {
    /** Brass barrel and breech — the plain workhorse gun. */
    cannon: 0xc8a34a,
    /** Oxidised brick-red launch tubes; the darkest module, as befits the heaviest. */
    missiles: 0xa8543a,
    /** Hazard chevrons on the kamikaze payload — the only *striped* module in the set. */
    bomb: 0xe0b13c,
    /** The black half of the bomb's chevrons; paired with `bomb`, never used alone. */
    bombStripe: 0x1a1a1a,
    /** Pale jade dish enamel — a sensor, and the lightest thing on the field after `dew`. */
    radar: 0xa9dcc8,
    /** Plum dielectric on the jammer's aerials. */
    ew: 0x8a72ab,
    /** Ice white-blue plasma over the emitter coils; the brightest module. */
    dew: 0xd8eef7,
    /** Matte olive-drab canister of the FPV carrier. */
    fpv: 0x7d8452,
  },
  /**
   * The one-shot energy dome over a base (`pixi/render/ShieldDomeView.ts`). Only
   * the *energy* is coloured here — the dome's ring takes `ownerColor`, so yours
   * reads blue and a rival's red without a second decision.
   */
  shield: {
    /** Inner shimmer and fill: cold and faint enough to tint what is under it, not hide it. */
    glow: 0x7dd3fc,
    /** The snap when a round is absorbed — white, so it reads against any owner colour. */
    hit: 0xffffff,
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
  /**
   * A side's observer drone marker. Every side flies one, so the local drone
   * keeps these colours and the others are recoloured by owner — see
   * `pixi/render/DroneView.ts`.
   */
  drone: {
    body: 0x22d3ee,
    edge: 0x0e7490,
  },
  /**
   * The dust a moving unit kicks up behind its drive (`pixi/render/dust.ts`).
   *
   * A warm gray, deliberately nothing like `fog.color` (which is `background`): the
   * trail is drawn over lit ground and must read as something *added* to it, where
   * anything near the background colour would read as a hole punched in the field.
   */
  dust: {
    plume: 0xb3a894,
  },
  /**
   * The wireframe hull view — what the pilot sees once a drone lands on a robot
   * (`pixi/render/fpv/`). A phosphor monitor of the early 1980s: one green for the
   * ground, and three roles on top of it that have to be told apart at a glance.
   *
   * **Here rather than in `client/src/theme/**` deliberately.** The battlefield is
   * not themed, and this view *is* the battlefield — seen from a different place.
   *
   * The three unit roles are spread by hue *and* lightness for the same reason
   * `weapon` is: on a screen this noisy, "which of those two contours is mine" must
   * not rest on red-versus-green.
   */
  fpv: {
    /** Behind everything — the tube's own black, darker than `background`. */
    void: 0x030c07,
    /** The ground grid. The dimmest of the five: it is the page, not the writing. */
    terrain: 0x2fdc7a,
    /** The hull the pilot is riding, drawn from behind. The brightest thing on the screen. */
    self: 0xd6ffe8,
    /** Another machine of this side. */
    friend: 0x63d0ff,
    /** Anything belonging to anyone else. */
    foe: 0xff7a5c,
    /**
     * A part running hot: a barrel that has just fired, a drive under load
     * (`pixi/render/fpv/units.ts`).
     *
     * Amber, and drawn **thicker** than the structure under it (see `units.ts`).
     * Colour alone could not carry this: `self` is already a near-white, so a
     * white-hot node would vanish on the one machine the player looks at most,
     * and anything redder would collide with `foe`. Warm *and* fat reads as
     * emission on all three roles — which is the whole job, since a glowing
     * barrel on a hostile contour is the most valuable thing on this screen.
     */
    heat: 0xffbe52,
  },
  /** The launcher of a base's built-in missile battery, drawn over the body. */
  turret: {
    body: 0x9aa4b2,
    edge: 0x0b0e13,
  },
} as const;
