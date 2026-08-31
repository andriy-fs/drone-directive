/**
 * A bench for the wireframe view — `pixi/render/fpv/` with the game taken off it.
 *
 * **Why this exists.** The monitor only turns on when a drone lands on a robot, so
 * looking at a change to the ground meant playing a match: start, wait for a hull to
 * roll out, fly the drone over, land on it, drive somewhere with terrain worth
 * seeing. That is a minute of clicking per look, it lands the camera somewhere
 * slightly different every time, and it makes a shading change impossible to judge
 * against the shot before it. Everything in that sequence is the *game*; none of it
 * is the thing under the lens.
 *
 * So this page builds the smallest world the view will accept — a map, one robot to
 * hang the camera off, and a fog state that has seen everything — and renders one
 * frame at a pose the URL asks for. `FpvView` itself is imported, not reimplemented:
 * the geometry, the shader and the camera are exactly the ones the game runs, which
 * is the only part that has to be true for a screenshot to mean anything.
 *
 * **Dev only.** Vite builds `index.html` and what it imports; a second page at the
 * client root is served by `npm run dev` and never enters `dist`. Nothing in the app
 * imports this file.
 *
 * ```
 * /fpv-lab.html?seed=7&pose=cliff               # standing off the nearest massif
 * /fpv-lab.html?seed=7&pose=crater
 * /fpv-lab.html?seed=7&pose=plain
 * /fpv-lab.html?seed=7&x=600&y=800&heading=90   # or an explicit spot: world px, degrees
 * ```
 */
import { Application } from 'pixi.js';
import { ChassisType, Owner, TerrainKind, WeaponType } from '@drone-directive/types/enums';
import { gameConfig, worldPixelSize } from '../config/gameConfig';
import { palette } from '../config/palette';
import { spawnRobot } from '../engine/ecs/factory';
import { createEcsWorld } from '../engine/ecs/world';
import type { FogState } from '../engine/game/context';
import { generateObstacles } from '../engine/obstacles';
import { createRng } from '../utils/rng';
import { FpvView } from '../pixi/render/fpv/FpvView';

const params = new URLSearchParams(location.search);
const num = (name: string, fallback: number): number => {
  const raw = params.get(name);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const seed = num('seed', 7);
const terrain = generateObstacles(createRng(seed));
const { tilePx } = gameConfig.grid;

type PoseName = 'cliff' | 'crater' | 'plain';

/**
 * A pose worth photographing, found in the map rather than typed in.
 *
 * Hard-coding coordinates would tie every shot to one seed, and the interesting
 * places are exactly the ones a seed moves around. So each named pose is a search:
 * stand off the thing it is named after, at a distance where the relief fills the
 * lower half of the monitor, looking straight at it.
 */
function findPose(kind: PoseName): { x: number; y: number; heading: number } {
  const centre = { x: worldPixelSize.width / 2, y: worldPixelSize.height / 2 };
  if (kind === 'plain') return { x: centre.x, y: centre.y, heading: -Math.PI / 2 };

  const want = kind === 'cliff' ? TerrainKind.Mountain : TerrainKind.Crater;
  // The tile of that kind nearest the middle of the map — near the middle so the
  // camera has room to stand back from it without leaving the world.
  let best: { x: number; y: number; d: number } | null = null;
  for (let ty = 0; ty < terrain.length; ty++) {
    for (let tx = 0; tx < terrain[ty].length; tx++) {
      if (terrain[ty][tx] !== want) continue;
      const x = (tx + 0.5) * tilePx;
      const y = (ty + 0.5) * tilePx;
      const d = Math.hypot(x - centre.x, y - centre.y);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  if (!best) return { x: centre.x, y: centre.y, heading: -Math.PI / 2 };

  // Stand south of it and look north. The standoff is set so a landform lands in the
  // lower half of the frame rather than on the horizon, which is where a change to
  // its shading can actually be seen.
  const STANDOFF = 260;
  return { x: best.x, y: Math.min(best.y + STANDOFF, worldPixelSize.height - tilePx), heading: -Math.PI / 2 };
}

const posed = findPose((params.get('pose') as PoseName | null) ?? 'cliff');
const pose = {
  x: num('x', posed.x),
  y: num('y', posed.y),
  heading: params.has('heading') ? (num('heading', 0) * Math.PI) / 180 : posed.heading,
};

/** Seen everything, everywhere — the mask is not what is being looked at here. */
const fog: FogState = {
  explored: terrain.map((row) => row.map(() => true)),
  visible: terrain.map((row) => row.map(() => true)),
  version: 1,
};

const app = new Application();
await app.init({
  // WebGL because these shaders are GLSL-only, at the resolution the page was opened
  // with — both the same as `GameApp`.
  preference: 'webgl',
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio,
  width: window.innerWidth,
  height: window.innerHeight,
  background: palette.fpv.void,
});
document.body.appendChild(app.canvas);

const world = createEcsWorld();
const robot = spawnRobot(world, Owner.Player, { x: pose.x, y: pose.y }, ChassisType.Tracks, WeaponType.Cannon);
robot.heading = pose.heading;

const view = new FpvView();
// The same two lines `GameApp` uses, and the first is not optional: without a bound
// filter area Pixi measures the monitor pass against the mesh's global bounds, and
// those are the whole map in world coordinates rather than the viewport.
view.attachTo(app.screen);
view.setTerrain(terrain);
app.stage.addChild(view.container);

// In the game this is `syncFpv`'s to own — it derives the switch from the world every
// frame, so that the monitor cannot outlive the hull under the pilot. Here there is no
// world to ask and the hull is never going anywhere.
view.container.visible = true;

/**
 * The rig is smoothed, and one frame is not enough to see it.
 *
 * `beat` opens with `rig.reset()` for a hull it has not seen before, and everything
 * the camera does from there — the dolly, the tilt, the settle onto the ground — is an
 * exponential easing toward the pose. Photographed on the first frame the camera is
 * still halfway out of its own reset, which is a picture of the easing rather than of
 * the view. Forty frames of real time is well past every `tau` in `camera.ts`.
 */
const SETTLE_FRAMES = 40;

for (let i = 0; i < SETTLE_FRAMES; i++) {
  view.render({
    robot,
    world,
    fog,
    // No match behind this, so no jamming — the interference the feed filter shows is
    // the one thing here that cannot be photographed, and it is not what this is for.
    ctx: null,
    isVisible: () => true,
    width: app.screen.width,
    height: app.screen.height,
    now: performance.now(),
  });
  app.render();
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

// What the screenshot script waits on: nothing in the DOM otherwise says the canvas
// has anything on it.
document.body.dataset.ready = '1';
