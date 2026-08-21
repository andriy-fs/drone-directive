import { Owner, WeaponType, type MapSize } from '@drone-directive/types/enums';
import type { Rng } from '../utils/rng';

/** Where one side's base starts; `tx`/`ty` is its top-left tile. */
export interface BasePlacement {
  owner: Owner;
  tx: number;
  ty: number;
}

/**
 * Central tunables for the game. Kept dependency-free so both the engine and the
 * Pixi layer can import it without pulling in React or Pixi types.
 */
export const gameConfig = {
  /** Battlefield dimensions, measured in tiles. Resized per match by `applyMapSize`. */
  grid: {
    width: 40,
    height: 40,
    /** Pixel size of a single tile in world space. */
    tilePx: 32,
  },

  /** Tile-count lookup for MapSize presets (square maps: width = height). */
  mapSize: {
    small: 40,
    medium: 60,
    large: 80,
  },

  /** Camera behaviour. */
  camera: {
    /** World units moved per second when panning with the keyboard. */
    keyboardPanSpeed: 600,
    /** Multiplier applied to pointer-drag deltas. */
    dragSpeed: 1,
    minZoom: 0.5,
    maxZoom: 2,
  },

  /** Bases: production points, one per side. */
  bases: {
    // Balance pass (Phase 8): 600 keeps a base assault decisive without dragging.
    maxHp: 600,
    /** Footprint side length, in tiles (occupies footprint x footprint cells). */
    footprintTiles: 3,
    /**
     * Starting placements, one per side in the match; tx/ty is the top-left tile.
     * Rewritten per match by `applyMapSize` (grid size) + `applySidePlacements`
     * (which sides are playing and which corner each drew) — read them live,
     * never copy at module scope. The two entries here are just the resting
     * 1v1 layout before a match is configured.
     */
    placements: [
      { owner: Owner.Player, tx: 4, ty: 33 },
      { owner: Owner.AI, tx: 33, ty: 4 },
    ] as BasePlacement[],
    /** Detection radius (px): a base's own "radar" — enemies within this become known. */
    sightRange: 260,
    /**
     * Built-in missile battery: one launcher, statted exactly like a robot's
     * `missiles` (see `robots.weapons`). Range is measured from the footprint
     * centre — so is a robot's shot at the base — which keeps the duel even
     * rather than handing the building a free stand-off advantage. There is
     * deliberately no second barrel: a cannon on top would make storming a base
     * unrealistic, and the battery exists to answer the observer drone, which
     * nothing else on a base could touch.
     */
    weapon: WeaponType.Missiles,
    /**
     * Passive repair, hp/second — 1 hp every 2.5 s, twice the robot rate (a base
     * has crews and spare parts on site). At 600 hp a full rebuild still takes
     * ~25 minutes, so it rewards surviving a raid rather than tanking one.
     * Suspended for `combat.regenDelay` after every hit — see `systems/regen.ts`.
     */
    regenPerSecond: 0.4,
    /**
     * "Last hope": one energy dome per base per match, and the only thing in the
     * game that answers a full assault. It is **armor, not a wall** — nothing
     * about pathing, line of sight or collision changes; every point of damage
     * aimed at the *building* comes off the dome first, from any source and any
     * position, and the overkill on the hit that breaks it spills through. See
     * `systems/shield.ts`.
     *
     * The numbers, against a 15 dps chassis: a raid of four is denied outright,
     * seven crack the dome at ~12 s (base survives 17.5 s instead of 5.7 s),
     * twelve still break through in 6 s. A kamikaze stays the most efficient way
     * to push it over (300 for 90 resources) — it just stops being a way *past*
     * it.
     */
    shield: {
      /**
       * Dome radius (px) from the footprint centre — one tile of clearance
       * beyond the 3-tile footprint (48 + 32), so the shell reads as a dome over
       * the *building* rather than a zone over the ground.
       *
       * **The ceiling on this number is the shortest weapon in the game.** A
       * robot drives at the base's centre and stops the instant it is in range
       * (`engageOutcome`), so a `cannon` (range 120) parks with the edge of its
       * hull 109 px out. The first value tried here was 112, which put every
       * attacker's body *inside* the shell — a shield that visibly did nothing.
       * 80 leaves ~29 px of clear ground under a cannon and ~90 under missiles,
       * while `bomb` (range 60) must still drive inside to trigger, so the
       * kamikaze counter is untouched. Push this back above ~100 and the dome
       * starts swallowing the people shooting at it again.
       */
      radius: 80,
      /** Seconds the dome stands before powering down on its own. */
      duration: 20,
      /** Dome strength: damage aimed at the base comes off this until it runs out. */
      hp: 1000,
      /**
       * Dome self-repair, hp/second. Runs only while the dome is up and — unlike
       * the base's own `regenPerSecond` — is never suspended by a hit: a shield
       * that stopped mending under fire would be a shield that only works out of
       * combat. This is the knob that sets how many attackers the dome shrugs
       * off entirely (20 hp/s ≈ 1.3 chassis).
       */
      regenPerSecond: 20,
    },
  },

  /** Observer drone: the player's flying "eye" (see systems/drone.ts). */
  drone: {
    /** Flight speed, px/second (free flight — obstacles never block it). */
    speed: 280,
    /** Detection radius (px): reveals fog + spots enemies like any scout. */
    sightRange: 220,
    /** Max distance (px) to an idle robot to land on / possess it. */
    possessRadius: 40,
    /** Hull strength. At `missiles` damage (22) that's three hits to bring one down. */
    maxHp: 60,
    /** Collision radius (px) for anti-air fire — see `systems/combat.ts`. */
    hitRadius: 14,
    /** Seconds a side spends without an eye after losing one, before a fresh drone rolls out. */
    respawnTime: 30,
  },

  /**
   * The single-use FPV strike drone — the body a `salvo` weapon launches, and the
   * game's second flying entity (see `systems/munition.ts`). Stats live here rather
   * than on the weapon because they describe the *munition*, not the launcher: a
   * second salvo weapon would reuse this body and differ only in `salvo`/`damage`.
   *
   * `speed` × `flightTime` is the real reach — 1680 px, comfortably past the small
   * map's diagonal (1810) and well short of the large one's (3620). That is the
   * knob to turn to make the carrier a siege weapon or a local one; the weapon's
   * own `range` is deliberately not it.
   */
  munition: {
    /** Flight speed, px/second (free flight — obstacles never block it). */
    speed: 240,
    // NB: `speed × flightTime` is the weapon's real reach — see `munitionReach()`.
    /** Seconds a drone stays airborne. Time out = it falls, dealing nothing. */
    flightTime: 7,
    /** Hull strength — under any `canHitAir` damage (missiles deal 22), one hit is enough. */
    hp: 8,
    /** Collision radius (px), both for anti-air fire and for reaching its target. */
    hitRadius: 8,
    /** Radius (px) of the ring a salvo spreads over on launch, so five don't stack into one dot. */
    launchRing: 16,
  },

  /** Robots: per-chassis stats and shared draw/movement tunables. */
  robots: {
    /** Collision / draw radius in pixels. */
    radius: 11,
    /** Distance (px) within which a robot is considered to have arrived. */
    arrivalThreshold: 2,
    /**
     * Passive repair, hp/second — 1 hp every 5 s, deliberately slow: 6–13 minutes
     * to rebuild a 70–160 hp chassis, so pulling a damaged unit out of the line
     * is worth doing but never replaces building a new one. Suspended for
     * `combat.regenDelay` after every hit — see `systems/regen.ts`.
     */
    regenPerSecond: 0.2,
    /** Stats keyed by ChassisType value. speed is px/second, sight is detection radius in px. */
    chassis: {
      tracks: { hp: 120, speed: 60, sight: 190 },
      // Fastest hull and the widest eyes, paid for with the thinnest armour: 70 hp
      // is one cannon burst. The speed is what makes that trade worth taking — it
      // is how the wheels reach a flank, or a spotting position for a missile
      // hull, before the shot that kills them lands.
      wheels: { hp: 70, speed: 135, sight: 230 },
      legs: { hp: 160, speed: 42, sight: 210 },
    },
    /**
     * Weapon stats keyed by WeaponType value. range/cooldown/damage as before.
     * `explosionRadius` (px) only matters for `bomb` — the kamikaze AOE blast
     * radius on detonation. `sightMultiplier` scales the chassis's own `sight`
     * stat (see `chassis` above); only `radar` raises it, everything else is 1
     * (no-op). `jamRadius` (px) only matters for `ew` — see `combat.jamMultiplier`.
     * `canHitAir` marks a surface-to-air weapon: only those can engage an **air**
     * entity — an enemy observer drone or an FPV strike drone in flight (a
     * howitzer plainly can't). Today that's `missiles` alone — a dedicated AA
     * weapon would just be another entry with the flag on.
     * `freezeDuration` (seconds) only matters for `dew` — how long a hit leaves
     * the target disabled; it is also what makes a zero-damage weapon count as
     * armed at all (see `canEngage` in `systems/combat.ts`).
     * `range` is reach alone, never sight: a weapon that outranges its hull's own
     * `sight` (today `missiles`, at 255 against the widest chassis's 230) can only
     * use the surplus against a target some ally is watching *right now* — see
     * `isKnownTo` in `systems/targeting.ts`, applied to every weapon in
     * `fireWeapon`. Raising a range past a chassis `sight` therefore buys
     * dependence on a spotter, not free blind fire.
     * `salvo` (>0) turns the weapon into a **launcher**: instead of one round it
     * releases that many single-use flying munitions, each carrying this weapon's
     * own `damage` (see the `munition` block above and `systems/munition.ts`).
     * Only `fpv` has it, and it is what exempts the weapon from the line-of-sight
     * check — drones fly over mountains (`needsLineOfSight` in `systems/combat.ts`).
     */
    weapons: {
      none: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 0,
      },
      cannon: {
        range: 180,
        damage: 12,
        cooldown: 0.8,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 0,
      },
      // The only surface-to-air weapon: doubles as this side's answer to an enemy
      // drone — and, since `fpv` exists, the only thing that can shoot a salvo down.
      missiles: {
        range: 255,
        damage: 22,
        cooldown: 1.6,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: true,
        freezeDuration: 0,
        salvo: 0,
      },
      // Kamikaze: closes to `range` then detonates, dealing `damage` in `explosionRadius`, destroying itself.
      // range (90) must exceed a base's half-footprint (48px) so it can trigger at the base's edge, not only inside it.
      // damage doubled (150 → 300) so building one is worth it against a base/cluster, not just chip damage.
      // `explosionRadius` must stay comfortably **above** `range`: the trigger is measured centre-to-centre
      // while the blast reaches `explosionRadius + robots.radius`, so a radius at or below the trigger
      // distance would detonate on the rim of its own blast — the aimed target barely clipped and everything
      // standing behind it untouched, which is the opposite of what a kamikaze is bought for.
      bomb: {
        range: 90,
        damage: 300,
        cooldown: 0,
        explosionRadius: 120,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 0,
      },
      /** Unarmed spotter: no damage, but doubles detection radius. */
      radar: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 2,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 0,
      },
      /**
       * Unarmed jammer. `jamRadius` does **two** jobs, both passive: it halves the
       * effective sight range of enemy scouts standing inside it (see
       * `combat.jamMultiplier`), and it drops enemy FPV strike drones that fly into
       * it outright — a munition inside the bubble falls without dealing damage
       * (`systems/munition.ts`). The second job is what makes this the hard counter
       * to `fpv`, the way `missiles` is the soft one.
       */
      ew: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 150,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 0,
      },
      // Directed-energy weapon: the cannon's reach and price, but it deals no damage at
      // all — a hit disables the target for `freezeDuration` seconds instead. Control,
      // not attrition, so the long cooldown is the whole balance lever.
      dew: {
        range: 120,
        damage: 0,
        cooldown: 5,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 8,
        salvo: 0,
      },
      /**
       * FPV carrier: one pull of the trigger releases `salvo` single-use strike
       * drones, each carrying this weapon's own `damage` (5 × 12 = 60 a volley) and
       * living `munition.flightTime` seconds. See `systems/munition.ts`.
       *
       * **`range` here is not a reach — it is "anywhere".** 4000 clears the diagonal
       * of the largest map (80 tiles ≈ 3620 px), so the number that actually bounds
       * this weapon is *reconnaissance*: it fires only at a target the side can see
       * right now. That rule is not this weapon's own — every weapon obeys it (see
       * `fireWeapon`) — but this is the one hull where it is the *only* bound, which
       * is why the extra `withinMunitionReach` gate exists alongside it. A third
       * gate keeps a crowd of carriers from emptying every tube into one scout:
       * no volley is launched at a target the drones already in the air will kill
       * (`alreadyDoomed`), so what is saved is the nine-second reload.
       * Three consequences worth knowing before touching it:
       *
       * - line of sight is not checked (`salvo > 0`), because at this reach a
       *   mountain always stands in the way and the drones fly over it anyway;
       * - the carrier therefore never advances — `engageOutcome` finds every target
       *   already "in range" and holds. That is deliberate: this is artillery, not a
       *   brawler, and no program needs to be forbidden to it;
       * - the `enemyRobotWithin` directive condition defaults to weapon range, so it
       *   is always true for this hull. Harmless (it only picks the fire target) but
       *   it is why the number must not be copied onto anything that moves.
       *
       * Sustained damage is deliberately poor — 60 per 9 s ≈ 6.7 dps against a
       * cannon's 15 — so what is bought is burst, reach and ignoring terrain.
       */
      fpv: {
        range: 4000,
        damage: 12,
        cooldown: 9,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 5,
      },
    },
  },

  /** Combat tunables (projectiles, engagement distances). */
  combat: {
    /** Projectile travel speed, px/second. */
    projectileSpeed: 340,
    /** Projectile lifetime, seconds (also caps effective range). */
    projectileTtl: 1.5,
    /** Projectile collision/draw radius, px. */
    projectileRadius: 3,
    /** Stand-off distance (px) an unarmed attacker stops at so it doesn't jam. */
    unarmedStandoff: 40,
    /** EW jamming aura: multiplies an enemy scout's effective sightRange while inside an `ew` robot's `jamRadius`. */
    jamMultiplier: 0.5,
    /**
     * Seconds without passive repair after taking a hit. Lives here rather than
     * in `behavior` because it is a property of being damaged — it applies to
     * bases too, which have no directives at all.
     */
    regenDelay: 6,
  },

  /** Reactive behaviour tunables (used by the directive resolver). */
  behavior: {
    /** Seconds a robot stays "under fire" after being hit (drives dodge/return-fire). */
    underFireDuration: 1.2,
    /** Perpendicular strafe distance (px) a dodging robot aims for each tick. */
    evadeDistance: 48,
    /** Max distance (px) a Guard patrols from its post — perimeter defence, not a whole-map search. */
    guardPatrolRadius: 240,
    /** Overwatch: distance (px) behind an advancing friendly group's centroid an unarmed spotter trails at. */
    overwatchTrailDistance: 180,
    /**
     * Overwatch, but for a jammer: an `ew` hull trails this close instead, because
     * its job is an *aura* rather than a pair of eyes. The spotter's 180 px sits
     * outside `weapons.ew.jamRadius` (150), so a jammer keeping the scout's
     * distance protects nobody at all — the one thing it exists to do. Kept well
     * inside the bubble rather than at its rim so the group it trails stays
     * covered while the gap breathes.
     */
    jammerTrailDistance: 90,
    /**
     * DefendBase: an enemy this close (px) to the robot's **own base** is
     * intercepted. Deliberately wider than `ai.threatRange` (220), so the
     * defence line is already moving by the time the bot calls itself
     * threatened, and wide enough to cover a ranged unit shooting from outside.
     */
    defendBaseRadius: 280,
    /** DefendBase: radius (px) around the base it patrols while there is nobody to intercept. */
    defendPatrolRadius: 200,
    /** GroupAttack: allies on the same directive (still gathering) needed before the group sets off. */
    groupAttackSize: 3,
    /** GroupAttack: radius (px) around the base inside which waiting units count as one gathering group. */
    groupGatherRadius: 300,
    /**
     * Anti-jam: a robot with a non-idle program that wants to move (has a goal)
     * or is trapped inside a base, yet makes < `stuckEpsilon` px net progress for
     * `stuckAfter` s, backs off — it drives back the way it came (or straight out
     * of a base) for `retreatSeconds` s to clear the jam, then re-approaches.
     * Smooth reversal, not a teleport.
     */
    stuckEpsilon: 0.5,
    stuckAfter: 0.4,
    retreatSeconds: 0.5,
    /**
     * Formation keeping — see `engine/systems/task/formation.ts`.
     *
     * `spacing` is per shape because the shape *is* the trade-off: at 36 px a
     * 3×3 box has a half-diagonal of ~76 px, comfortably inside an `ew` hull's
     * `jamRadius` (150) — and just as comfortably inside a kamikaze's blast
     * (`explosionRadius` 120 plus `robots.radius`). `spread` is set past that
     * blast on purpose: it buys survival against area damage by giving up the
     * jammer's bubble, and those are the only two ways to be wrong here.
     *
     * `lead` is how far ahead of the group's own centroid the whole frame is
     * projected each tick, which is what makes a formation *walk*: stragglers
     * pull the centroid back and the slots come back with it, so the group
     * paces itself to its slowest member with no leader and no stored state. It
     * must exceed `grid.tilePx` (32) or `setGoal` would keep finding the goal in
     * the same tile and never re-path.
     *
     * `slack` is how close to its slot counts as "dressed" — below it the unit
     * holds instead of shuffling. `bombReleaseRange` is how near the enemy the
     * group must be before a kamikaze stops holding the line and runs its own
     * program: staying in formation all the way in would waste the one unit
     * whose whole purpose is to arrive alone.
     */
    formation: {
      /**
       * Interval between neighbouring slots, per shape, plus the nose-to-tail
       * interval of the single file — which is not a shape the player can order
       * but the one the *terrain* falls back to when nothing wider fits (see
       * `Layout` in `systems/task/formation.ts`).
       */
      spacing: { file: 40, line: 44, box: 36, spread: 140 },
      lead: 64,
      /**
       * Ceiling on how far from its slot a robot may sit and still count as
       * dressed. A ceiling and not the number itself: the usable tolerance is a
       * function of `spacing`, because a formation shares the field with
       * `systems/separation.ts`, which shoves apart anything closer than
       * `robots.radius * 2`. Two neighbours each allowed to drift `slack` toward
       * each other close the gap by `2 * slack`, so a tolerance wider than half
       * the clearance between `spacing` and that push distance makes the two
       * systems fight: separation opens the gap, the slot pulls it shut, and the
       * pair judders forever. See `slackFor` in `systems/task/formation.ts` —
       * this value only caps a shape (like `spread`) whose spacing is so wide the
       * derived tolerance would otherwise be useless.
       */
      slackCap: 12,
      /**
       * Hysteresis on holding: a robot settles inside `slack` but does not set
       * off again until it is this many times further out. With one threshold
       * for both, a robot on the boundary flips between holding and driving every
       * tick — and every flip is a `setGoal`/`clearGoal` pair with a fresh A* in
       * it. The band is what makes a stopped formation actually stop.
       */
      holdReleaseFactor: 2,
      bombReleaseRange: 260,
      /**
       * How long a group may fail to advance along its own route before the
       * shape stops being in charge of it, and how long it then drives on its
       * members' own orders. See `releaseValve` in `systems/task/formation.ts`.
       *
       * Two seconds is far longer than dressing, threading a one-tile pass or
       * waiting out a jostle — the worst honest pause measured is under half of
       * it — and far shorter than the deadlocks it ends, every one of which ran
       * to the end of the match. Three seconds of release is enough to walk a
       * group clear of the geometry that trapped it; the shape re-forms after.
       */
      stallTicks: 60,
      releaseTicks: 90,
    },
  },

  /** Transient visual effects. */
  fx: {
    /** Explosion lifetime, seconds. */
    explosionDuration: 0.5,
    /** Explosion peak radius, px. */
    explosionMaxRadius: 30,
    /**
     * A base's death blast, which is not the same event as a robot's. The match
     * ends on this explosion and the outcome transition holds the live field on
     * it for 1.4 s before anything else happens (`.docs/tasks/outcome-transition.md`),
     * so it cannot be the 30 px puff a single robot leaves. Slower as well as
     * wider: the size is what makes it read as a base, the duration is what gives
     * the player time to see it.
     */
    baseExplosionDuration: 1.6,
    baseExplosionMaxRadius: 110,
    /**
     * Directed-energy hit: the discharge ring that snaps out over the target.
     * Shorter and wider than an explosion — it is the only moment the weapon is
     * *visible* doing its job, and it has to read against a busy firefight.
     */
    empBurstDuration: 0.35,
    empBurstMaxRadius: 34,
    /**
     * The two ways a base's energy dome can end, and they must never read alike:
     * the player has to know whether it was beaten down or simply ran out.
     * Shattered is short and hard (with shards); powering down is longer and
     * softer (a contracting ring, no shards) — see `pixi/render/ExplosionView.ts`.
     */
    shieldBreakDuration: 0.5,
    shieldExpireDuration: 0.9,
    /** Click-order marker (move/attack ping) lifetime, seconds. */
    orderMarkerDuration: 0.45,
    /** Radius (px) the order marker's ring starts at before collapsing onto the point. */
    orderMarkerRadius: 22,
    /** Period (seconds) of the alpha pulse on the hovered attack target's highlight. */
    hoverPulsePeriod: 1.2,
  },

  /**
   * Economy multipliers by difficulty, applied to **bot sides only** — nobody
   * starts with free robots, so how fast a side can afford its army is the whole
   * difficulty curve. `normal` is 1× on both counts: the bot plays by exactly the
   * player's rules, and only `easy`/`hard` bend them. See `createGameContext`.
   */
  difficulty: {
    easy: { aiStartingResources: 0.75, aiIncome: 0.6 },
    normal: { aiStartingResources: 1, aiIncome: 1 },
    hard: { aiStartingResources: 1.25, aiIncome: 1.4 },
  },

  /** Randomly generated impassable terrain. */
  obstacles: {
    /**
     * Clusters to attempt on a **small** (40×40) map; `generateObstacles` scales
     * this by map area, so cover density stays constant instead of thinning out
     * to nothing on the large map. This is the knob for "more/less terrain".
     *
     * Recalibrated from 34 when `minCorridorTiles` landed: sealing the narrow
     * ground fills the gaps between blobs that were too tight to drive through,
     * which took cover from the 21% of the map this was tuned for to 28%. At 26
     * it is back to 21% — and reads as *more* terrain rather than less, because
     * the tiles go into more, smaller lumps (medium map: 19 against 16) instead
     * of into the necks that merged them into masses.
     */
    blobCount: 26,
    /** Min tiles per cluster — a cluster below this is too small to be worth pathing around. */
    minBlobTiles: 4,
    /** Max tiles per cluster. Actual size is a random count of *distinct* tiles in `[min, max]`. */
    maxBlobTiles: 16,
    /** Tiles kept clear around each base (Chebyshev) — covers the production spawn ring. */
    baseClearMargin: 6,
    /**
     * The narrowest drivable ground a generated map may contain, in tiles.
     * `generateObstacles` fills in anything thinner (see `sealNarrowGround`).
     *
     * Three, because of what has to walk down it. A `Box` — the shape the terrain
     * ladder in `systems/task/formation.ts` falls back to when the ordered one
     * will not fit, and the tightest a player can order — is ~94 px across a
     * six-strong group. Three tiles is 96 px, so it fits, and the single file
     * below the box stops being something the *ground* routinely forces.
     *
     * That matters more than it sounds: every formation deadlock found so far
     * needed a one- or two-tile pass to bite (see
     * `.docs/issues/formation-deadlock-at-a-hairpin.md`). This is the number that
     * stops generated maps containing the geometry at all — the fixes in the
     * formation layer stay, because base footprints are obstacles too and they
     * appear and vanish mid-match.
     */
    minCorridorTiles: 3,
    /**
     * Chance a cluster is a crater rather than a mountain. Both block driving;
     * only a mountain blocks line of fire, so this is the share of cover that
     * can be shot across (see `engine/obstacles.ts`).
     */
    craterChance: 0.35,
  },

  /** Robot production from a base's build queue. */
  production: {
    /** Seconds to build one robot. */
    buildTime: 4,
    /** How far (tiles) beyond the footprint new robots appear. */
    spawnOffsetTiles: 2,
    /** Robots per side allowed at once (built + queued) — same cap for player and AI. */
    maxRobots: 12,
  },

  /** Resource economy: income over time, build costs per side. */
  economy: {
    startingResources: 200,
    /** Resources gained per second, per side. (Phase 8 balance: 10 for tempo.) */
    incomePerSec: 10,
    maxResources: 999,
    /** Build cost by ChassisType value. */
    chassisCost: { tracks: 60, wheels: 50, legs: 80 },
    /**
     * Build cost by WeaponType value. `fpv` sits between `missiles` (70) and `bomb`
     * (90): dearer than the anti-air that answers it, so a side that opens with
     * carriers is behind on everything else, and cheaper than the kamikaze, which
     * still buys more damage per resource against a building.
     */
    weaponCost: { none: 0, cannon: 40, missiles: 70, bomb: 90, radar: 20, ew: 25, dew: 40, fpv: 80 },
  },

  /** Enemy AI behaviour. */
  ai: {
    /** Seconds before the AI enqueues its first build. */
    firstSpawnDelay: 3,
    /** Seconds between subsequent enqueues (shrinks over time). */
    spawnInterval: 6,
    /** Multiplier applied to the interval after each build (escalation). */
    intervalDecay: 0.92,
    /** Interval floor, seconds. */
    minInterval: 2.5,
    /**
     * Units held on `DefendBase` before the rest are sent out on `GroupAttack`.
     * The group size itself lives in `behavior.groupAttackSize` — the program
     * owns it, so the quota can never starve a group that will never form.
     */
    guardQuota: 3,
    /** Enemy within this range (px) of the AI base triggers a defensive unit. */
    threatRange: 220,
    /** Enemy robots within `threatRange` at once, at/above which the AI recalls its whole force (including active attackers) to defend, not just home-based units. */
    massRushThreshold: 5,
    /**
     * Base hp fraction below which a bot spends its one energy dome (the other
     * trigger is a rush of `massRushThreshold` known enemies inside
     * `threatRange`). Bot *policy*, so it lives here rather than in
     * `bases.shield`, which holds the dome's own stats — see `systems/ai.ts`.
     */
    shieldHpThreshold: 0.45,
    /** Minimum other known enemy robots huddled within the bomb's blast radius before a kamikaze bothers with a cluster run. */
    kamikazeClusterMin: 2,
    /** Chance a freshly-idle kamikaze picks a big enough cluster over rushing the base outright. */
    kamikazeClusterChance: 0.5,
    /** Living-robot-count edge (either side) needed to call the fight lopsided enough to change posture — see `forcePosture`. */
    forceAdvantageMargin: 3,
    /** Extra guard slots (on top of `guardQuota`) filled while in a defensive posture (significantly outnumbered). */
    defensiveGuardBonus: 3,
    /**
     * Armed robots that must already be pushing before a `dew` hull joins them.
     * It deals no damage, so on its own it just freezes one enemy and is killed
     * by the rest — it is only worth anything as an escorted support unit.
     */
    dewEscortMin: 2,

    /**
     * Bot observer-drone pilot (`systems/aiDrone.ts`). The bot flies the same
     * drone the player does — it just never lands on a robot and never fires.
     *
     * `droneDangerRange`: an enemy surface-to-air robot or an enemy base this
     * close (px) makes it break contact. Comfortably above the 170 px both of
     * them reach, because a drone that starts running at the edge of the
     * envelope is already inside it by the time it turns around.
     */
    droneDangerRange: 230,
    /** How far (px) ahead of its own advancing group's centroid the drone scouts. */
    droneScoutLead: 200,
    /**
     * Below this fraction of hp the drone stops scouting and pickets its own
     * base instead. Drones do not repair (`systems/regen.ts` excludes them by
     * construction), so a damaged one is spent goods: holding it back as early
     * warning is worth more than trading it for one more sweep.
     */
    droneCautiousHp: 0.34,
    /** Radius (px) around its own base the drone patrols in that cautious mode. */
    dronePicketRadius: 300,
    /** Within this distance (px) of its sweep waypoint, the drone picks the next one. */
    droneWaypointRadius: 90,
  },

  /** HUD snapshot throttle: push roster/HP to the store every N sim ticks. */
  hud: {
    snapshotEveryTicks: 6,
  },

  /** Networked matches: how long a stalled lockstep step is tolerated, and when it is worth saying so. */
  online: {
    /**
     * Wait this long before telling the player the world has stopped. Below it a
     * stall is just jitter, and a badge that flickered on every lag spike would
     * be noise rather than information.
     */
    stallNoticeMs: 600,
    /**
     * Give up on a peer that has stopped sending for this long. Nothing on the
     * wire says "my opponent closed the laptop lid" — a backgrounded tab simply
     * stops producing ticks, and without a ceiling the match would wait forever.
     * Well above the relay's resume grace, so a reconnect always gets its chance
     * first.
     */
    stallTimeoutMs: 60_000,
  },

  /** Fixed simulation step, in seconds (30 Hz). */
  fixedDt: 1 / 30,
  /** Safety cap so a long frame (tab refocus) cannot spiral the accumulator. */
  maxFrameDt: 0.25,
} as const;

/**
 * How far a launched strike drone can actually get: flight speed × flight time.
 *
 * The number that bounds an `fpv` carrier in practice, as opposed to the weapon's
 * own `range` (4000), which only says "anywhere". Derived rather than written
 * down twice, because the two must never disagree: a launcher that fires at
 * something its drones cannot reach spends a nine-second reload on nothing, and
 * on the larger maps a base in the far corner is exactly that — 2169 px away on
 * medium and 3075 on large, against a reach of 1680.
 */
export function munitionReach(): number {
  return gameConfig.munition.speed * gameConfig.munition.flightTime;
}

/** Total world size in pixels, derived from the grid config. */
export const worldPixelSize = {
  width: gameConfig.grid.width * gameConfig.grid.tilePx,
  height: gameConfig.grid.height * gameConfig.grid.tilePx,
} as const;

/** Tiles kept clear between a base footprint and the map corner it sits in. */
const CORNER_MARGIN = 4;

/**
 * The corners a base can start in. The player always keeps `bottomLeft` (so the
 * camera, the HUD and the player's own opening never move); the rest are dealt
 * out to the opponents, which is what caps a match at four sides.
 */
export const CORNERS = ['bottomLeft', 'topLeft', 'topRight', 'bottomRight'] as const;
export type Corner = (typeof CORNERS)[number];

/**
 * The corners available to opponents — every corner except the player's. The
 * diagonal leads, so an unshuffled 1v1 seating reproduces the historical layout.
 */
export const ENEMY_CORNERS = ['topRight', 'topLeft', 'bottomRight'] as const satisfies readonly Corner[];

function mutablePlacements(): BasePlacement[] {
  return gameConfig.bases.placements;
}

/** Top-left tile of a base seated in `corner`, on the current grid. */
function cornerTile(corner: Corner): { tx: number; ty: number } {
  const n = gameConfig.grid.width;
  const far = n - gameConfig.bases.footprintTiles - CORNER_MARGIN;
  return {
    tx: corner === 'bottomLeft' || corner === 'topLeft' ? CORNER_MARGIN : far,
    ty: corner === 'bottomLeft' || corner === 'bottomRight' ? far : CORNER_MARGIN,
  };
}

/**
 * Resizes the battlefield for a new match — call once from `GameEngine.startMatch`,
 * before `createGameContext`/`generateObstacles` run. Mutates `grid`/`worldPixelSize`/
 * base corner placements in place; everything else already reads them live each call
 * (see `obstacles.ts`/`pathfinding.ts`/`coords.ts`), so nothing else needs telling.
 * `applyMapSize('small')` reproduces the original fixed 40×40 layout exactly (same
 * corner margin the original placements used).
 */
export function applyMapSize(size: MapSize): void {
  const n = gameConfig.mapSize[size];
  const grid = gameConfig.grid as { width: number; height: number; tilePx: number };
  grid.width = n;
  grid.height = n;

  const wp = worldPixelSize as { width: number; height: number };
  wp.width = n * grid.tilePx;
  wp.height = n * grid.tilePx;

  // Keep the historical 1v1 diagonal as the resting value; `createGameContext`
  // seats the real roster right after (and before obstacles are generated).
  applySidePlacements([Owner.Player, Owner.AI]);
}

/**
 * Seats every playing side: the player keeps `bottomLeft`, the opponents draw
 * from the remaining corners (shuffled with `rng` when one is supplied, so a
 * match isn't always the same layout and networked peers still agree).
 *
 * Rewrites `gameConfig.bases.placements` wholesale, so it also decides *how many*
 * bases the match has. Must run **after** `applyMapSize` (it reads the grid size)
 * and **before** `generateObstacles` — the terrain generator keeps a clear margin
 * around whatever the placements say and carries connectivity between them, so
 * seating decided later would leave the map carved for the wrong sides.
 */
export function applySidePlacements(owners: Owner[], rng?: Rng): void {
  const corners: Corner[] = [...ENEMY_CORNERS];
  if (rng) {
    // Fisher-Yates over the non-player corners; `rng.int` keeps it seeded.
    for (let i = corners.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
  }

  const placements = mutablePlacements();
  placements.length = 0;
  let next = 0;
  for (const owner of owners) {
    const corner = owner === Owner.Player ? 'bottomLeft' : corners[next++];
    placements.push({ owner, ...cornerTile(corner) });
  }
}
