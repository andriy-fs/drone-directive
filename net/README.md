# @drone-directive/net

The online boundary for lockstep matches: everything between the relay socket and
the game's own vocabulary, and nothing else. It exists as its own package because
none of this is rendering, UI, or game rules — it used to live under the client's
Pixi layer, which was simply the wrong address.

Depends on `@drone-directive/types` and `@drone-directive/protocol`, plus
`valibot`. **Nothing else** — no renderer, no React, no game config, no bundler
globals. `npx tsc --noEmit` here passes without the client in sight.

## The three jobs, in the order a peer's frame meets them

| Module                  | Job                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lockstep/`             | **Transport.** Owns the socket, buffers both sides' per-tick input by tick number, answers "ready for tick N?". |
| `wire/codec/`           | **Shape.** BARE encode/decode + framing, and the mapping between wire and domain vocabularies.                  |
| `wire/validation/`      | **Meaning.** The valibot rules a decoded message must still satisfy to be a plausible order in this match.      |

Each folder is one job split into its parts, with the public surface in its
`index.ts`:

```
lockstep/         types.ts (the host's vocabulary)  -> input.ts    (decoded frame -> one tick's TickInput)
                  LockstepSession.ts (socket, buffers, desync probe)
wire/codec/       enums.ts (domain <-> wire tables) -> commands.ts (command mapping) -> frames.ts (encode/decode)
wire/validation/  schemas.ts (the valibot rules)    -> parser.ts   (what a failure costs, and how it is reported)
```

Decoding does not make a frame safe. BARE proves it is a well-formed `MoveRobots`
with a list of strings and a pair of f64s; only the semantic layer knows that an
f64 can be `NaN`, that the list must not be empty, and that the point has to land
on the map the players are actually on.

## Injected, not imported

Two things are the host application's business, and taking them as configuration
is what keeps this package independent:

```ts
new LockstepSession(handlers, {
  relayUrl: 'wss://…',
  // A thunk, not a value: the map is resized between matches, and a bound
  // captured once would start refusing legal orders after the first resize.
  limits: () => ({ worldWidth, worldHeight, maxRobots }),
});

setNetDebug(true); // narrate dropped input; the host decides what "dev" means
```

The client wires all three in
[`client/src/config/multiplayer.ts`](../client/src/config/multiplayer.ts).

## Symmetry is load-bearing

`LockstepSession` runs the semantic layer over the **local** batch as well as the
peer's. Under lockstep an asymmetric filter _is_ a desync source: a command one
client applies and the other rejects leaves the two simulations running different
worlds. Validation is a pure function of the command plus the limits, and both
peers hold the same limits, so both reach the same verdict. Anything added here
that can drop a command has to obey the same rule.

## Testing

```bash
npm run test -w net       # or `npm test` from the root, which runs this first
```

The tests need no game: `CommandLimits` is three numbers, and the codec is
exercised through round-trips. The full wire is covered separately by
`npm run e2e -w server`, which drives real frames against a running relay.
