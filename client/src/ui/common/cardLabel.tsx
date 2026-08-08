import type { ReactNode } from 'react';
import type { LucideIcon } from './icons';

/**
 * Chip content for `ChipPicker`'s `picker--cards` variant: the glyph stacked over
 * the name. Its own file rather than `Picker.tsx` for two reasons — that file may
 * only export components (react-refresh), and keeping it here lets the option
 * factories that call it (`unitOptions`, `programOptions`) stay plain `.ts` data
 * modules with no JSX of their own.
 */
export function cardLabel(Icon: LucideIcon, text: string): ReactNode {
  return (
    <>
      <Icon className="chip__icon" size={20} aria-hidden />
      <span>{text}</span>
    </>
  );
}
