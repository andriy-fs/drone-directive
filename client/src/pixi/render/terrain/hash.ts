/**
 * The renderer's **only** source of randomness.
 *
 * Terrain decoration needs variety — which ridge decal, which way a scrap pile
 * faces, where a decal lands — and it must be identical on every peer, because two
 * players comparing screenshots of the same seed should see the same battlefield.
 *
 * The obvious way to get that is the engine's seeded `Rng`, and it is the one thing
 * that must not be used: that generator's stream *is* the simulation, so a renderer
 * drawing one extra decal would advance it and desync the lockstep match. Worse, it
 * would do so only on the client that drew the decal, which is the hardest class of
 * bug to find.
 *
 * A pure hash sidesteps the whole problem. It is stateless, so nothing can consume
 * it "out of order"; it depends only on coordinates, so the same tile always looks
 * the same; and it touches no simulation state at all.
 */

/**
 * Integer hash of two coordinates plus a salt, → uint32.
 *
 * A finalizer-style avalanche mix (the tail of MurmurHash3). Cheap, and — unlike
 * multiplying coordinates together — it decorrelates neighbours, which matters here
 * because the callers walk the grid in order and would otherwise get visible
 * diagonal banding in whatever they place.
 */
export function hash2(x: number, y: number, salt: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Same hash mapped to `[0, 1)`. */
export function hashUnit(x: number, y: number, salt: number): number {
  return hash2(x, y, salt) / 0x100000000;
}

/** Same hash mapped to an integer in `[0, n)`. `n <= 0` yields 0. */
export function hashInt(x: number, y: number, salt: number, n: number): number {
  return n > 0 ? hash2(x, y, salt) % n : 0;
}

/** Same hash mapped to `[min, max)`. */
export function hashRange(x: number, y: number, salt: number, min: number, max: number): number {
  return min + hashUnit(x, y, salt) * (max - min);
}
