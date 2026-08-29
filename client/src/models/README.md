# `models/` — the machines, as geometry

Every unit's shape, and the maths that puts one on a screen. Nothing else.

## The rule

**This layer imports `@drone-directive/types/enums` and itself. Nothing else.**

Not Pixi, not React, not the store, not `engine/`, and not `config/` — neither
`palette` nor `gameConfig`. Camera numbers (field of view, near plane, viewport)
arrive as arguments; colour is the caller's business entirely.

That is the same contract the `types/` workspace has, without a workspace's
overhead — and it is the whole point of the folder. Three different things want
these models and none of them can reach each other:

- `pixi/render/fpv/` strokes them into a `Graphics` for the hull view;
- `ui/**` draws them as SVG, and may never import Pixi;
- the field view may want them later, through a different camera again.

Because the folder depends on nothing, promoting it to a `@drone-directive/models`
workspace later is a `git mv`, a `package.json` and an import rewrite. It has not
been promoted because nothing outside `client/` renders anything, so a workspace
would buy tooling-enforced purity rather than reuse.

## The local frame

`x` runs **forward** along the machine's heading, `y` to its **right**, `z` up from
the ground it stands on. That is not the world frame renamed: world `y` runs south,
and a machine's right is south only when it happens to face east. `flatten.ts` owns
the rotation from one to the other.

A model stands **on** `z = 0`: the renderer places it at the terrain height under
the machine, so anything below zero is a hull sunk into every hill on the map.

## What the files are

| File | What it holds |
| --- | --- |
| `segment.ts` | `Segment`, `Model`, `NodeKind`, and the two optional fields — `faces`, `lod` |
| `primitives.ts` | the shapes: `box`, `plate`, `tube`, `ring`, `prism`, `frustum`, `wheel`, `detail` |
| `transform.ts` | `at()` and `mirrorY()`: placing a part, once, at module load |
| `chassis.ts`, `weapons.ts`, `robots.ts` | the unit tables — exhaustive `Record`s over `types/src/enums.ts` |
| `structures.ts`, `ordnance.ts` | the base, and the things in flight |
| `project.ts` | the camera: `perspective()`, `project()`, and nothing else in the repo may write that matrix |
| `turntable.ts` | a camera that orbits one model and frames it, for a preview |
| `flatten.ts` | model + pose + projection → 2D segments; the step both renderers share |
| `bounds.ts` | extent of a model, in its own frame and on the screen |

## Two things a shape can say

**`faces`** — the outward normals of the faces an edge borders. An edge is hidden
only when *every* one of them is turned away, which is exact for the convex solids
these primitives make. Nothing is culled unless a renderer passes `cull` to
`flatten`, so tagging a primitive is inert until somebody opts in.

**`lod`** — a detail tier. 0 (or absent) is always drawn; higher tiers only when a
caller asks for them. Without it, a panel line costs the same at eight hundred
pixels as at eight, which is why the models were bare: detail was unaffordable at
range, so it was not authored at all.

## The cost of no art pipeline

A wireframe is a list of vertices — there is nothing here for `encode-sprites.mjs`
to encode, no master to keep in `client/assets-src/`, and no brief to write. The
bill is that **a new unit is two jobs**, a sprite and a model, and a forgotten model
makes that unit *invisible* to anyone in a hull.

Two things stand against that. `CHASSIS` and `WEAPONS` are exhaustive `Record`s, so
a new key in `types/src/enums.ts` fails the build rather than the picture. And
because `flatten()` needs no Pixi, every model can be projected in a test — see
`flatten.test.ts`, which is the half a type cannot state.
