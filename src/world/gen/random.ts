// Deterministic, allocation-free hashing and RNG for world generation.
//
// Every random decision in generation should derive from (seed, coordinates,
// salt) through these helpers — never from Math.random or per-call PRNG
// allocation. Given the same inputs, results are bit-for-bit identical and
// independent of generation order.

/**
 * 32-bit integer hash of (seed, x, y, z, salt). Returns an unsigned 32-bit int.
 *
 * Inputs are coerced to 32-bit integers; coordinates may be negative. The
 * mixing constants are the standard xxHash/Murmur finalizer primes. This is a
 * cheap replacement for constructing a seeded PRNG per block.
 */
export function hash3(
  seed: number,
  x: number,
  y: number,
  z: number,
  salt = 0,
): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (salt | 0), 0x27d4eb2d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Deterministic float in [0, 1) from (seed, coords, salt). */
export function rand01(
  seed: number,
  x: number,
  y: number,
  z: number,
  salt = 0,
): number {
  return hash3(seed, x, y, z, salt) / 4294967296;
}

/** Deterministic integer in [0, n) from (seed, coords, salt). */
export function randInt(
  seed: number,
  x: number,
  y: number,
  z: number,
  n: number,
  salt = 0,
): number {
  return hash3(seed, x, y, z, salt) % n;
}
