import type { Vec2 } from '../../types/entities';
import type { Owner } from '../../types/enums';
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
  projectileFired: { owner: Owner; pos: Vec2 };
  gameOver: { winner: Owner };
  sceneChanged: { scene: SceneName };
}
