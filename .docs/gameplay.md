# Gameplay

What the game is, from the player's side: what is in it, how it is controlled,
and how a match runs from menu to victory screen. For how any of it is built,
see [architecture.md](architecture.md).

## Features

- **Top-down battlefield** on a tile grid, with a pannable/zoomable camera and
  three map-size presets (40×40 / 60×60 / 80×80).
- **Bases** with production queues, health, and win/lose on destruction. Each
  base also holds one **energy dome** for the match — a "last hope" charge that
  absorbs damage aimed at the building and nothing else: it is armor, not a
  wall, so units still walk under it and a kamikaze still drives straight in.
- **Robots** — 3 chassis (tracks / wheels / legs) × 7 weapons: a cannon, a
  surface-to-air missile launcher (the only weapon that can engage a drone), a
  kamikaze bomb, a radar module that doubles its own sight radius, an EW jammer
  that halves nearby enemies' sight, a directed-energy weapon that disables what
  it hits rather than destroying it, and an FPV carrier that fires a salvo of
  single-use strike drones — the one weapon that shoots _over_ terrain and
  beyond its own line of sight, bounded instead by what its side can currently
  see.
- **The observer drone** — a free-flying "eye" you pilot directly that reveals
  the map and can land on an idle robot to fire its weapon manually. It is **not
  invulnerable**: enemy missiles shoot it down in three hits, and the side that
  loses one flies blind for 30 seconds while a replacement is built (the HUD
  shows the readiness bar). Riding inside a robot makes it untouchable — so
  scouting is the risk, and possession is the cover. Missile units engage a
  drone only opportunistically: they never chase one, and never pick it over a
  ground target they can already shoot. The bot pilots its own drone with the
  same entity and the same rules.
- **The hull view** — landing on a robot does not tilt the camera, it **replaces
  the picture**. The battlefield goes, and what comes up is that machine's own
  sensor monitor: the ground as a green vector grid with the relief on it, other
  machines as wireframe contours (yours in blue, everyone else's in red), and
  your own hull drawn from behind so you can see where it is pointed. Every
  machine is drawn as what it actually is — a tank's two track bands, a buggy's
  four exposed wheels, a walker's body carried high on six legs, and the module
  on top of it — so the same reading that works from above works from inside.
  **Hot parts glow**: a barrel that has just fired, wheels and legs under load.
  A distant contour tells you what a machine is; its glow tells you what it is
  doing, which is something the top-down view has never been able to show.
  Unexplored ground is not drawn at all — the monitor shows you what your side
  has found, not what is there.

  Two things the monitor tells you that the top-down view never could. Drive into
  an enemy **jammer's** aura and the picture tears itself apart — the closer you
  get, the worse it is, and until now the only sign of a jammer was that your
  units mysteriously stopped seeing things. And a hull knocked out by a
  **directed-energy** hit shows you nothing at all: eight seconds of static, which
  is why it has stopped answering the stick. **The mouse goes dead while you are inside:** no marquee, no
  orders, no base selection. That is the trade — you give up commanding to gain a
  gun you aim yourself. The HUD stays live, so building and directives still work,
  and `F` (or switching the view off the drone) puts you straight back on top with
  your selection and orders untouched.
- **Selection & group control** — click, shift-click, drag-marquee, `Ctrl+A`,
  double-click to select every robot sharing a weapon, and classic RTS control
  groups (`Ctrl+1-9` to save a selection, `1-9` to recall it).
- **Programming** — assign directives (Idle, Guard, Attack Base, Attack
  Robots, Scout, Attack Target) to one or many units; robots execute them
  autonomously.
- **Combat** — projectiles with cooldowns, line-of-sight, distinct visuals and
  sound per weapon, and area-of-effect explosions.
- **Formations and crowd movement** — groups march as a shape, and units
  negotiate their way through each other and through terrain with reciprocal
  collision avoidance rather than shoving.
- **Resource economy** — both sides earn resources over time and spend them on
  production.
- **Enemy AI** — resource-gated production with staged wave attacks, a
  reactive defense that pulls guards (and, against a large enough assault, its
  whole army) back home, a kamikaze that picks between rushing the base or a
  cluster of your robots, a guaranteed EW jammer, and a posture system that
  presses an advantage or turtles up based on the current robot-count balance.
- **Random obstacles** — each match generates terrain that blocks movement and
  shots; units **pathfind around** it (A\*), and a route is always guaranteed.
- **Difficulty levels** — Easy / Normal / Hard change the starting unit counts.
- **Base setup from the menu** — pre-configure continuous auto-production and
  the initial directive given to every new robot.
- **4 languages** — English, Russian, Ukrainian, Polish.
- **Interface themes** — the HUD reads its colours from tokens, so alternative
  schemes ship as one override file each.
- **Pause**, **sound effects** (sample files, with per-cue mix balance),
  **title-screen music**, and a full **menu → match → victory/defeat → replay**
  loop.
- **Online 2-player** — host or join a room by a 4-character code and play
  head-to-head over a WebSocket relay. The match runs in **deterministic
  lockstep**: only each player's per-tick orders cross the network, and both
  clients simulate the identical world from one shared seed. Orders travel as
  **binary [BARE](https://baremessages.org/) frames** generated from a schema, and
  are validated at the network boundary before they reach the engine. Each side
  pilots its own observer drone, has its own fog of war, and sees itself in the
  friendly colour — the rival's drone stays hidden until something of yours
  actually spots it, which is also the moment your missiles can start shooting at
  it. Design: [multiplayer.md](multiplayer.md) · backend:
  [server-relay.md](server-relay.md).
- **In-match chat** — a second socket to a second Durable Object, deliberately
  outside the lockstep stream so it survives the match it belongs to. See
  [`chat/README.md`](../chat/README.md).

## Controls

| Input                            | Action                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| **Left-drag** (empty ground)     | Box-select your robots (marquee)                              |
| **Left-click** a robot           | Select it                                                     |
| **Shift+click** / **Shift+drag** | Add to the current selection                                  |
| **Double-click** a robot         | Select all your robots carrying the same weapon               |
| **Double-click** your base       | Open the **Build & Program** dialog                           |
| **Ctrl/Cmd + A**                 | Select all your robots                                        |
| **Ctrl/Cmd + 1-9**               | Save the current selection as control group N                 |
| **1-9**                          | Recall control group N                                        |
| **Left-click** empty ground      | Clear selection                                               |
| **Right-click**                  | Move the selection to that point (in formation)               |
| **Middle-mouse drag**            | Pan the camera                                                |
| **Esc** / **Space** / **P**      | Pause / resume                                                |
| **W A S D** / **arrow keys**     | Fly the observer drone (pan the camera while it is shot down) |
| **F**                            | Land the drone on / release an idle robot (switches to the hull view) |
| **E**                            | Fire the possessed robot's weapon                             |

Use the **Program** panel in the HUD to assign a directive to the selected
unit(s), and the **Build Robot** dialog to produce units (once or on a
continuous auto-build loop).

## How a match flows

1. On the **main menu**, pick a language, difficulty, and map size, and
   optionally switch on auto-production (a chosen robot built on repeat, and/or
   a default directive for new robots) — it starts off, so every unit is yours
   to choose.
2. You start with a base and an observer drone, and no robots at all: the whole
   army is built to whatever plan you pick. Difficulty decides how fast the
   bots can afford theirs.
3. Earn resources over time; **build** and **program** robots, or fly the
   observer drone yourself — keeping it clear of enemy missile units, which
   will shoot it down and leave you without an eye for 30 seconds.
4. Send units to **attack the enemy base** while defending your own — the
   enemy AI adapts to how the fight is going.
5. Destroy the enemy base to win (or lose if yours falls). Then **Play Again**
   or return to the menu.
