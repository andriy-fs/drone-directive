import {
  Dialog as HeadlessDialog,
  DialogBackdrop as HeadlessDialogBackdrop,
  DialogPanel as HeadlessDialogPanel,
  DialogTitle as HeadlessDialogTitle,
} from '@headlessui/react';
import type { ComponentPropsWithoutRef } from 'react';

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
