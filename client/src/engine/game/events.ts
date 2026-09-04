import type { Vec2 } from '@drone-directive/types/entities';
import type { Owner, WeaponType } from '@drone-directive/types/enums';
import type { EntityKind } from '../ecs/entity';

export type SceneName = 'menu' | 'game';

/**
 * What a round ran into. Not `EntityKind`: `'terrain'` is not an entity and
 * `'expired'` is not a collision at all, and both need a look of their own —
 * a mountain absorbing a shell should say so, and a round dying of old age
 * must not be dressed up as a hit.
 */
export type HitTarget = 'robot' | 'base' | 'dome' | 'air' | 'terrain' | 'expired';

/**
 * Discrete engine events (the EventBus payload map). These SUPPLEMENT the store:
 * they cover one-off notifications (spawn/destroy/fire/gameOver/sceneChanged)
 * for observers like audio and the store-sync bridge. Per-frame state
 * (positions/HP) is NOT an event — it's read from the ECS world / snapshots.
 */
export interface GameEvents {
  entitySpawned: { id: string; kind: EntityKind; owner?: Owner };
  /**
   * `killerId` is whoever last put damage on it (`threat.attackerId`), read off
   * the corpse before it leaves the world. Absent when nothing claimed the kill —
   * a base has no `threat`, and an attacker can die first.
   */
  entityDestroyed: { id: string; kind: EntityKind; owner?: Owner; pos: Vec2; killerId?: string };
  /**
   * `owner` **spotted** something it could not see last tick — the rising edge of
   * `systems/vision/index.ts`'s per-tick sets, which are otherwise rebuilt wholesale and
   * expose no such moment. Fires once per contact, again if it is lost and refound.
   * Nothing in the simulation consumes it: detection already works off the sets,
   * and this exists so the app layer can narrate.
   */
  enemySpotted: { owner: Owner; targetId: string; targetKind: EntityKind; pos: Vec2 };
  baseDestroyed: { owner: Owner };
  /**
   * A shot left a barrel. `sourceId` is the shooter (robot or base) — the app
   * layer needs it to hang a muzzle flash on the hull that fired rather than on
   * a point in space near it, which drifts the moment the hull moves.
   */
  projectileFired: { owner: Owner; pos: Vec2; weapon: WeaponType; sourceId: string };
  /**
   * A round stopped travelling, and how. Every exit from `stepProjectiles` emits
   * one, `'expired'` included, because the renderer draws a *different* nothing
   * for a round that ran out of fuel than for one that connected.
   *
   * `dir` is the projectile's travel direction (normalised) — sparks have to fly
   * away from the impact, and the projectile is gone from the world by the time
   * anyone observing this could look it up.
   *
   * Nothing in the simulation consumes this. It exists so the arrival of a shot
   * is drawable at all: hits are otherwise silent unless they happen to kill,
   * and only a death spawns an effect entity.
   */
  projectileHit: { owner: Owner; pos: Vec2; dir: Vec2; weapon: WeaponType; target: HitTarget };
  /**
   * A kamikaze lit its fuse and stopped moving — `gameConfig.robots.weapons.bomb`'s
   * `armingTime` seconds before the blast (see `systems/combat/index.ts`).
   *
   * Nothing in the simulation consumes it. It exists because the whole point of the
   * fuse is that both sides get to *notice* it: the attacker sees the machine commit,
   * the defender gets the one warning they can still act on. `id` is the bomb, so the
   * warning can be hung on the hull rather than on a spot it is standing near.
   */
  bombArming: { owner: Owner; id: string; pos: Vec2 };
  /** A base spent its one-shot energy dome (see `systems/combat/shield.ts`). */
  shieldRaised: { owner: Owner; baseId: string; pos: Vec2 };
  /**
   * That dome is gone for the match. `shattered` separates the two endings —
   * beaten down under fire, or simply run out — which the player has to be able
   * to hear as well as see.
   */
  shieldEnded: { owner: Owner; baseId: string; pos: Vec2; shattered: boolean };
  /** A side lost its last base and is out of the match. Fires once per side. */
  sideEliminated: { owner: Owner };
  /** The match is decided; `winner` is null if the last sides fell together. */
  gameOver: { winner: Owner | null };
  sceneChanged: { scene: SceneName };
}
