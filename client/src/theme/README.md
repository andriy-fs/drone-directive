# Theme layer

The UI's colours, fonts and corner radii, as one set of CSS custom properties.

```
theme/
  tokens.css        the base look — every token, defined once, on :root
  themes/crt.css    one theme = one file of overrides under [data-theme='…']
  index.css         load order: tokens first, then every theme
  theme.ts          the id union, storage, and the <html data-theme> write
```

## Base vs default

Two different things, and they are allowed to be different themes:

- **The base** is `command`. Its values *are* the `:root` block in `tokens.css`,
  which is why it has no file under `themes/` — every other scheme overrides it
  and falls back to it token by token.
- **The default** is whatever `DEFAULT_THEME` in `theme.ts` names: what a player
  who has never chosen sees. Moving it is a one-line change, because a theme is
  applied by an attribute either way.

They are currently `command` and `crt` respectively. One thing outside this
folder has to keep up: the boot placeholder in `client/index.html` paints before
any stylesheet exists, so its literal colours guess the default.

## The rule that makes this work

**`ui/App.css` names no colour, font or radius of its own.** It reads roles
(`var(--danger)`, `var(--display)`, `var(--radius-md)`); the base values live in
`tokens.css`. So a theme never touches the stylesheet the game renders through —
which is the point: a new scheme can be built alongside the existing one with no
shared file to merge.

If a theme wants to change something the stylesheet spells out as a literal, the
fix is a **new token** in `tokens.css`, filled with the value already in App.css
so the default look is unchanged — never a component selector parked in a theme
file. A theme file that contains a class selector is a bug.

## Effects the default look doesn't use

The bottom of `tokens.css` is a block of **hooks**: roles whose default value is
the *absence* of the effect — text glow, `text-transform`, the inverted label on
an accent fill, the scanline overlay, the ASCII chrome. `App.css` reads them like
any other token, and with the defaults in place they render exactly as the
untokenised stylesheet did. A theme turns one on by giving it a value.

The pseudographic ones (`--bracket-open`, `--nav-marker`, `--chip-mark-*`,
`--corner-mark`) default to `none` rather than `''` on purpose: **`content: none`
generates no pseudo-element at all**, so a theme that wants none is not paying for
invisible flex items inside every button. That is the trick to reach for whenever
a theme needs to *add* something to the markup — put the character in a token and
let the other themes switch the element off entirely.

A couple of hooks are deliberately **scoped to one screen**: the CRT flicker and
roll (`--scanlines-flicker`, `--crt-roll`) hang off `.app-shell--menu`, so they
run on the title screen and stop the instant a match starts. If a theme wants
movement that a match can live with, it has to be compositor-only (`opacity`,
`transform`) — and even then, weigh it against a player reading the field under
fire. `@keyframes` live in `App.css` with everything else; a theme picks whether
to run them, it does not define behaviour.

`--glow-text` is the one hook declared outside `App.css`: it sits on `:root` in
`index.css`, because `text-shadow` inherits and one declaration is enough to reach
the whole interface.

## Adding a theme

1. `theme/themes/<id>.css` — one `[data-theme='<id>'] { … }` block, redefining
   whatever it wants to change. Partial is fine; anything omitted falls through
   to `tokens.css`.
2. `theme/index.css` — one `@import` line, **after** `tokens.css` (`:root` and
   `[data-theme]` have equal specificity, so order decides).
3. `theme.ts` — one entry in the `Theme` const map.
4. `ui/screens/menuOptions.ts` — one entry in `THEME_OPTIONS` (the picker's
   label; add the string to `i18n/dict.ts` + every locale if it should translate).

Nothing else. No React, no store change.

## What is *not* themed

The battlefield. Everything Pixi draws — units, terrain, projectiles, fog —
takes its colours from `config/palette.ts`, which is a separate table keyed by
game role and shared with the sprite briefs (`.docs/internal/sprites/`). A theme restyles
the interface around the world, not the world. Wiring the two together would
mean the canvas re-reading the palette on every switch, and the sprite art
disagreeing with it; if that is ever wanted, it is its own task.
