# @drone-directive/server

WebSocket relay for online 2-player matches — a Cloudflare Worker whose single
Durable Object (`Room`) pairs two player sockets per room, generates the shared
RNG seed once both are connected, and forwards lockstep `tick` messages verbatim.
It holds no game logic and no persistence beyond a room's lifetime. Wire types are
shared via [`@drone-directive/protocol`](../protocol); the full design is in
[../.docs/multiplayer.md](../.docs/multiplayer.md).

## Develop / deploy

```bash
npm run dev -w server         # local relay via wrangler (miniflare) — no login needed
npm run type-check -w server  # tsc --noEmit against @cloudflare/workers-types
npm run deploy -w server      # wrangler deploy (requires `npx wrangler login` first)
```

Point the client at the relay with `VITE_MULTIPLAYER_URL` (see the client README);
`wrangler dev` serves on `ws://localhost:8787` by default.

## Connection contract

A socket targets a room via query params (a WebSocket must pick its room before it
opens), then only `tick` messages flow:

- host: `wss://<host>/?room=<CODE>&create=1&v=1&mapSize=<small|medium|large>`
- guest: `wss://<host>/?room=<CODE>&v=1`

The Worker routes each upgrade to `idFromName(room)`; the `Room` DO does the
pairing, seed handoff (`start`), relaying (`tick`), and teardown (`opponentLeft`).
