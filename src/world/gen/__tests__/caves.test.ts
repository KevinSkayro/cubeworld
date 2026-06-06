import { describe, it, expect } from "vitest";
import { generateTerrainShape, columnHeight } from "../terrain";
import { applySurfacePass as surfacePass } from "../surface";
import {
  carveCaves,
  isCaveVoxel,
  isCavern,
  caveSurfaceMargin,
} from "../caves";
import { localIndex } from "../coords";
import { makeNoise } from "../noise";
import type { GenContext } from "../types";
import type { NoiseSampler } from "../noise";
import {
  CHUNK_VOLUME,
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_STONE,
} from "../../constants";

const SEED = 12345;
const SURFACE_MARGIN = 4;

// Carve-everywhere stub: noise3D -> 0 (tunnel fields both 0 < threshold),
// fbm2D -> terrainRaw for a known height, noise2D -> 0 (plains biome + no
// entrance region, so the normal margin applies).
function carveAllNoise(terrainRaw: number): NoiseSampler {
  return {
    noise2D: () => 0,
    noise3D: () => 0,
    fbm2D: () => terrainRaw,
    fbm3D: () => 0,
  };
}

const TERRAIN_RAW = -0.2;

describe("isCaveVoxel", () => {
  it("is deterministic", () => {
    const noise = makeNoise(SEED);
    expect(isCaveVoxel(noise, 12, 30, -30, 60, SURFACE_MARGIN)).toBe(
      isCaveVoxel(noise, 12, 30, -30, 60, SURFACE_MARGIN),
    );
  });

  it("never carves the surface margin or below the floor", () => {
    const noise = carveAllNoise(TERRAIN_RAW); // would carve everywhere allowed
    const h = columnHeight(noise, 0, 0);
    expect(isCaveVoxel(noise, 0, 0, 0, h, SURFACE_MARGIN)).toBe(false); // floor
    expect(isCaveVoxel(noise, 0, h, 0, h, SURFACE_MARGIN)).toBe(false); // surface
    expect(isCaveVoxel(noise, 0, h - 3, 0, h, SURFACE_MARGIN)).toBe(false); // margin
    expect(isCaveVoxel(noise, 0, h - 4, 0, h, SURFACE_MARGIN)).toBe(true); // first cave layer
  });
});

describe("isCavern", () => {
  // Fake field that is always "in cavern" so only the depth gate decides.
  const highNoise: NoiseSampler = {
    noise2D: () => 0,
    noise3D: () => 0.9,
    fbm2D: () => 0,
    fbm3D: () => 0,
  };

  it("only forms well below the surface (depth gate)", () => {
    expect(isCavern(highNoise, 0, 60 - 1, 0, 60)).toBe(false); // 1 below surface
    expect(isCavern(highNoise, 0, 60 - 20, 0, 60)).toBe(true); // 20 below surface
  });
});

describe("caveSurfaceMargin", () => {
  it("reduces the margin only in occasional entrance regions", () => {
    const noise = makeNoise(SEED);
    let reduced = 0;
    let total = 0;
    for (let gx = 0; gx < 80; gx++) {
      for (let gz = 0; gz < 80; gz++) {
        const m = caveSurfaceMargin(noise, gx * 8, gz * 8);
        total++;
        if (m < SURFACE_MARGIN) reduced++;
      }
    }
    expect(reduced).toBeGreaterThan(0); // entrances exist
    expect(reduced / total).toBeLessThan(0.3); // but stay occasional
  });
});

describe("carveCaves", () => {
  it("protects the surface/margin and floor, carves the stone between", () => {
    const noise = carveAllNoise(TERRAIN_RAW);
    const ctx: GenContext = { seed: 1, noise };
    const height = columnHeight(noise, 0, 0);
    const caveTop = height - SURFACE_MARGIN;

    // Surface chunk: surface + margin preserved, first layer below margin carved.
    const scy = Math.floor(height / CHUNK_SIZE);
    const surfaceBlocks = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, scy, 0, surfaceBlocks);
    surfacePass(ctx, 0, scy, 0, surfaceBlocks);
    carveCaves(ctx, 0, scy, 0, surfaceBlocks);
    const sLy = height - scy * CHUNK_SIZE;
    expect(surfaceBlocks[localIndex(0, sLy, 0)]).toBe(BLOCK_GRASS); // surface preserved
    expect(surfaceBlocks[localIndex(0, sLy - 1, 0)]).toBe(BLOCK_DIRT); // margin preserved
    expect(surfaceBlocks[localIndex(0, caveTop - scy * CHUNK_SIZE, 0)]).toBe(BLOCK_AIR); // carved

    // Floor chunk (cy=0): everything between floor and caveTop carved, y0 kept.
    const floorBlocks = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, 0, 0, floorBlocks);
    surfacePass(ctx, 0, 0, 0, floorBlocks);
    carveCaves(ctx, 0, 0, 0, floorBlocks);
    expect(floorBlocks[localIndex(0, 0, 0)]).toBe(BLOCK_STONE); // floor preserved
    expect(floorBlocks[localIndex(0, 1, 0)]).toBe(BLOCK_AIR); // carved
    expect(floorBlocks[localIndex(0, 15, 0)]).toBe(BLOCK_AIR); // carved
  });

  it("only removes blocks (solid -> air), and matches isCaveVoxel", () => {
    const ctx: GenContext = { seed: SEED, noise: makeNoise(SEED) };
    let totalCarved = 0;

    for (let cy = 0; cy <= 3; cy++) {
      for (let cx = 0; cx <= 1; cx++) {
        for (let cz = 0; cz <= 1; cz++) {
          const base = new Uint16Array(CHUNK_VOLUME);
          generateTerrainShape(ctx, cx, cy, cz, base);
          surfacePass(ctx, cx, cy, cz, base);
          const caved = base.slice();
          carveCaves(ctx, cx, cy, cz, caved);

          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
              for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const i = localIndex(lx, ly, lz);
                if (base[i] === caved[i]) continue;
                expect(base[i]).not.toBe(BLOCK_AIR);
                expect(caved[i]).toBe(BLOCK_AIR);
                totalCarved++;

                const wx = cx * CHUNK_SIZE + lx;
                const wy = cy * CHUNK_SIZE + ly;
                const wz = cz * CHUNK_SIZE + lz;
                const h = columnHeight(ctx.noise, wx, wz);
                const m = caveSurfaceMargin(ctx.noise, wx, wz);
                expect(isCaveVoxel(ctx.noise, wx, wy, wz, h, m)).toBe(true);
              }
            }
          }
        }
      }
    }

    expect(totalCarved).toBeGreaterThan(0);
  });
});
