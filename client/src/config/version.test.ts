import { describe, expect, it } from 'vitest';
import { evaluateManifest } from './version';
import { ClientVersion } from '../store/enums';

const local = { build: 'abc1234', protocol: 13 };

describe('evaluateManifest', () => {
  it('reports nothing when the deploy matches the running bundle', () => {
    expect(evaluateManifest({ build: 'abc1234', protocol: 13 }, local)).toBe(ClientVersion.Current);
  });

  it('reports an update when the build id moved on', () => {
    expect(evaluateManifest({ build: 'def5678', protocol: 13 }, local)).toBe(ClientVersion.UpdateAvailable);
  });

  it('blocks online play on any protocol difference, in either direction', () => {
    expect(evaluateManifest({ build: 'def5678', protocol: 14 }, local)).toBe(ClientVersion.OnlineBlocked);
    // The relay compares `!==`, so a client ahead of it is just as stuck.
    expect(evaluateManifest({ build: 'abc1234', protocol: 12 }, local)).toBe(ClientVersion.OnlineBlocked);
  });

  it('stays quiet on anything it cannot read', () => {
    // A broken deploy or a captive portal must not cost a working client its
    // multiplayer — every one of these is "no news", not "you are stale".
    for (const junk of [
      null,
      undefined,
      'nope',
      42,
      {},
      { build: 'abc1234' },
      { protocol: 13 },
      { build: '', protocol: 13 },
    ]) {
      expect(evaluateManifest(junk, local)).toBe(ClientVersion.Current);
    }
  });
});
