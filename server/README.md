# @drone-directive/server

Placeholder workspace for the online-multiplayer backend. **Not implemented yet.**

The plan is a thin WebSocket relay (Cloudflare Worker + Durable Objects) that pairs
two clients per room and rebroadcasts lockstep tick messages — it holds no game logic.
See [../.docs/multiplayer.md](../.docs/multiplayer.md) for the full design.

This directory currently exists only to register the `server` npm workspace so the
monorepo structure is in place; the implementation is out of scope for now.
