import { describe, it, expect } from "vitest";
import { applyWater } from "../water";
import { generateChunk } from "../ChunkGenerator";
import { columnHeight, WATER_LEVEL } from "../terrain";
import { localIndex } from "../coords";
import { makeNoise } from "../noise";
import { sampleHumidity } from "../../biome/params";
import type { GenContext } from "../types";
import {
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_WATER,
  BLOCK_DIRT,
  BLOCK_GRASS,
  BLOCK_SNOW,
} from "../../constants";

const SEED = 12345;
const ctx = (): GenContext => ({ seed: SEED, noise: makeNoise(SEED) });

// Cached world-block accessor that generates chunks on demand.
function makeWorld() {
  const cache = new Map<string, Uint16Array>();
  return (wx: number, wy: number, wz: number) => {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = `${cx},${cy},${cz}`;
    let buf = cache.get(key);
    if (!buf) {
      buf = generateChunk(cx, cy, cz, SEED);
      cache.set(key, buf);
    }
    return buf[
      localIndex(wx - cx * CHUNK_SIZE, wy - cy * CHUNK_SIZE, wz - cz * CHUNK_SIZE)
    ];
  };
}

describe("water", () => {
  it("fills a below-sea-level column up to the water level (and no higher)", () => {
    const c = ctx();
    // Find any flooded column (a humid basin or a dip) near origin.
    let found: { x: number; z: number; h: number } | null = null;
    for (let x = -200; x <= 200 && !found; x += 2) {
      for (let z = -200; z <= 200; z += 2) {
        const h = columnHeight(c.noise, x, z);
        if (h < WATER_LEVEL) {
          found = { x, z, h };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { x, z, h } = found!;
    const at = makeWorld();
    expect(at(x, h + 1, z)).toBe(BLOCK_WATER); // just above the floor
    expect(at(x, WATER_LEVEL, z)).toBe(BLOCK_WATER); // up to the surface
    expect(at(x, WATER_LEVEL + 1, z)).not.toBe(BLOCK_WATER); // not above it
    expect(at(x, h, z)).not.toBe(BLOCK_WATER); // terrain floor untouched
  });

  // The regression guard for the "water held up by nothing" bug: every water
  // voxel's horizontal neighbours must be water or solid — never open air.
  it("is always contained — no water voxel touches air horizontally", () => {
    const at = makeWorld();
    let waterVoxels = 0;
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const buf = generateChunk(cx, 3, cz, SEED); // cy=3 spans the water band
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
              if (buf[localIndex(lx, ly, lz)] !== BLOCK_WATER) continue;
              waterVoxels++;
              const wx = cx * CHUNK_SIZE + lx;
              const wy = 3 * CHUNK_SIZE + ly;
              const wz = cz * CHUNK_SIZE + lz;
              expect(at(wx + 1, wy, wz)).not.toBe(BLOCK_AIR);
              expect(at(wx - 1, wy, wz)).not.toBe(BLOCK_AIR);
              expect(at(wx, wy, wz + 1)).not.toBe(BLOCK_AIR);
              expect(at(wx, wy, wz - 1)).not.toBe(BLOCK_AIR);
            }
          }
        }
      }
    }
    expect(waterVoxels).toBeGreaterThan(0); // we actually exercised some water
  });

  it("submerged lake floors are dirt, not grass or snow", () => {
    const c = ctx();
    const at = makeWorld();
    let checked = 0;
    for (let x = -200; x <= 200 && checked < 20; x += 2) {
      for (let z = -200; z <= 200 && checked < 20; z += 2) {
        const h = columnHeight(c.noise, x, z);
        if (h >= WATER_LEVEL) continue; // dry column
        const floor = at(x, h, z);
        // The lake floor under the water is dirt — never grass or snow-topped.
        expect(floor).not.toBe(BLOCK_GRASS);
        expect(floor).not.toBe(BLOCK_SNOW);
        if (floor === BLOCK_DIRT) checked++; // (rare stone patches are allowed)
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("never places water above the water level", () => {
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const buf = generateChunk(cx, 4, cz, SEED); // cy=4 -> y64..79, all above
        expect(Array.from(buf)).not.toContain(BLOCK_WATER);
      }
    }
  });

  it("is not a global ocean — most land is dry, and dry climates stay driest", () => {
    const c = ctx();
    let total = 0;
    let belowSea = 0;
    let dryBelowSea = 0;
    let dryTotal = 0;
    for (let x = -300; x <= 300; x += 4) {
      for (let z = -300; z <= 300; z += 4) {
        total++;
        const below = columnHeight(c.noise, x, z) < WATER_LEVEL;
        if (below) belowSea++;
        if (sampleHumidity(c.noise, x, z) < 0.45) {
          dryTotal++;
          if (below) dryBelowSea++;
        }
      }
    }
    // Water covers only a minority of the world (not a global ocean).
    expect(belowSea / total).toBeLessThan(0.5);
    // Below-sea-level land is rarer under dry climates than overall (basins are
    // humidity-gated), so dry land is disproportionately dry.
    expect(dryBelowSea / dryTotal).toBeLessThan(belowSea / total + 0.01);
  });

  it("only fills air (never overwrites terrain)", () => {
    const c = ctx();
    const base = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    base.fill(3); // stone everywhere
    const before = base.slice();
    applyWater(c, 0, 3, 0, base);
    expect(Array.from(base)).toEqual(Array.from(before));
  });

  it("is deterministic", () => {
    const a = generateChunk(0, 3, 0, SEED);
    const b = generateChunk(0, 3, 0, SEED);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
