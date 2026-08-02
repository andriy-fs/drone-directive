# @drone-directive/types

Value types shared by more than one workspace — the game's own vocabulary, with
no behaviour attached. **Zero dependencies**, no build step; `exports` point
straight at the sources, so importing one costs nothing at runtime beyond the
consts it defines.

| Subpath                           | Holds                                                                      |
| --------------------------------- | -------------------------------------------------------------------------- |
| `@drone-directive/types/enums`    | `Owner`, `TaskType`, `ChassisType`, `WeaponType`, `MapSize`, `Difficulty`… |
| `@drone-directive/types/commands` | `Command` — the five player orders the whole game funnels through.         |
| `@drone-directive/types/entities` | `Vec2`, `BuildOrder`, `ResourcePool`, `DroneControl`.                      |
| `@drone-directive/types/tasks`    | Task/script value types.                                                   |

Subpaths rather than one barrel: they mirror the files, so an import says which
group it wants and moving a type between groups stays a visible change.

## What belongs here

A type earns a place here by being needed in **two or more workspaces** — in
practice `client` (the game) and `net` (the online boundary, which has to speak
the game's vocabulary to map the wire onto it). `DroneControl` is the clearest
case: the engine sets it every fixed step and the codec decodes it off the wire,
and neither package may depend on the other.

What does **not** belong here: anything with behaviour or tunables (that is
`client/src/config/gameConfig.ts`), the ECS `Entity` (game-core-only, and it would
drag miniplex in), and the wire message types (those are generated from
`protocol/schema/messages.bare` — the wire is deliberately not the domain).

## Enums

TS `enum` is allowed but not the default. Prefer the frozen const map + same-named
union in [`src/enums.ts`](./src/enums.ts): it stays a plain value at runtime, which
is what lets these types be shared without pulling a runtime along.
