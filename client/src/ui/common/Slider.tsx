import type { InputHTMLAttributes } from 'react';

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  /** Current value, 0..1. */
  value: number;
  onValueChange: (value: number) => void;
}

/**
 * A plain range input, styled. Not built on Headless UI like `Switch` and
 * `Button`: a native range already carries the keyboard and pointer behaviour,
 * and there is nothing here to un-style.
 */
export function Slider({ className = '', value, onValueChange, ...props }: SliderProps) {
  return (
    <input
      type="range"
      className={`slider ${className}`.trim()}
      min={0}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onValueChange(Number(e.target.value))}
      {...props}
    />
  );
}
