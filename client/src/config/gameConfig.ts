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
    /**
     * Raised from 2 for touch: how big a unit is under a finger is a question of
     * zoom, not of hit areas. At 1x a robot is ~55 screen px and already clears the
     * 44 px touch-target guideline; at 0.5x it is 27 and nothing helps but zooming
     * in, which a pinch already does (`input/zoom.ts`). 3x is the headroom that
     * makes that answer true rather than nearly true.
     *
     * Provisional — it may come back to 2.5 once it has been played on a tablet.
     * The cost of too much is a field of view too narrow to command from, and that
     * is only judgeable in a real match.
     */
    maxZoom: 3,
    /** Zoom multiplier per notch of the wheel (compounded, so 1.1 takes ~19 notches across the full range). */
    wheelZoomStep: 1.1,
    /**
     * A trackpad pinch arrives as a `wheel` event with `ctrlKey` set, and its
     * delta is continuous rather than a notch — so it needs a per-pixel factor
     * instead of the fixed step above, or a single gesture would slam into a stop.
     */
    pinchZoomSensitivity: 0.01,
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
     * `systems/combat/shield.ts`.
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
    /**
     * How close (px) to a `MoveDrone` goal counts as arrived — the drone stops and
     * the order is spent (`systems/drone.ts`).
     *
     * Has to stay above one tick's travel, or the drone can never be inside it:
     * at `speed` 280 a fixed step covers 9.3 px, so it would fly past the point,
     * turn round, fly past it the other way and buzz there for the rest of the
     * match. 12 leaves margin without the stop reading as short of the click.
     */
    goalArriveRadius: 12,
    /**
     * How fast the pilot may swing a possessed hull, degrees/second — a 180°
     * reversal in a little over a second.
     *
     * A piloted hull is steered *relative to itself*: the stick's y axis is
     * throttle along the heading and its x axis is this rate (`drivePossessed`).
     * The heading is therefore integrated against `fixedDt` in the simulation, so
     * both peers swing it identically and nothing here may move to the renderer.
     *
     * The number is the whole feel of the hull view. Lower reads as weight, and
     * far enough down the machine can no longer be pointed at something that is
     * moving; higher walks back toward the snap this replaced, where a tap on the
     * stick whipped the entire world round in one frame. One value for every
     * chassis — a per-chassis rate is a bigger design question than a control law.
     */
    possessTurnRateDeg: 160,
    /** Hull strength. At `missiles` damage (22) that's three hits to bring one down. */
    maxHp: 60,
    /** Collision radius (px) for anti-air fire — see `systems/combat/index.ts`. */
    hitRadius: 14,
    /** Seconds a side spends without an eye after losing one, before a fresh drone rolls out. */
    respawnTime: 30,
    /**
     * How far (px) from its base's centre a drone is parked at match start and on
     * respawn, in the direction of the map centre (`droneSpawnPose`).
     *
     * **It has to clear the base's diagonal, not its side.** A 3-tile footprint
     * reaches 48 px to an edge but 48·√2 ≈ 68 px to a corner, and the drone is
     * another 20 px of radius on top — so anything under ~90 px still lands the
     * drone on the building however it is pointed. 104 leaves ~16 px of daylight.
     *
     * The number exists because the base's roof is **not** free real estate: its
     * roof carries the missile battery's launcher pad (see `bases.weapon` and
     * `BaseView.aimLauncher`), and a drone parked there hides the one thing that
     * says where the base's fire comes from.
     */
    spawnOffset: 104,

    /**
     * The wireframe hull view: where the camera sits once a drone lands on a robot,
     * and how wide it looks (`pixi/render/fpv/`).
     *
     * **Third person, not first.** A camera at the sensor's own eye is the obvious
     * reading of "inside the machine" and is the harder one to drive: with nothing of
     * the hull on screen the player cannot tell which way the chassis is pointed
     * except by moving, and a wireframe world gives no near-field detail to judge
     * speed against. Set back and slightly above, the hull itself becomes the
     * instrument — where it is aimed, how it is drifting, where the module sits.
     *
     * From the eye to over the shoulder is the same maths with different numbers, so
     * these three are what the "which one is it" argument is settled with, live:
     * `followDistance: 0` is first person.
     *
     * `sightHalfAngleDeg` is the exception to "renderer only": the simulation reads
     * it, and it lives here rather than beside the other sight ranges precisely so it
     * sits next to the `fovDeg` it has to agree with. Split them and they drift.
     */
    fpv: {
      /**
       * How far (px) behind the hull, along its own heading, the camera trails.
       *
       * Set against the *art's* size, not the collision radius: a hull is 44–46 px
       * long, so anything under about a hundred fills the lower half of the monitor
       * with the machine the player is already sitting in and hides the ground they
       * are driving onto — which is the one thing this view exists to show.
       */
      followDistance: 118,
      /** How high (px) above the ground the camera rides. */
      height: 62,
      /** Downward tilt, in degrees. Small — the horizon is what makes distance readable. */
      pitchDeg: 12,
      /** Vertical field of view, in degrees. */
      fovDeg: 66,
      /**
       * Near clip, in px. Has to clear `followDistance` minus half a hull, or the
       * machine the player is riding gets sliced open by the front of the frustum.
       */
      near: 14,
      /**
       * Half the sector a **possessed** hull can see in, in degrees — the one number
       * in this block the simulation reads (`systems/vision/index.ts`).
       *
       * It exists because the monitor and detection have to agree. Riding a hull
       * hides the whole battlefield behind one forward view, and leaving that side's
       * sight at a full circle would mean the simulation quietly kept spotting
       * things the pilot has turned their back on.
       *
       * Set a little wider than the monitor's *horizontal* field, which `fovDeg`
       * (vertical) reaches through the window's aspect and therefore cannot be
       * derived from — the simulation must not depend on the size of anyone's
       * window, or two peers stop agreeing. Wider is the safe side of that mismatch:
       * a contour is only ever drawn for something this side has detected, so a cone
       * narrower than the frustum would leave a machine plainly in front of the
       * pilot missing from their screen.
       *
       * Only the hull the drone is *riding* gets it. Bases, turrets and a
       * free-flying drone keep their circle: a sector is what you accept for looking
       * through one machine's eyes.
       */
      sightHalfAngleDeg: 45,
    },

    /**
     * The hull's experimental modes — the service menu a pilot reaches from
     * inside a possessed machine (`systems/override.ts`).
     *
     * **Every one of them ends with the hull destroyed**, which is what keeps
     * this block down to durations: there is no charge count, no cooldown and no
     * cost, because the machine is the cost. Tuning here is therefore only ever
     * "how long does the pilot get, and how far does it reach" — nothing in this
     * block can make a mode repeatable.
     */
    overrides: {
      shield: {
        /**
         * Five seconds of absolute immunity.
         *
         * Sized off the one window the game already has that is worth paying a
         * hull for: a kamikaze closes to `weapons.bomb.range`, then stands still
         * for `weapons.bomb.armingTime` (1 s) while the fuse burns — the single
         * moment a bomb is reliably shot off its mark. Five seconds covers the
         * last stretch of the approach *and* that fuse with room to be wrong
         * about the timing. Much shorter and the pilot has to arm it inside the
         * defender's range, which is a reflex rather than a decision; much longer
         * and the approach stops being a run at all.
         */
        duration: 5,
      },
      overload: {
        /** Seconds between arming and the burst — the window a defender gets to react. */
        charge: 2,
        /**
         * Blast radius of the pulse. Above `weapons.ew.jamRadius` (150) on
         * purpose: the machine that carries this is the jammer, and a pilot who
         * has driven it into a formation should reach past the bubble it was
         * already projecting, or the mode buys nothing the hull was not doing by
         * standing there.
         */
        radius: 180,
        /**
         * How long everything caught in the pulse stays out. The same number as
         * `weapons.dew.freezeDuration`, so the burst reads as what it is — the
         * whole battery dumped into the effect a `dew` shot delivers one hull at
         * a time.
         */
        disableSeconds: 8,
      },
    },
  },

  /**
   * The single-use FPV strike drone — the body a `salvo` weapon launches, and the
   * game's second flying entity (see `systems/combat/munition.ts`). Stats live here rather
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
     * howitzer plainly can't). Two carry it, and they are deliberately different
     * answers rather than two of the same one: `missiles` shoot a flyer *down*,
     * `dew` (zero damage, `freezeDuration`) knocks it *out* where it hangs. A
     * third AA weapon would just be another entry with the flag on.
     * `freezeDuration` (seconds) only matters for `dew` — how long a hit leaves
     * the target disabled; it is also what makes a zero-damage weapon count as
     * armed at all (see `canEngage` in `systems/combat/index.ts`).
     * `range` is reach alone, never sight: a weapon that outranges its hull's own
     * `sight` (today `missiles`, at 255 against the widest chassis's 230) can only
     * use the surplus against a target some ally is watching *right now* — see
     * `isKnownTo` in `targeting.ts`, applied to every weapon in
     * `fireWeapon`. Raising a range past a chassis `sight` therefore buys
     * dependence on a spotter, not free blind fire.
     * `salvo` (>0) turns the weapon into a **launcher**: instead of one round it
     * releases that many single-use flying munitions, each carrying this weapon's
     * own `damage` (see the `munition` block above and `systems/combat/munition.ts`).
     * Only `fpv` has it, and it is what exempts the weapon from the line-of-sight
     * check — drones fly over mountains (`needsLineOfSight` in `systems/combat/index.ts`).
     * `armingTime` (seconds, >0) only matters for `bomb`: the fuse it burns
     * standing still before it goes off — see `status.ts` and the note on
     * `bomb` below.
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
        armingTime: 0,
      },
      cannon: {
        range: 200,
        damage: 13,
        cooldown: 0.7,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
        freezeDuration: 0,
        salvo: 0,
        armingTime: 0,
      },
      // The side's lethal answer to an enemy drone, and — since `fpv` exists — to
      // a salvo. It is not the *only* anti-air any more (`dew` freezes what this
      // one kills), but it is the only one that takes a flyer out of the match.
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
        armingTime: 0,
      },
      // Kamikaze: closes to `range`, burns `armingTime` standing still, then detonates,
      // dealing `damage` in `explosionRadius` and destroying itself.
      // range (90) must exceed a base's half-footprint (48px) so it can trigger at the base's edge, not only inside it.
      // damage doubled (150 → 300) so building one is worth it against a base/cluster, not just chip damage.
      // `explosionRadius` must stay comfortably **above** `range`: the trigger is measured centre-to-centre
      // while the blast reaches `explosionRadius + robots.radius`, so a radius at or below the trigger
      // distance would detonate on the rim of its own blast — the aimed target barely clipped and everything
      // standing behind it untouched, which is the opposite of what a kamikaze is bought for.
      //
      // `armingTime` is the one thing standing between this weapon and an unanswerable
      // opening: `wheels` + `bomb` costs 140 and takes 300 hp off a 600 hp base, so two
      // of them ended matches, and nothing could stop them. The interception window used
      // to be `behavior.defendBaseRadius` (280) minus this `range` — 190 px, which a
      // 135 px/s hull crosses in 1.4 s, in which a cannon lands ~24 damage against 70 hp.
      // A fuse burned *stationary* is what turns that into a real window: the base's own
      // battery plus one defender now finish a light chassis inside the second. It is a
      // delay, never a cancellation (see `systems/combat/index.ts`) — a kamikaze that started
      // still trades itself for whatever it is standing next to, so its job against a
      // cluster or a dome is untouched. Raising it much past a second stops being a
      // window and starts being "escort or don't bother"; dropping it below one puts the
      // arithmetic above back.
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
        armingTime: 1,
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
        armingTime: 0,
      },
      /**
       * Unarmed jammer. `jamRadius` does **two** jobs, both passive: it halves the
       * effective sight range of enemy scouts standing inside it (see
       * `combat.jamMultiplier`), and it drops enemy FPV strike drones that fly into
       * it outright — a munition inside the bubble falls without dealing damage
       * (`systems/combat/munition.ts`). The second job is what makes this the hard counter
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
        armingTime: 0,
      },
      // Directed-energy weapon: the cannon's reach and price, but it deals no damage at
      // all — a hit disables the target for `freezeDuration` seconds instead. Control,
      // not attrition, so the long cooldown is the whole balance lever.
      //
      // `canHitAir` because a beam does not care what it is pointed at, and because
      // one lethal AA weapon was too few: a side that built no `missiles` had no
      // answer to anything airborne at all. What a freeze does to a flyer is not
      // what it does to a hull, and that is the point — an observer drone hangs
      // helpless for the duration (long enough for something else to kill it), and
      // an FPV munition simply comes down, the same way an `ew` bubble drops one.
      // The 5 s reload keeps it single-target counter-play rather than air denial.
      dew: {
        range: 120,
        damage: 0,
        cooldown: 5,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: true,
        freezeDuration: 8,
        salvo: 0,
        armingTime: 0,
      },
      /**
       * FPV carrier: one pull of the trigger releases `salvo` single-use strike
       * drones, each carrying this weapon's own `damage` (5 × 12 = 60 a volley) and
       * living `munition.flightTime` seconds. See `systems/combat/munition.ts`.
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
        armingTime: 0,
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
     * ORCA local manoeuvring — see `engine/systems/movement/orca/`. Every unit hands the
     * solver the velocity it *wants* (straight at its next A* waypoint) and gets
     * back the nearest one that no neighbour and no wall forbids, with each pair
     * of movers splitting the correction 50/50. A* is untouched: this bends a
     * tick's velocity, never the route.
     *
     * `timeHorizon` 0.1 s is the anticipation window, against the one *step*
     * (1.4-4.5 px, ~0.033 s) the fan-based `steerAround` it replaces could see.
     *
     * It was **measured twice, and the arithmetic that first set it was wrong
     * both times.** The original reasoning said 1.0 s: two `tracks` hulls close
     * at 120 px/s, so the split begins 120 px out, and a 96 px corridor leaves
     * 36 px of lateral room per side which a hull covers in 0.6 s — comfortable.
     * What that misses is that a horizon longer than the corridor is wide makes
     * every agent yield to neighbours it will never reach, and in a queue they
     * all yield at once. The corridor stand then said 0.3 s. That stand runs
     * twelve loose hulls through one hand-built pass; the game runs fifty in five
     * Box formations over generated ground, and swept there the answer moved
     * again — 245/250 arrivals at 0.1 s against 239/250 at 0.3 s.
     *
     * The lesson is the tuning regime, not the number: **tune on the density and
     * the formations the game actually has.** Sweeping on the stand that is easy
     * to reason about produced a value 3x too large, twice.
     * `timeHorizonMin` exists because a large horizon caps the approach speed
     * toward a stationary neighbour at roughly `(d − 23) / tau`: at 1.0 s a hull
     * 36 px from its slot could close at only 13 px/s, and `spacing.box` **is**
     * 36 — a box would never dress. The effective horizon is therefore
     * `clamp(distanceToWaypoint / speed, timeHorizonMin, timeHorizon)`: look no
     * further ahead than the time you have left to drive.
     *
     * `timeHorizonObst` is separate and shorter because wall constraints are hard
     * — they are not split with anyone, so they pinch twice as fast. It bounds
     * only the component *into* the wall; speed along the wall is untouched,
     * which is what makes a corridor a stream rather than a pinch.
     *
     * `neighborDist` is deliberately not a tuning knob: a pair can only constrain
     * each other within `23 + timeHorizon * (vA + vB)`, worst case 293 px for two
     * `wheels`. At 300 the prune can never change the answer, only the cost.
     *
     * `radiusPadding` puts ORCA's hold distance (23.0 px) just outside the
     * distance `separationSystem` fires at (22.0), so ORCA does the work and
     * separation stays a backstop. Every formation spacing (min 36) is greater,
     * so no shape asks units to stand inside their own ORCA radius.
     */
    orca: {
      /**
       * While false, `movementSystem` runs the original sequential `steerAround`
       * loop verbatim — see the note there on why the two paths are kept separate
       * rather than merged. Flipping this is the whole A/B.
       *
       * **On, and measured rather than assumed.** Over 10 seeds x 2700 ticks of
       * generated terrain at 12/24/50 units, against `steerAround`:
       *
       * - overlapping pairs per tick fall 6-40x — 24.216 to 4.046 at fifty units;
       * - anti-jam retreats fall 5-13x — 617 to 127;
       * - robot-ticks spent standing on the enemy base footprint 58738 -> 22389,
       *   and 110 -> 23 per arrived unit, which is the `at-objective` crowding the
       *   flow-field investigation isolated as the live defect;
       * - on the corridor harness a one-way crowd through a 96 px pass goes
       *   9.25/12 to 11.25/12 (mean of eight packings), and a crowd wedged into a
       *   dead end spends 2 robot-ticks inside rock against 4683.
       *
       * The costs are real and not yet paid down: arrivals at fifty units
       * 496/500 -> 474/500, mean arrival +23/60/66% at 12/24/50, en-route stalls
       * 2.32% -> 3.53%, and robot-ticks in terrain at fifty units 3296 -> 11276.
       * The horizons below were tuned on the corridor harness at twelve units, not
       * on generated terrain at fifty, which is the first thing to revisit.
       */
      enabled: true,
      timeHorizon: 0.1,
      timeHorizonMin: 0.05,
      timeHorizonObst: 0.2,
      neighborDist: 300,
      radiusPadding: 0.5,
      /**
       * How much longer the anti-jam waits before firing at a unit the solver is
       * deliberately holding back, as a multiple of `stuckAfter`. Giving way is
       * normal and must not be punished; standing still for nine seconds is not.
       */
      yieldPatience: 4,
      /**
       * How much of last tick's velocity is blended into the preferred one, 0..1.
       *
       * Against oscillation, which is the layer's real cost here rather than any
       * loss of speed: hulls drive at 57 px/s of a possible 60, yet arrive 48%
       * later, because they cover 2.18x the crow-flight distance against the old
       * layer's 1.37x. Re-aiming at the waypoint from scratch every tick lets the
       * solver pick one side of a neighbour's velocity cone and then the other,
       * and the hull weaves. Carrying some of the previous choice forward damps
       * that; too much and it stops tracking its waypoint at all.
       */
      prefInertia: 0.5,
    },
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

    /**
     * **The combustion layer** (`pixi/render/fx/`) — the muzzle, the trail and
     * the impact. Everything below is renderer-only: none of it is an effect
     * entity, none of it is read by a system, and the numbers may be changed
     * freely without touching a replay.
     *
     * The whole set is built around one asymmetry. A shot is fired constantly
     * and must stay *cheap and quiet* or a firing line becomes a light show;
     * an impact happens exactly as often but is the beat the game was missing
     * entirely, so it is allowed to be the loud one.
     */
    muzzle: {
      /**
       * How long the flash at the barrel lives. Deliberately under a tenth of a
       * second: long enough to be caught at 30 Hz, short enough that ten robots
       * firing in a line read as ten separate reports rather than a glow.
       */
      flashDuration: 0.08,
      /** Radius (px) of the cannon's flash. About a third of a hull, so it reads as a barrel, not a blast. */
      flashRadius: 9,
      /** A missile launch is the heavier event of the two — a bigger bloom at the tube. */
      launchFlashRadius: 14,
      /** Seconds the smoke a shot leaves at the barrel hangs around. */
      smokeDuration: 0.55,
      /** …and how long a missile's launch cloud does. Longer: the tube dumps far more of it. */
      launchSmokeDuration: 1.1,
    },
    /**
     * The trail behind a round, sampled from its own positions (see
     * `pixi/render/ProjectileView.ts`). `dust.ts`'s argument applies unchanged:
     * a projectile is a handful of pixels on a field with no zoom, so what makes
     * it legible is drawn *behind* it, not on it.
     */
    trail: {
      /** Positions kept per projectile. The cap on both the look and the cost. */
      samples: 14,
      /** Seconds between samples. Below a frame's worth and the ribbon is just the round again. */
      interval: 0.022,
      /** Width (px) of a missile's smoke ribbon at the body, tapering to nothing at the tail. */
      missileWidth: 4.5,
      /** Width (px) of a cannon tracer's streak — thin, so it reads as speed rather than as a body. */
      tracerWidth: 2.2,
    },
    /**
     * What a round leaves where it stopped. Four looks, because the player has to
     * be able to tell a hit that connected from one a mountain ate and from one
     * that simply ran out of range — and only the first of those is worth reacting to.
     */
    impact: {
      /** Seconds a spark lives. Short: sparks are the punctuation, the smoke is the sentence. */
      sparkDuration: 0.34,
      /** Sparks thrown by a round striking a hull, before the per-weapon multiplier. */
      sparkCount: 7,
      /** How fast they leave (px/s) before drag. */
      sparkSpeed: 150,
      /** Streak length (px) of a fresh spark. */
      sparkLength: 6,
      /** Radius (px) of the flash at the point of impact. */
      flashRadius: 7,
      /** Seconds the dust thrown up by a round hitting terrain hangs. */
      dustDuration: 0.7,
    },
    /**
     * What an explosion leaves once the fire is out. These outlive the blast
     * itself on purpose — a fireball that vanishes cleanly reads as a sprite
     * being removed, and the smoke is what makes it read as something that burned.
     */
    debris: {
      /** Seconds the smoke left by a blast drifts for. */
      smokeDuration: 1.6,
      /** Embers thrown by a blast, before scaling with its radius. */
      emberCount: 10,
      /** Ember speed (px/s) before drag. */
      emberSpeed: 190,
      /** Seconds a scorch mark stays on the ground before weathering away. */
      scorchDuration: 4.5,
      /**
       * Scorch radius as a fraction of a *robot's* blast radius, before the
       * square-root scaling in `FxView.blast`. Measured against the small blast
       * rather than against the one that happens to be going off, so a kamikaze's
       * 120 px reach leaves a bigger mark without leaving a crater.
       */
      scorchScale: 0.75,
    },
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
     * Walked down 34 → 26 → 18 while the massifs were being made bigger, and 18
     * turned out to be too few *of them*: measured over 30 seeds, a small map came
     * out with 4.4 separate clusters averaging 73 tiles, so the cover was there but
     * it sat in a handful of giants with whole quarters of the map bare between
     * them. Back up to 22, with `chainMax` capping how many of them can pile into
     * one massif and `seedRegionTiles` spreading the roots — more masses, not
     * bigger ones. Measured over 30 seeds that is 20.0% → 24.3% cover on the small
     * map and 20.7% → 26.0% on the medium; 24 was tried first and pushed the medium
     * map past 28%, where `sealNarrowGround` starts welding neighbouring massifs
     * into walls.
     */
    blobCount: 22,
    /** Min tiles per cluster — a cluster below this is too small to be worth pathing around. */
    minBlobTiles: 6,
    /** Max tiles per cluster. Actual size is a random count of *distinct* tiles in `[min, max]`. */
    maxBlobTiles: 24,
    /**
     * How strongly a cluster's random walk favours its own axis, 0.5–1.
     *
     * At 0.5 the walk is isotropic and a blob comes out round — a lump with no
     * direction, which is what made a generated map read as a tray of samples rather
     * than as terrain. Higher values stretch it into a ridge with a grain; too high
     * and it degenerates into a one-tile line with no width to take cover behind.
     * The tile budget is untouched either way, so cover density does not move.
     */
    ridgeBias: 0.56,
    /**
     * Chance that a step also paints the cell beside it, across the ridge's grain.
     *
     * A walk one cell wide is a snake, and a snake is all edge: over half of all
     * mountain clusters came out a single tile thick, which left the depth shading
     * nothing to shade and let one cliff face cover an entire mountain. This is what
     * gives a ridge a body, out of the same tile budget.
     */
    ridgeWidth: 0.45,
    /**
     * Chance that the next cluster is seeded next to the previous one instead of
     * somewhere random, and how many tiles away it may land.
     *
     * This is what assembles clusters into massifs: neighbours touch and merge, and
     * `sealNarrowGround` fills the necks between the ones that only nearly touch. At
     * 0 the map is a scatter of separate blobs; at 1 it is one wandering wall with no
     * open ground left to fight over.
     */
    chainChance: 0.62,
    chainSpread: 2,
    /**
     * How many clusters may be chained onto one root before the next seed is forced
     * to start a new massif somewhere else.
     *
     * Without a cap, chaining is a random walk over the *whole budget*: 18 blobs at
     * `chainChance` 0.62 came out as 4.4 masses on a small map, one of them up to
     * 322 tiles — a fifth of the battlefield in a single lump, with the rest of the
     * map bare. Three keeps a massif recognisably a massif (three ridges, up to ~70
     * tiles) while guaranteeing the budget is spent in at least `blobCount / 3`
     * separate places.
     */
    chainMax: 3,
    /**
     * Roughly how many tiles across one seeding region is.
     *
     * Free (unchained) seeds are dealt round-robin from a shuffled tour of regions
     * this size instead of being drawn uniformly over the map, which is what stops a
     * map coming out with every mass on one side. 13 gives 3×3 regions on the small
     * map, 5×5 on the medium and 6×6 on the large — and since `blobCount` scales by
     * area, that is a steady ~2.7 clusters per region at every size.
     *
     * Only the *seed* is constrained: a cluster's walk and its chain cross region
     * borders freely, so this does not put the grid back into the silhouette.
     */
    seedRegionTiles: 13,
    /** Tiles kept clear around each base (Chebyshev) — covers the production spawn ring. */
    baseClearMargin: 6,
    /**
     * The cover every base is guaranteed to have on its approach: at least `tiles`
     * blocked cells in the Chebyshev ring between `baseClearMargin` and `radius`,
     * topped up by `generateObstacles` when the random pass left it bare.
     *
     * This is a **fairness** rule before it is a scenery one. Random placement left
     * roughly one base in seven (small map) and one in four (medium) with nothing to
     * fight around, and a side that has to cross open ground while its opponent has
     * ridges to hide behind is playing a different match.
     *
     * `tiles` is about one cluster's worth, so the guarantee is "there is something
     * to use", not "the base sits in a walled yard". `attempts` bounds the top-up:
     * a ring that is mostly map edge may never reach the quota, and generation must
     * always terminate.
     */
    baseCover: { radius: 14, tiles: 20, attempts: 12 },
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
    /** Seconds to build one robot, unless its weapon says otherwise (`weaponBuildTime`). */
    buildTime: 4,
    /**
     * Per-weapon build time, seconds — the whole record, like `economy.weaponCost`,
     * so a new weapon cannot quietly inherit a number nobody chose for it. Read
     * through `buildTimeFor` in `systems/production.ts`, never directly.
     *
     * The **pace** of a build is a balance lever in its own right, separate from its
     * price, and `bomb` is what proved it. A kamikaze is deliberately cheap per point
     * of damage against a building, so making it dearer would only make it a worse
     * anti-cluster weapon without slowing the opening it enabled: auto-build a
     * `wheels` + `bomb` from the first second and the conveyor outran any defence
     * that could be assembled against it. Eight seconds is the assembly line paying
     * for the payload — a kamikaze wave now has to be planned rather than trickled,
     * and every other hull keeps the tempo it had. See `weapons.bomb`.
     */
    weaponBuildTime: {
      none: 4,
      cannon: 3,
      missiles: 4,
      bomb: 8,
      radar: 4,
      ew: 4,
      dew: 4,
      fpv: 4,
    } as Record<WeaponType, number>,
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
     * Base hp fraction below which a bot spends its one energy dome. Bot *policy*,
     * so it lives here rather than in `bases.shield`, which holds the dome's own
     * stats — see `systems/ai/index.ts`.
     *
     * One of **three** triggers, and the slowest of them: a fraction of max hp is
     * coarser than a single hit, which is exactly how the kamikaze opening used to
     * walk past it. Two bombs kill a 600 hp base, and the first leaves it at 50% —
     * above this line, so the dome was never raised at all. `maybeRaiseShield` now
     * also predicts a lethal burst from the kamikazes it can *see*, which is what
     * answers that; this threshold is left to cover the ordinary case it was
     * written for, a base being shelled down over time.
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
     * Bot observer-drone pilot (`systems/ai/pilot.ts`). The bot flies the same
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
