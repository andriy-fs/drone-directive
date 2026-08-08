import {
  Menu as HeadlessMenu,
  MenuButton as HeadlessMenuButton,
  MenuItem as HeadlessMenuItem,
  MenuItems as HeadlessMenuItems,
} from '@headlessui/react';
import { type ButtonHTMLAttributes, type ComponentPropsWithoutRef } from 'react';

/**
 * A dropdown of alternatives — the same pass-through treatment `Dialog` gets, so
 * feature code never imports Headless UI itself. Unlike a dialog this is *not* a
 * layer: it takes no place in Headless UI's stack, so it is safe to open one over
 * the title screen without any of the nesting caveats `MainMenu` documents.
 */
export function Menu(props: ComponentPropsWithoutRef<typeof HeadlessMenu>) {
  return <HeadlessMenu {...props} />;
}

/**
 * `ComponentPropsWithoutRef` collapses Headless UI's `as`-polymorphic props to
 * their default element and loses the plain button attributes with them — `title`
 * included. The trigger is always a `<button>` here, so the two are unioned back
 * together rather than opening the component up to `as` it doesn't need.
 */
export function MenuButton(
  props: ComponentPropsWithoutRef<typeof HeadlessMenuButton> & ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return <HeadlessMenuButton {...props} />;
}

export function MenuItems(props: ComponentPropsWithoutRef<typeof HeadlessMenuItems>) {
  return <HeadlessMenuItems {...props} />;
}

export function MenuItem(props: ComponentPropsWithoutRef<typeof HeadlessMenuItem>) {
  return <HeadlessMenuItem {...props} />;
}
