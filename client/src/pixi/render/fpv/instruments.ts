import type { Graphics } from 'pixi.js';
import { palette } from '../../../config/palette';
import type { Vec2 } from '@drone-directive/types/entities';
import type { RobotEntity } from '../../../engine/ecs/archetypes';
import { project } from '../../../models';
import type { FpvProjection } from './camera';
import { robotHeat } from './units';

/**
 * The machine's own instruments, drawn on its monitor: a heading tape across the
 * top with a mark for home, and three bars in the corner for the state of the hull.
 *
 * **Here rather than in the React HUD, and that is not a style choice.** The HUD
 * rides a throttled snapshot — `hud.snapshotEveryTicks`, six ticks, five pushes a
 * second — because pushing per-frame HP into a Zustand store re-renders the tree on
 * every frame. Five hertz is fine for a roster and useless for something the pilot
 * is steering by: a reload bar that updates five times a second is visibly a
 * staircase, and a compass that does is unusable. Everything here is read straight
 * off the world in the render pass, at whatever rate the monitor runs.
 *
 * ## No words, and no font
 *
 * Nothing in `pixi/**` has ever drawn text — there is no `Text`, no `BitmapText`,
 * no font asset anywhere in the client — and this is not the feature that should
 * introduce one. So the tape says what it means with tick lengths, and the only
 * glyphs are the four cardinals, stroked from segments the way `models.ts` strokes
 * machines. That also keeps the layer's import list honest: `i18n/` is a UI-layer
 * vocabulary the canvas is not allowed to reach into, and a wordless instrument
 * never has to.
 *
 * ## The tape is projected, not laid out
 *
 * Every tick is a real direction, put through the same `project` the ground and the
 * machines go through — a point far away at eye height, which lands on the horizon.
 * The alternative, pixels-per-degree, is a linear approximation of a perspective
 * projection: correct in the middle of the screen and wrong by a growing margin
 * toward the edges, where a 66° field spreads to over 90° horizontally. Projecting
 * costs one matrix multiply per tick, of which there are a dozen, and buys ticks
 * that sit exactly above the ground they name — plus culling and the recoil dip for
 * free, since both are already in the matrix.
 */

/** How far out the tape's directions are placed. Any distance does; this one cannot overflow. */
const TAPE_RANGE = 1e5;

/** The tape's furniture, in CSS px from the top of the screen. */
const TAPE = {
  /**
   * Where the ticks hang from — clear of the radio log.
   *
   * That log is a DOM overlay pinned to the top right (`.radio-log`, 16 px down,
   * up to five lines of it), and it is not this view's to move: it belongs to the
   * top view as much as to this one. A tape at the very top edge reads straight
   * through it. Below the log there is nothing else up here — the horizon sits
   * around a third of the way down — so the compass gets the band between them.
   */
  baseline: 104,
  minor: 6,
  major: 13,
  /** The centre mark — a caret under the tape pointing at the hull's own heading. */
  caret: 7,
  glyphSize: 9,
  /** Degrees between ticks, and how often one is a major. */
  step: 10,
  majorEvery: 3,
};

/** The corner gauges, in CSS px. */
const GAUGE = {
  x: 24,
  bottom: 24,
  width: 96,
  height: 5,
  gap: 7,
};

/** Below this fraction of its hull the machine's integrity bar reads as a warning. */
const INTEGRITY_ALARM = 0.3;

/**
 * The four cardinals, as segments in a unit box — `x` right, `y` down, both 0..1.
 *
 * Twelve segments for the whole alphabet, which is the entire reason the tape can
 * be labelled without a font. Drawn in the same idiom as `models.ts`: data in code,
 * no art pipeline, and nothing to keep in sync with an asset.
 */
const GLYPHS: Record<string, readonly (readonly [number, number, number, number])[]> = {
  N: [
    [0, 1, 0, 0],
    [0, 0, 1, 1],
    [1, 1, 1, 0],
  ],
  E: [
    [1, 0, 0, 0],
    [0, 0, 0, 1],
    [0, 1, 1, 1],
    [0, 0.5, 0.75, 0.5],
  ],
  S: [
    [1, 0, 0, 0],
    [0, 0, 0, 0.5],
    [0, 0.5, 1, 0.5],
    [1, 0.5, 1, 1],
    [1, 1, 0, 1],
  ],
  W: [
    [0, 0, 0.2, 1],
    [0.2, 1, 0.5, 0.35],
    [0.5, 0.35, 0.8, 1],
    [0.8, 1, 1, 0],
  ],
};

/**
 * Which cardinal sits at which azimuth.
 *
 * Heading 0 is **east** (`atan2` over world axes) and world `y` runs **south**, so
 * the compass runs clockwise on the screen through E, S, W, N. Stated once, here,
 * because it is the one place the view has to name a world direction out loud.
 */
const CARDINALS: Record<number, string> = { 0: 'E', 90: 'S', 180: 'W', 270: 'N' };

/** One mark on the heading tape. */
export interface TapeTick {
  /** CSS px from the left of the canvas. */
  x: number;
  major: boolean;
  /** The cardinal that sits here, if one does. */
  glyph?: string;
}

/**
 * The direction `azimuth` (radians) as a point on the tape, or null when it is
 * behind the camera or off the canvas.
 *
 * Placed at eye height and a long way off, so it is a *bearing* and not a place:
 * the answer does not move as the hull drives, only as it turns.
 */
function tapeX(view: FpvProjection, azimuth: number, screenW: number): number | null {
  const p = project(
    view,
    view.eye.x + Math.cos(azimuth) * TAPE_RANGE,
    view.eye.y + Math.sin(azimuth) * TAPE_RANGE,
    view.eye.z,
  );
  if (!p || p.x < 0 || p.x > screenW) return null;
  return p.x;
}

/** Back into (-pi, pi]. */
function wrapAngle(a: number): number {
  const turn = Math.PI * 2;
  const wrapped = a % turn;
  if (wrapped > Math.PI) return wrapped - turn;
  if (wrapped <= -Math.PI) return wrapped + turn;
  return wrapped;
}

/**
 * Every tick the tape can show, left to right.
 *
 * Walks whole steps of azimuth either side of where the view points and lets
 * `tapeX` throw away what does not land — which is both the culling and the
 * horizontal field, without this file having to work out what that field is.
 */
export function headingTicks(view: FpvProjection, viewHeading: number, screenW: number): TapeTick[] {
  const ticks: TapeTick[] = [];
  const centre = Math.round(((viewHeading * 180) / Math.PI) / TAPE.step) * TAPE.step;
  // Wide enough to reach past both edges of any sane field, and cheap: what falls
  // off the canvas is dropped by `tapeX` rather than reasoned about here.
  const reach = 90;
  for (let deg = centre - reach; deg <= centre + reach; deg += TAPE.step) {
    const x = tapeX(view, (deg * Math.PI) / 180, screenW);
    if (x === null) continue;
    const wrapped = ((deg % 360) + 360) % 360;
    ticks.push({
      x,
      major: wrapped % (TAPE.step * TAPE.majorEvery) === 0,
      glyph: CARDINALS[wrapped],
    });
  }
  return ticks;
}

/** Where home is: a place on the tape, or which way to turn to find it. */
export interface BearingMark {
  /** CSS px from the left, already clamped to the canvas when `edge` is set. */
  x: number;
  /** 0 when the bearing is on screen; -1 or +1 when it is off to that side. */
  edge: -1 | 0 | 1;
}

/**
 * The bearing from the hull to a place, as a mark on the tape.
 *
 * Behind the camera it becomes an arrow pinned to whichever edge is the shorter way
 * round, which is why the signed angle is computed here rather than left to
 * `project`: a projection can only say "not on screen", and a pilot needs to know
 * which way to turn.
 */
export function bearingMark(
  view: FpvProjection,
  viewHeading: number,
  from: Vec2,
  to: Vec2,
  screenW: number,
): BearingMark {
  const azimuth = Math.atan2(to.y - from.y, to.x - from.x);
  const x = tapeX(view, azimuth, screenW);
  if (x !== null) return { x, edge: 0 };
  const side = wrapAngle(azimuth - viewHeading) >= 0 ? 1 : -1;
  return { x: side > 0 ? screenW - GAUGE.x : GAUGE.x, edge: side };
}

/** What the corner bars read, all 0..1. */
export interface Gauges {
  /** Hull integrity — what is left of it. */
  integrity: number;
  /** Reload: full when the gun is ready, empty the instant a round leaves. */
  reload: number;
  /** How hard the machine is driving. */
  drive: number;
}

/**
 * The three readings, off the world.
 *
 * `reload` and `drive` come through `robotHeat` rather than being recomputed: it
 * already carries the two divide-by-zero guards that matter — a weapon with no
 * cooldown never fires, and a chassis with no speed cannot be a fraction of it —
 * and reusing it is what keeps the bar and the glow on the barrel telling the same
 * story.
 */
export function gauges(robot: RobotEntity): Gauges {
  const heat = robotHeat(robot);
  const integrity = robot.maxHp > 0 ? Math.min(1, Math.max(0, robot.hp / robot.maxHp)) : 0;
  return { integrity, reload: 1 - heat.barrel, drive: heat.drive };
}

/** Strokes one cardinal, centred on `cx`, hanging with its top at `top`. */
function drawGlyph(g: Graphics, glyph: string, cx: number, top: number, alpha: number): void {
  const segments = GLYPHS[glyph];
  if (!segments) return;
  const s = TAPE.glyphSize;
  const left = cx - s / 2;
  for (const [x0, y0, x1, y1] of segments) {
    g.moveTo(left + x0 * s, top + y0 * s).lineTo(left + x1 * s, top + y1 * s);
  }
  g.stroke({ width: 1, color: palette.fpv.self, alpha });
}

/** One bar: an empty frame with a filled part, so an empty gauge is still visibly a gauge. */
function drawBar(g: Graphics, y: number, fill: number, color: number): void {
  const { x, width, height } = GAUGE;
  g.rect(x, y, width, height).stroke({ width: 1, color, alpha: 0.45 });
  if (fill > 0) g.rect(x, y, width * fill, height).fill({ color, alpha: 0.75 });
}

/** Everything the instruments need for one frame. */
export interface InstrumentFrame {
  view: FpvProjection;
  /** Where the camera is looking — the axis the eye sits on, not the hull's heading. */
  viewHeading: number;
  robot: RobotEntity;
  /** The hull's own side's base, or undefined once it is gone. */
  home: Vec2 | undefined;
  screenW: number;
  screenH: number;
}

/**
 * Draws the whole panel into `g`, which the caller has already cleared.
 *
 * Screen space throughout — nothing here is in the world, so nothing is affected by
 * where the hull stands, only by where it looks.
 */
export function drawInstruments(g: Graphics, frame: InstrumentFrame): void {
  const { view, viewHeading, robot, home, screenW, screenH } = frame;

  // The tape. Ticks hang down from the baseline; a major is longer, and a cardinal
  // hangs its glyph below the major it belongs to.
  for (const tick of headingTicks(view, viewHeading, screenW)) {
    const len = tick.major ? TAPE.major : TAPE.minor;
    g.moveTo(tick.x, TAPE.baseline).lineTo(tick.x, TAPE.baseline + len);
    if (tick.glyph) drawGlyph(g, tick.glyph, tick.x, TAPE.baseline + TAPE.major + 4, 0.9);
  }
  g.stroke({ width: 1, color: palette.fpv.terrain, alpha: 0.9 });

  // The centre mark: a caret above the tape at the middle of the screen, which is
  // where the machine is pointed by construction.
  const mid = screenW / 2;
  g.moveTo(mid - TAPE.caret, TAPE.baseline - TAPE.caret)
    .lineTo(mid, TAPE.baseline)
    .lineTo(mid + TAPE.caret, TAPE.baseline - TAPE.caret);
  g.stroke({ width: 1, color: palette.fpv.self, alpha: 0.95 });

  // Home. Absent rather than wrong once the base is gone.
  if (home) {
    const mark = bearingMark(view, viewHeading, robot.position, home, screenW);
    const y = TAPE.baseline + TAPE.major + 2;
    if (mark.edge === 0) {
      g.moveTo(mark.x - 5, y + 7).lineTo(mark.x, y).lineTo(mark.x + 5, y + 7).lineTo(mark.x - 5, y + 7);
    } else {
      // Off the edge: an arrow lying on its side, pointing the shorter way round.
      const dir = mark.edge;
      g.moveTo(mark.x, y).lineTo(mark.x + dir * 8, y + 5).lineTo(mark.x, y + 10).lineTo(mark.x, y);
    }
    g.fill({ color: palette.fpv.friend, alpha: 0.9 });
  }

  // The bars, bottom left, in the order they are wanted under fire: what is left of
  // the machine, whether it can shoot, how hard it is driving. Told apart by colour
  // and place rather than by labels — the same way the heat passes say "this part
  // is hot" without naming it.
  const read = gauges(robot);
  const rows = [
    { fill: read.integrity, color: read.integrity <= INTEGRITY_ALARM ? palette.fpv.foe : palette.fpv.self },
    { fill: read.reload, color: palette.fpv.heat },
    { fill: read.drive, color: palette.fpv.self },
  ];
  const first = screenH - GAUGE.bottom - rows.length * (GAUGE.height + GAUGE.gap);
  rows.forEach((row, i) => drawBar(g, first + i * (GAUGE.height + GAUGE.gap), row.fill, row.color));
}
