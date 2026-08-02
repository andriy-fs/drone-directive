import type { T } from '../../i18n';
import type { SideSnapshot } from '../../store/gameStore';
import { Owner, PLAYABLE_OWNERS } from '@drone-directive/types/enums';

/**
 * How the HUD names and colours the sides of a match. Both helpers rank sides
 * relative to the viewing client, exactly like the canvas does in
 * `pixi/render/ownerColor.ts` — so a unit's dot in the sidebar is the colour it
 * is drawn on the battlefield.
 */

/** CSS modifier for a side's colour dot: own side, then opponents in seating order. */
export function sideTone(owner: Owner, localSide: Owner): string {
  if (owner === Owner.Neutral) return 'neutral';
  if (owner === localSide) return 'player';
  const rank = PLAYABLE_OWNERS.filter((o) => o !== localSide).indexOf(owner);
  return rank < 0 ? 'neutral' : `foe${rank + 1}`;
}

/** Numbered bot labels, used only once a match has more than one bot. */
const BOT_KEYS = ['ai1', 'ai2', 'ai3'] as const;

/**
 * Display name for a side: your own, the human you're playing against, or a
 * numbered bot. A lone bot is just "AI" — numbering only earns its keep once
 * there are several to tell apart.
 */
export function sideLabel(owner: Owner, sides: SideSnapshot[], localSide: Owner, t: T): string {
  if (owner === localSide) return t('hud', 'player');
  if (owner === Owner.Neutral) return t('hud', 'ownerNeutral');

  const side = sides.find((s) => s.owner === owner);
  if (side && !side.bot) return t('hud', 'opponent');

  const bots = sides.filter((s) => s.bot);
  if (bots.length <= 1) return t('hud', 'ai');
  const key = BOT_KEYS[bots.findIndex((s) => s.owner === owner)];
  return key ? t('hud', key) : t('hud', 'ai');
}
