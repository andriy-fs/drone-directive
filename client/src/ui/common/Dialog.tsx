import {
  Dialog as HeadlessDialog,
  DialogBackdrop as HeadlessDialogBackdrop,
  DialogPanel as HeadlessDialogPanel,
  DialogTitle as HeadlessDialogTitle,
} from '@headlessui/react';
import { type ComponentPropsWithoutRef } from 'react';

/**
 * A dialog opening is deliberately **silent**: it is always the consequence of a
 * button the player just pressed, and `Button` has already clicked for it. Two
 * cues on one action read as a stutter, not as feedback.
 */
export function Dialog(props: ComponentPropsWithoutRef<typeof HeadlessDialog>) {
  return <HeadlessDialog {...props} />;
}

export function DialogBackdrop(props: ComponentPropsWithoutRef<typeof HeadlessDialogBackdrop>) {
  return <HeadlessDialogBackdrop {...props} />;
}

export function DialogPanel(props: ComponentPropsWithoutRef<typeof HeadlessDialogPanel>) {
  return <HeadlessDialogPanel {...props} />;
}

export function DialogTitle(props: ComponentPropsWithoutRef<typeof HeadlessDialogTitle>) {
  return <HeadlessDialogTitle {...props} />;
}
