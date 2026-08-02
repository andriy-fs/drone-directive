import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * One labelled row of a settings panel: a caption plus whatever control follows
 * it (a `ChipPicker`, a button that opens a modal, …). Every menu/modal in the
 * app is built out of these rows, so the markup lives here rather than being
 * re-typed per screen.
 */
export function PickerGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="picker-group">
      <span className="picker__label">{label}</span>
      {children}
    </div>
  );
}

/** One choice in a `ChipPicker`. `hint` becomes the chip's tooltip. */
export interface ChipOption<T> {
  value: T;
  label: ReactNode;
  hint?: string;
}

/**
 * Single-select row of chips — the generic form of the hand-rolled pickers in
 * `ui/hud` (`ChassisPicker`, `ProgramPicker`, …), for option sets that are plain
 * data rather than a domain enum with its own component.
 *
 * Values are compared by identity, so the option list may be rebuilt per render
 * (labels come from the active locale) as long as the values are primitives.
 */
export function ChipPicker<T>({
  options,
  value,
  onChange,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="picker">
      {options.map((option) => (
        <Button
          key={String(option.value)}
          className={`chip ${option.value === value ? 'chip--on' : ''}`.trim()}
          onClick={() => onChange(option.value)}
          title={option.hint}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
