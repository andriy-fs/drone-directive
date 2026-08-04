import {
  Dialog as HeadlessDialog,
  DialogBackdrop as HeadlessDialogBackdrop,
  DialogPanel as HeadlessDialogPanel,
  DialogTitle as HeadlessDialogTitle,
} from '@headlessui/react';
import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import { sfx } from '../../pixi/audio/sfx';

export function Dialog(props: ComponentPropsWithoutRef<typeof HeadlessDialog>) {
  const wasOpen = useRef(false);

  // `open` is owned by the caller, so the cue hangs off the false→true edge —
  // reacting to the value itself would replay it on every render of an open dialog.
  useEffect(() => {
    const open = props.open ?? false;
    if (open && !wasOpen.current) sfx.modalOpen();
    wasOpen.current = open;
  }, [props.open]);

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
