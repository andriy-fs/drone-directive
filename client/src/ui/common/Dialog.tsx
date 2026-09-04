import {
  Dialog as HeadlessDialog,
  DialogBackdrop as HeadlessDialogBackdrop,
  DialogPanel as HeadlessDialogPanel,
  DialogTitle as HeadlessDialogTitle,
} from '@headlessui/react';
import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

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

/**
 * The full-screen box a modal centres its panel in — and the reason a click
 * *beside* the panel doesn't press whatever the modal was covering.
 *
 * Headless UI closes on the `pointerup`/`touchend` that lands outside the panel
 * (see its `useOutsideClick`), and React unmounts the dialog inside that same
 * event. The browser then delivers the **click** of the very same gesture, by
 * which point this frame is gone — so it lands on the control underneath: the
 * title screen's Start, a HUD button, or the battlefield itself. Headless UI
 * guards against that with a `preventDefault()`, but only for a target that
 * reports a real `tabIndex`, and a plain `div` reports `-1`; the frame and the
 * backdrop are exactly that.
 *
 * So the gesture that closes a dialog arms a one-shot listener that eats the
 * click it is about to produce. On `window`, in the **capture** phase, which is
 * ahead of both Headless UI's document listeners and React's root container, so
 * the swallowed click reaches no handler at all — React's or Pixi's.
 */
export function DialogFrame({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const arm = (event: Event) => {
      const el = frame.current;
      const { target } = event;
      if (el === null || !(target instanceof Node)) return;
      // A gesture that ended on the panel or its contents is an ordinary click
      // on the dialog's own controls, and must be left alone. `el` itself is the
      // margin around the panel, so it counts as outside.
      if (target !== el && el.contains(target)) return;

      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
        disarm();
      };
      const disarm = () => window.removeEventListener('click', swallow, true);
      window.addEventListener('click', swallow, true);
      // Belt and braces: the click of this gesture is dispatched ahead of any
      // timer, so a macrotask is late enough to catch it and early enough not to
      // reach the player's *next* click if the browser sends none at all.
      window.setTimeout(disarm, 0);
    };

    // Both, because they are two different gestures rather than one: Headless UI
    // takes the `touchend` path on a phone or tablet and the pointer path
    // everywhere else, and the stray click follows either.
    window.addEventListener('pointerup', arm, true);
    window.addEventListener('touchend', arm, true);
    return () => {
      window.removeEventListener('pointerup', arm, true);
      window.removeEventListener('touchend', arm, true);
    };
  }, []);

  return (
    <div ref={frame} className="dialog-frame">
      {children}
    </div>
  );
}
