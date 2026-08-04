import { frame, MessageTag } from '@drone-directive/protocol';
import { encodeStartMessage, MapSize as WireMapSize } from '@drone-directive/protocol/codec';
import type { DroneControl } from '@drone-directive/types/entities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTick } from '../wire/codec';
import { LockstepSession } from './LockstepSession';
import type { LockstepHandlers, TickInput } from './types';

/**
 * What a dropped socket must *not* cost. Under lockstep neither peer advances
 * without the other's input, so a client that loses its connection has not fallen
 * behind — the only casualty is the frames that were in flight. These tests are
 * about that re-delivery: the session has to come back to the same seat and put
 * every unacknowledged tick back on the wire, or the peer stalls for good.
 */

const IDLE_DRONE: DroneControl = { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false };
const RESUME_TOKEN = 'f'.repeat(32);

/** Just enough WebSocket for the session: the events it listens for, and what it sent. */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  binaryType = '';
  readonly sent: Uint8Array[] = [];
  readonly closed: number[] = [];
  private readonly listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  send(bytes: Uint8Array): void {
    this.sent.push(bytes);
  }

  close(code: number): void {
    this.closed.push(code);
  }

  /** Drive the socket the way the browser would. */
  emit(type: string, event: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  deliver(bytes: Uint8Array): void {
    this.emit('message', { data: bytes.slice().buffer });
  }

  drop(): void {
    this.readyState = 3;
    this.emit('close');
  }
}

const startFrame = () =>
  frame(
    MessageTag.Start,
    encodeStartMessage({
      seed: 1,
      mapSize: WireMapSize.Small,
      aiCount: 0,
      chatId: 'c'.repeat(32),
      resumeToken: RESUME_TOKEN,
    }),
  );

const input = (): TickInput => ({ commands: [], drone: IDLE_DRONE, pauseToggle: false });

/** A session already in a match, with its socket open and `start` delivered. */
function startedSession(handlers: LockstepHandlers = {}) {
  const session = new LockstepSession(handlers, {
    relayUrl: 'ws://relay.test',
    limits: () => ({ worldWidth: 1000, worldHeight: 1000, maxRobots: 50 }),
  });
  session.connectGuest('AB7K');
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.deliver(startFrame());
  return { session, socket };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('resuming a dropped seat', () => {
  it('re-attaches with the seat token rather than as a new guest', () => {
    const onLinkDown = vi.fn();
    const { socket } = startedSession({ onLinkDown });

    socket.drop();
    expect(onLinkDown).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(1); // backs off first, rather than hammering

    vi.advanceTimersByTime(600);
    const retry = FakeSocket.instances[1];
    expect(retry.url).toContain(`resume=${RESUME_TOKEN}`);
    expect(retry.url).toContain('room=AB7K');
    expect(retry.url).not.toContain('create=1');
  });

  it('replays every tick the peer has not acknowledged, in order', () => {
    const onLinkUp = vi.fn();
    const { session, socket } = startedSession({ onLinkUp });

    for (const tick of [10, 11, 12]) session.scheduleLocal(tick, input());
    expect(socket.sent).toHaveLength(3);

    socket.drop();
    // Sent into a socket that is already gone: this is exactly what a resume has
    // to make good, and the frame is lost outright without one.
    session.scheduleLocal(13, input());

    vi.advanceTimersByTime(600);
    const retry = FakeSocket.instances[1];
    retry.open();

    expect(onLinkUp).toHaveBeenCalledOnce();
    expect(retry.sent).toEqual([...socket.sent, ...retry.sent.slice(3)]);
    expect(retry.sent).toHaveLength(4);
  });

  it('drops what the peer has already proved it received', () => {
    const { session, socket } = startedSession();
    for (let tick = 0; tick < 20; tick++) session.scheduleLocal(tick, input());

    // The peer could not have reached tick 15 without our input for 15 - inputDelay,
    // so its own stream is the only acknowledgement the protocol needs.
    socket.deliver(encodeTick(15, input(), null));
    socket.drop();
    vi.advanceTimersByTime(600);
    const retry = FakeSocket.instances[1];
    retry.open();

    expect(retry.sent.length).toBeLessThan(20);
    expect(retry.sent.length).toBe(20 - (15 - session.inputDelay) - 1);
  });

  it('gives up once the relay has stopped holding the seat', () => {
    const onClose = vi.fn();
    const { socket } = startedSession({ onClose });

    socket.drop();
    // Every attempt fails the way a real one does — the connect never completes and
    // the socket closes — until the relay's grace period is spent.
    for (let guard = 0; onClose.mock.calls.length === 0 && guard < 30; guard++) {
      vi.advanceTimersByTime(2_000);
      const latest = FakeSocket.instances[FakeSocket.instances.length - 1];
      if (latest.readyState === FakeSocket.CONNECTING) latest.drop();
    }

    expect(onClose).toHaveBeenCalledOnce();
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });

  it('stops retrying when the relay refuses the token', () => {
    const onError = vi.fn();
    const { socket } = startedSession({ onError });

    socket.drop();
    vi.advanceTimersByTime(600);
    const retry = FakeSocket.instances[1];
    retry.open();
    retry.deliver(
      frame(
        MessageTag.Error,
        // ErrorCode.ResumeRejected — tag 5, then an empty message string.
        Uint8Array.of(5, 0),
      ),
    );
    vi.advanceTimersByTime(30_000);

    expect(onError).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(2); // no further attempts
  });

  it('never resumes a socket that closed before the match began', () => {
    const onClose = vi.fn();
    const session = new LockstepSession(
      { onClose },
      { relayUrl: 'ws://relay.test', limits: () => ({ worldWidth: 1, worldHeight: 1, maxRobots: 1 }) },
    );
    session.connectGuest('ZZZZ');
    FakeSocket.instances[0].drop();

    expect(onClose).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('replayed peer frames', () => {
  it('ignores a tick the simulation has already consumed', () => {
    const { session, socket } = startedSession();
    const peerTick = (tick: number, pauseToggle: boolean) => socket.deliver(encodeTick(tick, { ...input(), pauseToggle }, null));

    for (let tick = 0; tick <= session.inputDelay; tick++) session.scheduleLocal(tick, input());
    peerTick(session.inputDelay, false);
    session.take(session.inputDelay);

    // The relay replays what it held for us, which can overlap what we already
    // applied; a stale tick must not settle in a buffer nothing will ever read.
    peerTick(session.inputDelay, true);
    expect(session.ready(session.inputDelay)).toBe(false);
  });
});
