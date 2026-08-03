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
// Chat shares the tag space with the game but never the socket.
const ChatTag = { Send: 5, History: 6, Posted: 7, Presence: 8 };
const ErrorCode = { RoomNotFound: 0, RoomFull: 1, RoomTaken: 2, VersionMismatch: 3 };

/** BARE writes a string as its length (varint) followed by UTF-8 — enough of an encoder for one field. */
function encodeStringPayload(text) {
  const utf8 = new TextEncoder().encode(text);
  const len = [];
  for (let n = utf8.length; ; n >>>= 7) {
    if (n < 0x80) {
      len.push(n);
      break;
    }
    len.push((n & 0x7f) | 0x80);
  }
  return new Uint8Array([...len, ...utf8]);
}

/** The matching reader, so an assertion can be about the text and not about offsets. */
function readString(bytes, offset) {
  let length = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    const b = bytes[i++];
    length |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: new TextDecoder().decode(bytes.subarray(i, i + length)), end: i + length };
}

/** One `ChatEntry`: u32 seq, u8 seat, str text, u32 sentAt. */
function readEntry(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const seq = view.getUint32(offset, true);
  const seat = bytes[offset + 4];
  const { value: text, end } = readString(bytes, offset + 5);
  return { seq, seat, text, sentAt: view.getUint32(end, true), end: end + 4 };
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bytesEqual = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** A socket that collects every frame it receives, so assertions can be positional. */
function open(query, path = '/') {
  const ws = new WebSocket(`${RELAY}${path}?${query}`);
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
  // 1 tag + u32 seed + u8 mapSize + u8 aiCount + (1 length + 32) chatId.
  check(
    '...1 tag + seed + mapSize + aiCount + 32-char chatId = 40 bytes',
    hostStart?.length === 40,
    `${hostStart?.length}`,
  );
  check('...carries the host mapSize (large = tag 2)', hostStart?.[5] === 2, `got ${hostStart?.[5]}`);
  check('...carries the host aiCount', hostStart?.[6] === 1, `got ${hostStart?.[6]}`);

  const chatId = hostStart ? readString(hostStart, 7).value : '';
  check('...carries a 32-char chatId', /^[0-9a-f]{32}$/.test(chatId), chatId);

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

  await chatChecks(chatId);
}

/**
 * The chat object: a different socket to a different Durable Object, addressed by
 * the id `start` just handed both peers. Everything here is asserted on the raw
 * frame for the same reason as above — the tag numbers are the contract.
 */
async function chatChecks(chatId) {
  if (!/^[0-9a-f]{32}$/.test(chatId)) {
    check('chat checks have a chatId to use', false, 'no chatId came out of start');
    return;
  }

  const chatUrl = (seat, since) => `chat=${chatId}&seat=${seat}&v=${V}${since ? `&since=${since}` : ''}`;
  const send = (ws, text) => ws.send(new Uint8Array([ChatTag.Send, ...encodeStringPayload(text)]));

  // --- attach, history, presence -------------------------------------------
  const alice = open(chatUrl('host'), '/chat');
  await wait(400);
  check(
    'a fresh chat greets the first socket with history',
    alice.frames[0]?.[0] === ChatTag.History,
    `tag=${alice.frames[0]?.[0]}`,
  );
  check('...empty, with the peer offline', bytesEqual(alice.frames[0], new Uint8Array([ChatTag.History, 0, 0])));

  const bob = open(chatUrl('guest'), '/chat');
  await wait(400);
  check('the second socket gets its own history', bob.frames[0]?.[0] === ChatTag.History, `tag=${bob.frames[0]?.[0]}`);
  check('...with the peer marked online', bob.frames[0]?.[2] === 1, `got ${bob.frames[0]?.[2]}`);
  const presence = alice.frames[1];
  check('the first socket is told its peer arrived', presence?.[0] === ChatTag.Presence, `tag=${presence?.[0]}`);
  check('...peerOnline = true', presence?.[1] === 1, `got ${presence?.[1]}`);

  // --- a message reaches both, numbered ------------------------------------
  send(alice, 'hold the ridge');
  await wait(400);
  const aliceEcho = alice.frames.at(-1);
  const bobPost = bob.frames.at(-1);
  check('a send is broadcast to both sockets', aliceEcho?.[0] === ChatTag.Posted && bobPost?.[0] === ChatTag.Posted);
  check('...byte-identical — one message, one truth', bytesEqual(aliceEcho, bobPost));
  const first = aliceEcho ? readEntry(aliceEcho, 1) : null;
  check('...numbered from 1', first?.seq === 1, `seq=${first?.seq}`);
  check('...attributed to the sending seat (host = 0)', first?.seat === 0, `seat=${first?.seat}`);
  check('...carries the text verbatim', first?.text === 'hold the ridge', `${first?.text}`);

  send(bob, 'on my way');
  await wait(400);
  const second = readEntry(alice.frames.at(-1), 1);
  check('the next message increments the sequence', second.seq === 2, `seq=${second.seq}`);
  check('...and is attributed to the other seat (guest = 1)', second.seat === 1, `seat=${second.seat}`);

  // --- sanitizing ----------------------------------------------------------
  const before = bob.frames.length;
  send(alice, '   \n\t  ');
  await wait(300);
  check('whitespace-only is rejected, not stored', bob.frames.length === before, `+${bob.frames.length - before}`);

  send(alice, 'x'.repeat(700));
  await wait(400);
  const truncated = readEntry(bob.frames.at(-1), 1);
  check('over-length text is truncated to 500, not refused', truncated.text.length === 500, `${truncated.text.length}`);

  // --- resume: `since` returns only the gap --------------------------------
  const resumed = open(chatUrl('host', truncated.seq - 1), '/chat');
  await wait(400);
  const gap = resumed.frames[0];
  check('a resume gets history', gap?.[0] === ChatTag.History, `tag=${gap?.[0]}`);
  // A BARE list is a length varint then the items: 1 means exactly the gap.
  check('...containing only what came after `since`', gap?.[1] === 1, `${gap?.[1]} entries`);
  check('...and it is the right message', readEntry(gap, 2).seq === truncated.seq, `seq=${readEntry(gap, 2).seq}`);

  // --- rate limit ----------------------------------------------------------
  const beforeFlood = bob.frames.length;
  for (let i = 0; i < 30; i++) send(alice, `flood ${i}`);
  await wait(800);
  const delivered = bob.frames.length - beforeFlood;
  check('the rate limit stops a flood', delivered < 30, `${delivered} of 30 got through`);
  check('...without cutting the conversation off', delivered > 0, `${delivered}`);

  // --- presence flips on disconnect ----------------------------------------
  const beforeClose = bob.frames.length;
  alice.close();
  resumed.close();
  await wait(600);
  const away = bob.frames.slice(beforeClose).find((f) => f[0] === ChatTag.Presence);
  check('the survivor is told its peer went away', away?.[1] === 0, `got ${away?.[1]}`);
  bob.close();

  // --- rejections ----------------------------------------------------------
  const noId = open(`seat=host&v=${V}`, '/chat');
  await wait(400);
  check('a chat socket without an id never opens', noId.readyState !== WebSocket.OPEN, `readyState=${noId.readyState}`);
  noId.close();

  const noSeat = open(`chat=${chatId}&v=${V}`, '/chat');
  await wait(400);
  check(
    'a chat socket without a seat is rejected',
    noSeat.frames[0]?.[0] === Tag.Error,
    `tag=${noSeat.frames[0]?.[0]}`,
  );
  noSeat.close();
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
