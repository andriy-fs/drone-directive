import { OverrideKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../config/gameConfig';
import type { T } from '../../i18n';
import { RadiationIcon, ShieldHalfIcon, type LucideIcon } from '../common/icons';

/**
 * The rows of the hull's service menu, in the order they are shown — same shape
 * as `programOptions.ts`: total maps keyed by the domain enum, so a mode added to
 * `OverrideKind` cannot silently reach the panel without a glyph or a label.
 *
 * `OverrideKind.None` is deliberately absent from every map here. It is the
 * resting value of the wire pulse, not a mode, and it has no row — which is why
 * the maps are keyed on `OfferedOverride` rather than on the enum itself.
 */

/** Everything except `None` — the values that actually name a mode. */
export type OfferedOverride = Exclude<OverrideKind, typeof OverrideKind.None>;

/**
 * Display order. Cheapest commitment first: the shield only protects the machine
 * that was already going somewhere, while the overload is the one that decides a
 * fight on its own.
 */
export const OFFERED_OVERRIDES: OfferedOverride[] = [OverrideKind.Shield, OverrideKind.Overload];

export const OVERRIDE_ICONS: Record<OfferedOverride, LucideIcon> = {
  [OverrideKind.Shield]: ShieldHalfIcon,
  [OverrideKind.Overload]: RadiationIcon,
};

export function overrideLabels(t: T): Record<OfferedOverride, string> {
  return {
    [OverrideKind.Shield]: t('serviceMenu', 'shield'),
    [OverrideKind.Overload]: t('serviceMenu', 'overload'),
  };
}

/** What each mode buys for the machine it costs. */
export function overrideNotes(t: T): Record<OfferedOverride, string> {
  return {
    [OverrideKind.Shield]: t('serviceMenu', 'shieldNote'),
    [OverrideKind.Overload]: t('serviceMenu', 'overloadNote'),
  };
}

/**
 * How long each mode runs, read from the same config the engine counts down
 * from — so the number on the row is the number the machine actually gets.
 */
export const OVERRIDE_SECONDS: Record<OfferedOverride, number> = {
  [OverrideKind.Shield]: gameConfig.drone.overrides.shield.duration,
  [OverrideKind.Overload]: gameConfig.drone.overrides.overload.charge,
};
