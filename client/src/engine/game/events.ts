import type { Vec2 } from '@drone-directive/types/entities';
import type { Owner, WeaponType } from '@drone-directive/types/enums';
import type { EntityKind } from '../ecs/entity';

export type SceneName = 'menu' | 'game';

/**
 * Discrete engine events (the EventBus payload map). These SUPPLEMENT the store:
 * they cover one-off notifications (spawn/destroy/fire/gameOver/sceneChanged)
 * for observers like audio and the store-sync bridge. Per-frame state
 * (positions/HP) is NOT an event — it's read from the ECS world / snapshots.
 */
export interface GameEvents {
  entitySpawned: { id: string; kind: EntityKind; owner?: Owner };
  entityDestroyed: { id: string; kind: EntityKind; owner?: Owner; pos: Vec2 };
  baseDestroyed: { owner: Owner };
  projectileFired: { owner: Owner; pos: Vec2; weapon: WeaponType };
  /** A base spent its one-shot energy dome (see `systems/shield.ts`). */
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
