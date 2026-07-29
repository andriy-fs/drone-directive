import { palette } from '../../config/palette';
import { useGameStore } from '../../store/gameStore';
import { Owner, PLAYABLE_OWNERS } from '../../types/enums';

/**
 * Display colour for an entity by side. The client's own side is always the
 * friendly blue — so the online guest (who actually plays `Owner.AI`) still sees
 * their own units in the friendly colour — and the opposing sides take the
 * remaining colours in seating order, so a four-way match reads at a glance.
 */
export function ownerColor(owner: Owner | undefined): number {
  if (owner === undefined || owner === Owner.Neutral) return palette.owner.neutral;
  const local = useGameStore.getState().localSide;
  if (owner === local) return palette.owner.player;
  const rank = PLAYABLE_OWNERS.filter((o) => o !== local).indexOf(owner);
  return palette.opponents[rank] ?? palette.owner.ai;
}

/**
 * Sprite tint that tells sides apart when they share an art set, or `undefined`
 * to leave the art exactly as authored.
 *
 * There are two art sets on disk and up to four sides, so the extra bots wear
 * the opponent art and are separated by colour instead. The two sides the art
 * was actually drawn for stay untinted — multiplying red art by a red tint only
 * muddies it, and a 1v1 match must look exactly as it did before.
 */
export function teamTint(owner: Owner | undefined): number | undefined {
  if (owner !== Owner.AI2 && owner !== Owner.AI3) return undefined;
  return ownerColor(owner);
}
