# Why Valibot

[`net/src/wire/validation/`](../net/src/wire/validation) validates every
per-tick input before it reaches the engine. This is why that job needs a schema
library at all, and why this one.

## The problem it solves: a cast is not a check

`LockstepSession` used to do `msg.commands as Command[]`. `isCommandFrom`
(`client/src/engine/systems/commands.ts`) checked that the units named belonged to
the sender — but nothing checked that the object _was_ a command. A malformed or
deliberately corrupted message from the second client went straight into the
simulation.

The obvious cheap fix — hand-written type guards — is the wrong one here. Five
variants, a nested `BuildOrder` with a tri-state `task`, and enums that keep
gaining members: a hand-rolled guard drifts from the domain type silently, and the
one thing worse than no validation is validation everyone believes in.

## What the library has to make possible

**1. The schema must be checked against the domain type at compile time.** Two
constructs do it, and they are the reason this layer can be trusted:

```ts
// the return type is the assertion — not a cast, so TS actually checks it
function commandSchemaFor(limits: CommandLimits): v.GenericSchema<unknown, Command> {
  const commandSchemas = {
    /* … one entry per kind … */
  } satisfies Record<Command['kind'], v.GenericSchema>;
  return v.variant('kind', [...]);
}
```

Add a variant to `@drone-directive/types/commands` and the `satisfies` stops
compiling (a key is missing); get a field's type wrong and the return annotation
does (the parsed output no longer fits `Command`). The domain type drives the
schema, not the other way round.

**2. Enum membership must derive from the enum, not repeat it.**
`v.picklist(Object.values(TaskType))` reads the const map in
`types/src/enums.ts` directly, so a new `TaskType` cannot be forgotten here.

**3. Failure must be data, not an exception.** `v.safeParse` returns issues, which
is what lets `parseCommands` drop **one** bad order and keep its valid neighbours,
with a legible reason in dev. A validator that throws would have forced
all-or-nothing batches, and a match must not die over one malformed command.

**4. It must be small.** The client is a static Pages site and this runs in the
browser bundle. The pre-implementation measurement was 3 913 B minified /
1 436 B gzipped for one schema after tree-shaking — Valibot is a bag of
independent functions rather than one class graph, so you link only the
validators you name.

## Behaviours we lean on

Verified, not assumed — each is load-bearing for a specific failure mode:

| Behaviour                                                 | Why it matters here                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `v.number()` rejects `NaN` by default                     | A `NaN` coordinate walks a unit off the map and poisons `worldHash` — our worst input.    |
| `v.finite()` is still needed for `±Infinity`              | `v.number()` accepts them; the pipe adds the second half.                                 |
| `v.object()` strips unknown keys                          | Output is clean domain data; nothing extra can ride along.                                |
| `v.optional(v.nullable(...))` leaves an absent key absent | `BuildOrder.task` is tri-state — absent ≠ `null`, and `production` distinguishes them.    |
| `v.variant('kind', …)` on a discriminated union           | Mirrors `Command` exactly, and reports the failing variant rather than five union errors. |

## Why it stayed after BARE arrived

Binary decoding replaced the _shape_ half of the job, not the whole of it. **BARE
proves the shape, Valibot proves the meaning.** A frame can decode perfectly and
still be nonsense:

- an f64 that is `NaN` or `Infinity`,
- a `robotIds` list that is empty, or a hundred thousand long,
- a `point` that is a real coordinate pair but outside _this_ match's map,
- a batch of a million commands in one tick.

BARE cannot express any of those. Note the split also moved work _out_ of Valibot:
chassis/weapon/task membership is now enforced by the codec, because BARE enums
are closed — see [bare.md](./bare.md).

## The constraint that shaped the API

Under lockstep, **an asymmetric filter is a desync source**: a command one client
applies and the other rejects leaves the two simulations running different worlds.
So validation runs on the local batch as well as the peer's, and it must be a
**pure function** of the command plus limits both peers agree on.

That is why the match-dependent rules are a parameter, not an import:

```ts
parseCommands(raw, origin, { worldWidth, worldHeight, maxRobots });
```

`applyMapSize` rewrites the world size between matches, so `LockstepConfig.limits`
is a _thunk_ read per call — a bound captured at module load would start refusing
legal orders after the first resize. The side effect is that this layer tests with
three plain numbers and no game at all, which is what let it move out of the
client into [`net/`](../net).

The cost: the two limit-dependent schemas are rebuilt per call (`commandSchemaFor`).
They are cheap objects and a tick carries a handful of commands, which is a much
better trade than validating against a stale map.

## What this deliberately does _not_ do

- **It does not stop a modified client.** It stops malformed input and honest-client
  bugs. A peer that sends well-formed lies is a lockstep limitation that only
  server-authoritative simulation fixes — see
  [server-relay.md](./server-relay.md) § Deliberate non-goals.
- **It does not run offline.** Solo play never touches `LockstepSession`; this is
  strictly a network-boundary concern and cannot break a single-player match.
- **It does not check ownership.** That is `isCommandFrom`'s job, against the live
  world, which this layer has no access to by design.
