import { beforeEach, describe, expect, it } from 'vitest';
import { Owner } from '@drone-directive/types/enums';
import { OnlineStatus } from './enums';
import { useGameStore } from './gameStore';

/**
 * `localSide` is what every snapshot, the fog and the camera are drawn from, and
 * a guest holds `Owner.AI` for the length of the match. Every way back out of
 * online has to put it back, or the next *solo* match is watched from the bot's
 * side — the player looking at an enemy base through their own fog.
 */
describe('leaving an online session', () => {
  beforeEach(() => {
    useGameStore.setState({ localSide: Owner.Player, online: { status: OnlineStatus.Offline } });
  });

  it('seats a guest on the AI side', () => {
    useGameStore.getState().joinMatch('abcd');
    expect(useGameStore.getState().localSide).toBe(Owner.AI);
  });

  it('puts a guest back on the player side when the session goes offline', () => {
    useGameStore.getState().joinMatch('abcd');
    // What Play Again and Main Menu reach through `GameApp.leaveOnlineIfAny` —
    // the ways out that do not raise a `leave` request of their own.
    useGameStore.getState().setOnlineOffline();
    expect(useGameStore.getState().localSide).toBe(Owner.Player);
    expect(useGameStore.getState().online.status).toBe(OnlineStatus.Offline);
  });

  it('does the same for a match that ended on its own, once the lobby is dismissed', () => {
    useGameStore.getState().joinMatch('abcd');
    useGameStore.getState().setOnlineFinished('Opponent left the match', false);
    expect(useGameStore.getState().localSide).toBe(Owner.AI); // still reporting the result
    useGameStore.getState().setOnlineOffline();
    expect(useGameStore.getState().localSide).toBe(Owner.Player);
  });
});
