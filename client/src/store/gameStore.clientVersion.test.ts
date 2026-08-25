import { beforeEach, describe, expect, it } from 'vitest';
import { ClientVersion } from './enums';
import { useGameStore } from './gameStore';

/**
 * `reportClientVersion` has two callers that can fire in either order — the
 * manifest check on the title screen and the relay's own rejection mid-connect —
 * so the only thing keeping the block from being undone by a stale answer is that
 * the field escalates and never descends.
 */
describe('reportClientVersion', () => {
  beforeEach(() => {
    useGameStore.setState({ clientVersion: ClientVersion.Current });
  });

  it('escalates', () => {
    useGameStore.getState().reportClientVersion(ClientVersion.UpdateAvailable);
    expect(useGameStore.getState().clientVersion).toBe(ClientVersion.UpdateAvailable);
    useGameStore.getState().reportClientVersion(ClientVersion.OnlineBlocked);
    expect(useGameStore.getState().clientVersion).toBe(ClientVersion.OnlineBlocked);
  });

  it('never descends — a later manifest cannot lift a protocol block', () => {
    useGameStore.getState().reportClientVersion(ClientVersion.OnlineBlocked);
    useGameStore.getState().reportClientVersion(ClientVersion.UpdateAvailable);
    useGameStore.getState().reportClientVersion(ClientVersion.Current);
    expect(useGameStore.getState().clientVersion).toBe(ClientVersion.OnlineBlocked);
  });

  it('leaves the object alone when nothing changed, so subscribers do not wake', () => {
    const before = useGameStore.getState().clientVersion;
    useGameStore.getState().reportClientVersion(ClientVersion.Current);
    expect(useGameStore.getState().clientVersion).toBe(before);
  });
});
