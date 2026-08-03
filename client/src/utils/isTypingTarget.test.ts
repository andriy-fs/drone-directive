import { describe, expect, it } from 'vitest';
import { isTypingTarget } from './isTypingTarget';

/**
 * The guard every window-level hotkey runs before it calls `preventDefault()`.
 * Getting it wrong is not subtle: a `false` where it should be `true` means
 * typing "space" in the chat pauses the match.
 */

/** A stand-in for a DOM node — the function is duck-typed precisely so this works. */
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

describe('isTypingTarget', () => {
  it('claims the text controls a player types into', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
  });

  it('claims a contenteditable element whatever its tag', () => {
    expect(isTypingTarget(el('DIV', true))).toBe(true);
  });

  it('leaves the rest of the page to the hotkeys', () => {
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('CANVAS'))).toBe(false);
  });

  it('is case-insensitive about the tag name', () => {
    expect(isTypingTarget(el('input'))).toBe(true);
  });

  it('treats a target that is not an element as fair game', () => {
    // `window` itself is the event target when nothing is focused.
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});
