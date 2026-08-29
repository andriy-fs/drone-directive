import { useMemo } from 'react';
import { flatten, turntable, type Flat, type Model } from '../../models';

/**
 * One machine, drawn as an outline — the interface's renderer for the models the
 * hull view draws with Pixi.
 *
 * **SVG rather than a canvas, and that is a boundary decision before it is a
 * rendering one.** `ui/**` may not import Pixi (the one React↔Pixi seam is
 * `GameCanvas`), so reusing `pixi/render/fpv/units.ts` was never available. What is
 * available is the half both renderers share: `flatten` rotates a model onto a pose
 * and projects it, and forty-odd `<line>` elements are the whole of the rest.
 *
 * Which is cheap, and buys three things a canvas would have cost:
 *
 * - **It is themed.** Every stroke is `currentColor`, so a preview takes the colour
 *   of whatever it is sitting in, from `client/src/theme/**` — the right side of the
 *   line, since `config/palette.ts` is the *battlefield's* palette and a menu is not
 *   the battlefield.
 * - No canvas lifecycle, no device-pixel-ratio arithmetic, no resize observer, and
 *   no second WebGL context opened inside a modal.
 * - It scales with the layout: the `viewBox` is the panel, and the browser does the
 *   rest.
 *
 * Nothing here is wired into a screen yet. The title screen and the build
 * configurator are their own features; this is the piece they will both take.
 */

export interface WireframeProps {
  /** What to draw — `ROBOT_MODELS[chassis][weapon]`, a base, anything in `models/`. */
  model: Model;
  /**
   * Where the machine is being watched from, as a bearing round it in radians:
   * 0 is dead ahead. Animating this is the caller's business — a `requestAnimationFrame`
   * loop, a CSS-driven counter, or nothing at all.
   */
  spin?: number;
  /** How far above the machine the camera looks down from, in radians. */
  pitch?: number;
  /** The drawing's own coordinate space. Not CSS pixels: the SVG scales to its box. */
  size?: number;
  className?: string;
  /** Announced to assistive technology; without one the drawing is decorative. */
  title?: string;
}

/**
 * Every tier, always.
 *
 * The hull view picks a tier by range because it is drawing a hundred machines at
 * once and detail at a distance is a line nobody can see. A preview is one machine,
 * filling a panel, held still — the case the fine tier was authored for.
 */
const MAX_LOD = Infinity;

export function Wireframe({ model, spin = 0, pitch = 0.42, size = 240, className, title }: WireframeProps) {
  const lines = useMemo(() => {
    // A fresh buffer per render rather than a module-level scratch: this is not a
    // frame loop, and a shared buffer across two mounted previews would have them
    // overwrite each other.
    const out: Flat[] = [];
    const view = turntable(model, { width: size, height: size, spin, pitch });
    const count = flatten(out, model, { x: 0, y: 0, z: 0, heading: 0 }, view, { maxLod: MAX_LOD });
    return out.slice(0, count).filter((f) => f.ok);
  }, [model, spin, pitch, size]);

  return (
    <svg
      className={['wireframe', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${size} ${size}`}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      {lines.map((l, i) => (
        <line
          // Index, and legitimately: the list is one machine's segments in model
          // order, so entry `i` is the same edge from one render to the next.
          key={i}
          className={l.node ? 'wireframe__line wireframe__line--node' : 'wireframe__line'}
          x1={l.ax}
          y1={l.ay}
          x2={l.bx}
          y2={l.by}
        />
      ))}
    </svg>
  );
}
