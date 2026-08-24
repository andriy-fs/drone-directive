/**
 * Frame-time readout and render-layer switches, both driven by URL parameters.
 *
 * Written to find out why panning the field got slow after the terrain rewrite,
 * and kept because the answer was not guessable. Every plausible culprit was
 * wrong: it was not the fog redrawing 30 times a second, not the simulation, not
 * the ~19 000 static rectangles. It was one `Sprite` used as a mask — which Pixi
 * implements as a full offscreen render pass — costing 8.6 ms of a 30 ms frame.
 * A guess would have optimised the rectangles. The full write-up is in
 * `.docs/tasks/terrain-render-cost.md`.
 *
 * The method is what is worth keeping: turn one layer off, pan, read the p95.
 * Whatever moves the number is the answer.
 *
 * That method assumes the cost *is* in the drawing. When turning the quality down
 * moves nothing, the readout's `sim`/`render` split says which half to search
 * before any layer is switched off — and in a networked match `net stall` says
 * whether the world is slow for a third reason entirely: not frame cost at all,
 * but waiting on the peer's input.
 *
 * Everything defaults to current behaviour, so a URL without parameters runs the
 * game exactly as it does normally and this file costs one `URLSearchParams` parse.
 *
 * ```
 * ?perf=1              frame-time readout
 * &aa=0                antialias off (also a persisted setting — see `pixi/quality.ts`)
 * &terrain=0           skip the whole terrain view
 * &fog=0               skip the fog redraw
 * &galt=0              skip the second ground variant
 * &gdec=0              skip ground decals
 * &shadow=0            cast shadow off
 * &depth=0             depth shading off
 * &rim=0               boundary rim off
 * &peaks=0             ridge decals off
 * &debris=0            the stone and contact shadow at a mountain's foot off
 * &seed=7               pin the solo match's battlefield instead of seeding from the clock
 * ```
 *
 * `seed` is the odd one out — it changes the *match*, not the drawing. It lives here
 * anyway because this is the module that owns the URL-parameter surface, and because
 * what it is for is the same thing: comparing two runs of the renderer. Without it a
 * before/after pair of screenshots shows two different maps, and any judgement made
 * from them is a judgement about noise (see `scripts/screenshot.mjs`).
 */
export interface PerfFlags {
  hud: boolean;
  antialias: boolean;
  terrain: boolean;
  fog: boolean;
  groundAlt: boolean;
  groundDecals: boolean;
  shadow: boolean;
  depth: boolean;
  rim: boolean;
  peaks: boolean;
  debris: boolean;
  /** Fixed battlefield seed for solo play, or null to seed from the clock as usual. */
  seed: number | null;
  /** Human-readable list of everything set away from its default, for the readout. */
  overrides: string[];
}

function read(): PerfFlags {
  const overrides: string[] = [];
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

  const flag = (name: string, fallback: boolean): boolean => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const on = raw !== '0' && raw !== 'false';
    if (on !== fallback) overrides.push(`${name}=${on ? 1 : 0}`);
    return on;
  };

  const number = (name: string): number | null => {
    const raw = params.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    overrides.push(`${name}=${value}`);
    return value;
  };

  return {
    hud: flag('perf', false),
    antialias: flag('aa', true),
    terrain: flag('terrain', true),
    fog: flag('fog', true),
    groundAlt: flag('galt', true),
    groundDecals: flag('gdec', true),
    shadow: flag('shadow', true),
    depth: flag('depth', true),
    rim: flag('rim', true),
    peaks: flag('peaks', true),
    debris: flag('debris', true),
    seed: number('seed'),
    overrides,
  };
}

/**
 * Read once at module load. The flags describe how the scene was *built*, and the
 * terrain and ground are built once per match — re-reading them later would report
 * a state the scene graph isn't in.
 */
export const perfFlags: PerfFlags = read();
