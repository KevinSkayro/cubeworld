import { describe, it, expect } from "vitest";
import { generateTerrainShape, columnHeight } from "../terrain";
import { applySurfacePass } from "../surface";
import { placeOres } from "../ores";
import { localIndex } from "../coords";
import { makeNoise } from "../noise";
import type { GenContext } from "../types";
import type { NoiseSampler } from "../noise";
import {
  CHUNK_VOLUME,
  CHUNK_SIZE,
  BLOCK_STONE,
  BLOCK_GRASS,
  BLOCK_COAL_ORE,
  BLOCK_IRON_ORE,
} from "../../constants";

const SEED = 12345;
const IRON_MAX_Y = 30;
const MIN_ORE_DEPTH = 4;

// All-ore stub: noise3D -> 0.95 (above every ore threshold), fbm2D -> terrainRaw
// for a known height, noise2D -> 0 (plains).
function oreNoise(terrainRaw: number): NoiseSampler {
  return {
    noise2D: () => 0,
    noise3D: () => 0.95,
    fbm2D: () => terrainRaw,
    fbm3D: () => 0,
  };
}

describe("placeOres (gates, with forced noise)", () => {
  const noise = oreNoise(-0.2); // flat -> height 59
  const ctx: GenContext = { seed: 1, noise };

  it("fills the deep band with iron (iron wins where eligible)", () => {
    const deep = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, 0, 0, deep); // cy=0 -> y0..15, all stone
    placeOres(ctx, 0, 0, 0, deep);
    expect(deep[localIndex(0, 5, 0)]).toBe(BLOCK_IRON_ORE); // y5 <= 30, deep
  });

  it("uses coal above the iron depth cap", () => {
    const mid = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, 2, 0, mid); // cy=2 -> y32..47 (> IRON_MAX_Y)
    placeOres(ctx, 0, 2, 0, mid);
    expect(mid[localIndex(0, 8, 0)]).toBe(BLOCK_COAL_ORE); // y40 -> coal only
  });

  it("never replaces non-stone (surface stays grass)", () => {
    const surf = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, 3, 0, surf); // cy=3 contains the surface (y59)
    placeOres(ctx, 0, 3, 0, surf);
    expect(surf[localIndex(0, 59 - 48, 0)]).toBe(BLOCK_GRASS);
  });
});

describe("placeOres (real noise)", () => {
  it("only replaces stone, respects depth/iron gates, and is coal-heavy", () => {
    const ctx: GenContext = { seed: SEED, noise: makeNoise(SEED) };
    let coal = 0;
    let iron = 0;

    for (let cy = 0; cy <= 3; cy++) {
      for (let cx = 0; cx <= 1; cx++) {
        for (let cz = 0; cz <= 1; cz++) {
          const base = new Uint16Array(CHUNK_VOLUME);
          generateTerrainShape(ctx, cx, cy, cz, base);
          applySurfacePass(ctx, cx, cy, cz, base);
          const withOres = base.slice();
          placeOres(ctx, cx, cy, cz, withOres);

          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
              for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const i = localIndex(lx, ly, lz);
                if (base[i] === withOres[i]) continue;

                expect(base[i]).toBe(BLOCK_STONE); // only stone is replaced
                const block = withOres[i];
                expect([BLOCK_COAL_ORE, BLOCK_IRON_ORE]).toContain(block);

                const wx = cx * CHUNK_SIZE + lx;
                const wy = cy * CHUNK_SIZE + ly;
                const wz = cz * CHUNK_SIZE + lz;
                const depth = columnHeight(ctx.noise, wx, wz) - wy;
                expect(depth).toBeGreaterThanOrEqual(MIN_ORE_DEPTH);

                if (block === BLOCK_IRON_ORE) {
                  expect(wy).toBeLessThanOrEqual(IRON_MAX_Y);
                  iron++;
                } else {
                  coal++;
                }
              }
            }
          }
        }
      }
    }

    expect(coal).toBeGreaterThan(0);
    expect(iron).toBeGreaterThan(0);
    expect(coal).toBeGreaterThan(iron); // coal is the common ore
  });

  it("is deterministic", () => {
    const a = new Uint16Array(CHUNK_VOLUME);
    const b = new Uint16Array(CHUNK_VOLUME);
    const ctxA: GenContext = { seed: SEED, noise: makeNoise(SEED) };
    const ctxB: GenContext = { seed: SEED, noise: makeNoise(SEED) };
    for (const [ctx, buf] of [[ctxA, a], [ctxB, b]] as const) {
      generateTerrainShape(ctx, 0, 0, 0, buf);
      placeOres(ctx, 0, 0, 0, buf);
    }
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
