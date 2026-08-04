---
name: dd-i18n
description: >-
  Knowledge for Drone Directive UI LOCALIZATION (client/src/i18n/**, the `locale`
  field in gameStore, the language picker, the boot placeholder in index.html).
  Use whenever a task touches translated strings, adds or edits a language, moves
  the language switch, changes app bootstrap in main.tsx, or writes anything that
  sets `locale`. Explains the code-split dictionaries and the invariant that keeps
  `useT()` synchronous.
---

# Drone Directive — i18n

Four UI languages (`en`, `ru`, `uk`, `pl`). Dictionaries are **code-split**: each
one is its own chunk, a player downloads exactly the language they play in, and
none of the other three ever reach the browser.

Everything below follows from the one trade that made that possible:

> **`useT()` stays synchronous.** No `Dict | null`, no Suspense boundary, no
> loading state in any component — paid for by an invariant the store must keep.

## Where the pieces live

| Path                                | Holds                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `client/src/i18n/dict.ts`           | `interface Dict` — the shape every language must satisfy. Types only, no data.    |
| `client/src/i18n/locales/*.ts`      | The four dictionaries. Pure data; each `import type { Dict } from '../dict'`.     |
| `client/src/i18n/dictionaries.ts`   | The only module with `import()`: `loaders`, the cache, `loadDict`, `getDict`.     |
| `client/src/i18n/locale.ts`         | `Locale` const-map, `localStorage` read/write, browser detection. No dictionaries. |
| `client/src/i18n/index.ts`          | `useT()` and the `T` type. The React-facing barrel.                               |
| `client/src/store/gameStore.ts`     | `locale` state + `setLocale` (load, then switch) + the `requestedLocale` guard.   |
| `client/src/main.tsx`               | Awaits the initial dictionary before `createRoot().render()`; falls back to `en`. |
| `client/index.html`                 | `#boot` spinner shown until React mounts. Inline CSS, literal colours.            |
| `client/src/ui/screens/menuOptions.ts` | `LANGUAGE_OPTIONS` for the `ChipPicker` in `MainMenu`.                          |

Consumers only ever see `useT()`. Plain modules (`hud/programOptions.ts`,
`hud/sides.ts`, `hud/unitHints.ts`, `screens/menuOptions.ts`,
`screens/ControlsModal.tsx`) take `t: T` as a **parameter** and `import type` it —
keep it that way, so no data module reaches for a dictionary itself.

## 1. The invariant — never write `locale` directly

**The store's `locale` may only ever be set to a locale whose dictionary is
already cached.** `useT()` calls `getDict(locale)` synchronously; if the
dictionary is missing, `getDict` **throws** (deliberately — an `undefined` return
would surface as blank button labels far away from the cause, whereas a throw
names the broken locale).

So `useGameStore.setState({ locale })` outside the two sanctioned paths is a
white-screen crash, not a graceful degrade. The sanctioned paths:

- `setLocale` in `gameStore.ts` — loads, then switches;
- the fallback in `main.tsx` — `loadDict(Locale.En).then(() => setState(...))`,
  written load-first for exactly this reason.

Anything new that changes language (a deep link, a settings import, a server-sent
preference) must go through `setLocale`, or `await loadDict(x)` before it sets.

## 2. `setLocale` looks sync, behaves async

The signature is still `(locale: Locale) => void`, so `<ChipPicker
onChange={setLocale}>` needs no wrapper. But **the language changes over the
network**, which means:

- `setLocale(Locale.Ru)` followed by a read of `store.locale` still returns the
  old language. Don't assert on it synchronously.
- `saveLocale` runs **only on success** — a language whose chunk never arrives is
  not persisted, so it can't wedge `localStorage` on next boot.
- Out-of-order loads are guarded by a module-level `requestedLocale`: on a slow
  connection, EN→RU→UK settles on UK even if RU's chunk lands last. Covered by
  `client/src/store/gameStore.locale.test.ts` (verified to fail if the guard goes).

## 3. Adding a language

Four edits, and one of them has a silent failure mode:

1. `client/src/i18n/locale.ts` — add to the `Locale` const-map.
2. `client/src/i18n/locales/xx.ts` — the dictionary, typed `: Dict`.
3. `client/src/i18n/dictionaries.ts` — add to `loaders`.
4. `client/src/ui/screens/menuOptions.ts` — add to `LANGUAGE_OPTIONS`.

Steps 1–3 are enforced by the compiler (`Record<Locale, ...>` on both `loaders`
and the dictionary type). Step 4 is not.

**The `import()` path must be a string literal.** `import('./locales/' + locale)`
type-checks, runs, and quietly collapses every language back into one shared
chunk — the whole feature undone with no build error. Bundling is verified by
hand: `npm run build`, then confirm four `assets/{en,ru,uk,pl}-*.js` chunks and
zero translated strings in the main chunk.

`client/src/i18n/dictionaries.test.ts` compares each language's sections and keys
against English. That check used to be free — one `Record<Locale, Dict>` in one
file — and is worth keeping now that the files live in separate chunks where
drift is easy to miss.

## 4. Boot, and what it costs

First paint waits one round trip for the locale chunk (~2–3 kB gzip). During it
`#boot` in `index.html` spins: **inline `<style>`, literal hex colours**, because
`index.css` is injected by JS in dev and must not be a dependency of the
placeholder. React's `createRoot().render()` replaces it.

The chunks are loaded via `import.meta.url`, so the production `base: './'` in
`client/vite.config.ts` resolves them relatively — worth re-checking with
`npm run preview` if the deploy path or `base` ever changes.

Editing a locale file in dev triggers a **full page reload**, not a hot patch —
these modules are not components and have no HMR boundary (same as before the
split, just worth knowing when a translation edit seems not to apply).

## Gotchas

- `useT()` returns a fresh closure each render — fine (it's only ever called
  during render), but don't put it in a dependency array.
- Import the `Locale` **value** from `../i18n/locale`, not from the `../i18n`
  barrel: the barrel pulls in `useT` and the store, which data-only modules
  (`menuOptions.ts`) have no business importing.
- `Dict` lives in `dict.ts`, not in `locales/en.ts`. English is just another data
  file; nothing should import from `./en` for its type.
- Vitest runs `environment: 'node'` and collects `src/**/*.test.ts` only — a
  `.test.tsx` is silently not run. i18n tests are pure module tests (the loader,
  the store action), not rendered components.
- tsconfig: `verbatimModuleSyntax` → `import type`; no unused symbols.
