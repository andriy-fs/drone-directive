import { palette } from '../../config/palette';
import { useGameStore } from '../../store/gameStore';
import type { Owner } from '../../types/enums';

/**
 * Display colour for an entity by side: the client's own side is always the
 * "player" colour and the opponent the "ai" colour. So the online guest (who
 * actually plays `Owner.AI`) still sees their own units in the friendly colour.
 */
export function ownerColor(owner: Owner | undefined): number {
  return owner === useGameStore.getState().localSide ? palette.owner.player : palette.owner.ai;
}
