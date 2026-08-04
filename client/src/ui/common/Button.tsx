import { Button as HeadlessButton } from '@headlessui/react';
import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { sfx } from '../../pixi/audio/sfx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Suppress the click sound, for a button whose action already speaks. The chat
   * send button is the case that forced this: its `chatSend` cue would otherwise
   * start on the very same output sample as the click and the two would sum into
   * one loud transient rather than reading as two sounds.
   */
  silent?: boolean;
}

/** Shared styled button built on Headless UI — every button in the app goes through it. */
export function Button({ className = '', type = 'button', silent, onClick, disabled, ...props }: ButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!silent) sfx.buttonClick();
    onClick?.(e);
  };

  return (
    <HeadlessButton
      type={type}
      className={`btn ${className}`.trim()}
      disabled={disabled}
      onClick={handleClick}
      {...props}
    />
  );
}
