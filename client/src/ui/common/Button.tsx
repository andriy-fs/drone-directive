import { Button as HeadlessButton } from '@headlessui/react';
import type { ButtonHTMLAttributes } from 'react';

/** Shared styled button built on Headless UI. */
export function Button({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <HeadlessButton type={type} className={`btn ${className}`.trim()} {...props} />;
}
