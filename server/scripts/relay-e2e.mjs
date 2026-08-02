/**
 * End-to-end check of the relay against a live `wrangler dev`:
 *
 *   npm run dev -w server     # in one terminal
 *   npm run e2e -w server     # in another
 *
 * It imports nothing from the workspace on purpose. Asserting on raw frames is
 * what makes this a test of the *wire* rather than of the client's idea of the
 * wire — the tag numbers below are pinned literals, because changing one is a
 * breaking protocol change and should fail loudly here.
 *
 * `npm test` does not run this: Vitest is scoped to the client workspace and this
 * needs a server listening.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RELAY = process.env.RELAY_URL ?? 'ws://localhost:8787';
const HTTP = RELAY.replace(/^ws/, 'http');

// Read the live value rather than repeat it — a stale copy here would make every
// connection fail with `version-mismatch` and look like a relay bug.
const protocolSource = readFileSync(fileURLToPath(new URL('../../protocol/src/index.ts', import.meta.url)), 'utf8');
const V = Number(/PROTOCOL_VERSION = (\d+)/.exec(protocolSource)?.[1]);

const Tag = { Tick: 0, Created: 1, Start: 2, OpponentLeft: 3, Error: 4 };
const ErrorCode = { RoomNotFound: 0, RoomFull: 1, RoomTaken: 2, VersionMismatch: 3 };

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bytesEqual = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** A socket that collects every frame it receives, so assertions can be positional. */
function open(query) {
  const ws = new WebSocket(`${RELAY}/?${query}`);
  ws.binaryType = 'arraybuffer';
  ws.frames = [];
  ws.addEventListener('message', (e) => ws.frames.push(new Uint8Array(e.data)));
  return ws;
}

async function main() {
  check('protocol version was read from source', Number.isInteger(V), `${V}`);

  const health = await fetch(`${HTTP}/health`).then((r) => r.text());
  check('GET /health -> ok', health.trim() === 'ok', health);

  // --- create + join -------------------------------------------------------
  const host = open(`room=AB7K&create=1&v=${V}&mapSize=large&ai=1`);
  await wait(400);
  check('host receives exactly one frame', host.frames.length === 1, `${host.frames.length}`);
  check('...tagged Created', host.frames[0]?.[0] === Tag.Created, `tag=${host.frames[0]?.[0]}`);
  check('...binary, not JSON text', host.frames[0]?.[0] !== 0x7b, 'leading byte is not "{"');

  const guest = open(`room=AB7K&v=${V}`);
  await wait(400);
  const hostStart = host.frames[1];
  const guestStart = guest.frames[0];
  check('both peers receive start', !!hostStart && !!guestStart);
  check('...tagged Start', hostStart?.[0] === Tag.Start && guestStart?.[0] === Tag.Start);
  // The seed is the linchpin of the whole design: identical bytes is identical seed.
  check('...byte-identical on both sockets', bytesEqual(hostStart, guestStart));
  check('...1 tag + u32 seed + u8 mapSize + u8 aiCount = 7 bytes', hostStart?.length === 7, `${hostStart?.length}`);
  check('...carries the host mapSize (large = tag 2)', hostStart?.[5] === 2, `got ${hostStart?.[5]}`);
  check('...carries the host aiCount', hostStart?.[6] === 1, `got ${hostStart?.[6]}`);

  // --- tick relay ----------------------------------------------------------
  const tick = new Uint8Array([Tag.Tick, 0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
  host.send(tick);
  await wait(300);
  check('peer receives the tick', !!guest.frames[1]);
  check('...forwarded byte-for-byte, not re-encoded', bytesEqual(guest.frames[1], tick));

  const before = guest.frames.length;
  host.send(new Uint8Array([Tag.Created, 1, 2, 3])); // a tag the relay must not forward
  host.send('a JSON string, from a pre-v4 client');
  host.send(new Uint8Array(0));
  await wait(300);
  check('anything that is not a tick is dropped', guest.frames.length === before, `+${guest.frames.length - before}`);

  // --- teardown ------------------------------------------------------------
  host.close();
  await wait(400);
  const left = guest.frames[before];
  check('survivor is told the opponent left', left?.[0] === Tag.OpponentLeft, `tag=${left?.[0]}`);
  check('...opponentLeft is the tag byte alone', left?.length === 1, `${left?.length}`);
  guest.close();

  // --- rejections ----------------------------------------------------------
  const orphan = open(`room=ZZZZ&v=${V}`);
  await wait(400);
  check('joining an unhosted room errors', orphan.frames[0]?.[0] === Tag.Error, `tag=${orphan.frames[0]?.[0]}`);
  check('...with ROOM_NOT_FOUND', orphan.frames[0]?.[1] === ErrorCode.RoomNotFound, `got ${orphan.frames[0]?.[1]}`);
  orphan.close();

  const stale = open(`room=QQQQ&create=1&v=${V - 1}`);
  await wait(400);
  check('an out-of-date client is rejected', stale.frames[0]?.[0] === Tag.Error, `tag=${stale.frames[0]?.[0]}`);
  check('...with VERSION_MISMATCH', stale.frames[0]?.[1] === ErrorCode.VersionMismatch, `got ${stale.frames[0]?.[1]}`);
  stale.close();
}

try {
  await main();
} catch (e) {
  console.error(`\nCould not reach the relay at ${RELAY} — is \`npm run dev -w server\` running?\n`);
  throw e;
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
