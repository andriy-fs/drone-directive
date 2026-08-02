# @drone-directive/server

WebSocket relay for online 2-player matches — a Cloudflare Worker whose single
Durable Object (`Room`) pairs two player sockets per room, generates the shared
RNG seed once both are connected, and forwards lockstep `tick` frames verbatim.
It holds no game logic and no persistence beyond a room's lifetime. The wire
format comes from [`@drone-directive/protocol`](../protocol); the full design is
in [../.docs/multiplayer.md](../.docs/multiplayer.md).

Frames are **binary**: one message-tag octet followed by a BARE payload. The tag
is outside the payload deliberately, so relaying is a one-byte read — the Worker
switches on `bytes[0]` and passes the original bytes through **without decoding
them**. It does encode the four messages it originates itself
(`created`/`start`/`opponentLeft`/`error`), so the generated writers for those are
in its bundle; every reader and the whole command graph are tree-shaken out.

## Develop / deploy

```bash
npm run dev -w server         # local relay via wrangler (miniflare) — no login needed
npm run e2e -w server         # end-to-end frame check against a running `dev` (see below)
npm run type-check -w server  # tsc --noEmit against @cloudflare/workers-types
npm run deploy -w server      # wrangler deploy (requires `npx wrangler login` first)
```

`npm test` is Vitest scoped to the client workspace and does not reach the relay,
so [`scripts/relay-e2e.mjs`](./scripts/relay-e2e.mjs) covers it separately: two
`WebSocket` clients driven through create → `created` → join → byte-identical
`start` → `tick` relay → `opponentLeft`, plus the `room-not-found` and
`version-mismatch` rejections. It needs a listening relay, which is why it is a
separate command. It imports nothing from the workspace and asserts on raw bytes,
so it tests the wire rather than the client's idea of the wire.

`npm run dev:relay` from the repo root is an alias for the first one — the root
`npm run dev` starts the game alone, so online play needs both running.

Point the client at the relay with `VITE_MULTIPLAYER_URL` (see the client README);
`wrangler dev` serves on `ws://localhost:8787` by default.

## Connection contract

A socket targets a room via query params (a WebSocket must pick its room before it
opens), then only `tick` frames flow. `v` is `PROTOCOL_VERSION` from the protocol
workspace — **currently `4`** — and the relay rejects anything else with
`version-mismatch`:

- host: `wss://<host>/?room=<CODE>&create=1&v=4&mapSize=<small|medium|large>&ai=<0-2>`
- guest: `wss://<host>/?room=<CODE>&v=4`

The query string is the one place the relay still handles text: it maps `mapSize`
to its schema tag (falling back to `medium`) and clamps `ai`. That is the whole of
its input validation.

The Worker routes each upgrade to `idFromName(room)`; the `Room` DO does the
pairing, seed handoff (`start`), relaying (`tick`), and teardown (`opponentLeft`).
