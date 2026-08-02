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
  /** A side lost its last base and is out of the match. Fires once per side. */
  sideEliminated: { owner: Owner };
  /** The match is decided; `winner` is null if the last sides fell together. */
  gameOver: { winner: Owner | null };
  sceneChanged: { scene: SceneName };
}
