import { describe, it, expect } from "vitest";
import { generateChunk } from "../ChunkGenerator";
import { hash3, rand01, randInt } from "../random";
import { makeNoise, FIELD } from "../noise";
import {
  chunkKey,
  parseKey,
  worldToChunk,
  worldToLocal,
  localIndex,
} from "../coords";
import { CHUNK_SIZE, CHUNK_VOLUME } from "../../constants";

const SEED = 12345;

/** FNV-1a checksum over a chunk's block buffer — a compact snapshot value. */
function checksum(arr: Uint16Array): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

describe("generateChunk determinism", () => {
  it("produces an identical buffer for the same seed and coords", () => {
    const a = generateChunk(0, 0, 0, SEED);
    const b = generateChunk(0, 0, 0, SEED);
    expect(a.length).toBe(CHUNK_VOLUME);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("is independent of generation order", () => {
    const first = generateChunk(0, 0, 0, SEED);
    // Generate other chunks in between; the original must be unaffected.
    generateChunk(5, 0, 5, SEED);
    generateChunk(-3, 1, 2, SEED);
    const again = generateChunk(0, 0, 0, SEED);
    expect(checksum(again)).toBe(checksum(first));
  });

  it("differs between distinct chunk coordinates", () => {
    const a = generateChunk(0, 0, 0, SEED);
    const b = generateChunk(10, 0, 10, SEED);
    expect(checksum(a)).not.toBe(checksum(b));
  });

  // Pins current output. If this changes, terrain generation changed — update
  // the snapshot intentionally (e.g. the M3 alea->hash swap).
  it("matches the committed output snapshot", () => {
    expect({
      "0,0,0": checksum(generateChunk(0, 0, 0, SEED)),
      "0,1,0": checksum(generateChunk(0, 1, 0, SEED)),
      "-3,0,7": checksum(generateChunk(-3, 0, 7, SEED)),
    }).toMatchSnapshot();
  });
});

describe("random.ts", () => {
  it("hash3 is deterministic and unsigned 32-bit", () => {
    const h = hash3(SEED, 12, -7, 33, 1);
    expect(h).toBe(hash3(SEED, 12, -7, 33, 1));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it("salt and coordinates change the hash", () => {
    expect(hash3(SEED, 1, 2, 3, 0)).not.toBe(hash3(SEED, 1, 2, 3, 1));
    expect(hash3(SEED, 1, 2, 3)).not.toBe(hash3(SEED, 1, 2, 4));
  });

  it("rand01 stays in [0, 1) and randInt in [0, n)", () => {
    for (let i = 0; i < 1000; i++) {
      const r = rand01(SEED, i, i * 2, i * 3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      const k = randInt(SEED, i, 0, 0, 8);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(8);
    }
  });
});

describe("noise.ts", () => {
  it("is deterministic across instances with the same seed", () => {
    const a = makeNoise(SEED);
    const b = makeNoise(SEED);
    expect(a.noise2D(1.5, -2.5)).toBe(b.noise2D(1.5, -2.5));
    expect(a.noise3D(1.5, 0.25, -2.5)).toBe(b.noise3D(1.5, 0.25, -2.5));
  });

  it("fbm with a single octave equals raw noise at base frequency", () => {
    const n = makeNoise(SEED);
    const cfg = FIELD.TERRAIN;
    const x = 40;
    const z = -17;
    expect(n.fbm2D(x, z, cfg)).toBeCloseTo(
      n.noise2D(x * cfg.frequency, z * cfg.frequency),
      12,
    );
  });
});

describe("coords.ts", () => {
  it("chunkKey/parseKey round-trip", () => {
    expect(parseKey(chunkKey(-3, 1, 7))).toEqual([-3, 1, 7]);
  });

  it("worldToChunk/worldToLocal match the engine's formulas", () => {
    // Negative coordinates must floor toward -inf and wrap locals into range.
    expect(worldToChunk(-1)).toBe(-1);
    expect(worldToLocal(-1)).toBe(CHUNK_SIZE - 1);
    expect(worldToChunk(CHUNK_SIZE)).toBe(1);
    expect(worldToLocal(CHUNK_SIZE)).toBe(0);
  });

  it("localIndex matches the chunk block-array layout", () => {
    expect(localIndex(0, 0, 0)).toBe(0);
    expect(localIndex(1, 0, 0)).toBe(1);
    expect(localIndex(0, 0, 1)).toBe(CHUNK_SIZE);
    expect(localIndex(0, 1, 0)).toBe(CHUNK_SIZE * CHUNK_SIZE);
  });
});
