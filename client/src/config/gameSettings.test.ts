import { describe, expect, it } from 'vitest';
import { MapSize } from '@drone-directive/types/enums';
import { createDefaultSettings, onlineMatchSettings } from './gameSettings';

/**
 * The room's numbers are the match's, not the player's. Play Again after a 1v1
 * used to rebuild the world from `aiOpponents: 0` — a solo roster of one side,
 * decided on its first tick, so the outcome screen came straight back up.
 */
describe('onlineMatchSettings', () => {
  it('lays the room over the player settings', () => {
    const mine = createDefaultSettings();
    const match = onlineMatchSettings(mine, { mapSize: MapSize.Large, aiOpponents: 0 });
    expect(match.match).toMatchObject({ mapSize: MapSize.Large, aiOpponents: 0, online: true });
    expect(match.base).toEqual(mine.base);
  });

  it('leaves the player settings untouched, so the next solo match is still theirs', () => {
    const mine = createDefaultSettings();
    mine.match.mapSize = MapSize.Small;
    mine.match.aiOpponents = 3;
    const before = structuredClone(mine);

    onlineMatchSettings(mine, { mapSize: MapSize.Large, aiOpponents: 0 });

    expect(mine).toEqual(before);
    expect(mine.match.online).toBe(false);
  });
});
