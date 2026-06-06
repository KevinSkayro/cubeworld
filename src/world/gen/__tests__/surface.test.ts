import { describe, it, expect } from "vitest";
import { generateTerrainShape, columnHeight } from "../terrain";
import { applySurfacePass } from "../surface";
import { localIndex } from "../coords";
import type { GenContext } from "../types";
import type { NoiseSampler } from "../noise";
import {
  CHUNK_VOLUME,
  CHUNK_SIZE,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_STONE,
  BLOCK_SAND,
  BLOCK_SNOW,
} from "../../constants";

// Controllable noise stub. Biome params read noise2D at field-specific
// x-offsets (temperature ~0, humidity ~+1000, continentalness ~-3000), so we
// route each field by the x argument. columnHeight reads fbm2D, pinned to
// terrainRaw to give a known surface height.
function fakeNoise(o: {
  tempRaw: number;
  humRaw: number;
  contRaw: number;
  terrainRaw: number;
}): NoiseSampler {
  return {
    noise2D: (x: number) => (x > 500 ? o.humRaw : x < -500 ? o.contRaw : o.tempRaw),
    noise3D: () => 0,
    fbm2D: () => o.terrainRaw,
    fbm3D: () => 0,
  };
}

const TERRAIN_RAW = -0.2;

// Generate the chunk that contains the surface for column (0,0), running
// terrain + surface. Derives the chunk/height (terrain is deep now).
function genSurfaceColumn(noise: NoiseSampler) {
  const ctx: GenContext = { seed: 1, noise };
  const height = columnHeight(noise, 0, 0);
  const cy = Math.floor(height / CHUNK_SIZE);
  const ly = height - cy * CHUNK_SIZE;
  const blocks = new Uint16Array(CHUNK_VOLUME);
  generateTerrainShape(ctx, 0, cy, 0, blocks);
  applySurfacePass(ctx, 0, cy, 0, blocks);
  return { ctx, blocks, cy, ly };
}

describe("applySurfacePass", () => {
  it("places sand surface and filler in a desert column", () => {
    // temp 0.8 (hot), humidity 0.3 (dry) -> desert
    const { blocks, ly } = genSurfaceColumn(
      fakeNoise({ tempRaw: 0.6, humRaw: -0.4, contRaw: 0, terrainRaw: TERRAIN_RAW }),
    );
    expect(ly).toBeGreaterThanOrEqual(4); // surface comfortably inside the chunk
    expect(blocks[localIndex(0, ly, 0)]).toBe(BLOCK_SAND); // surface
    expect(blocks[localIndex(0, ly - 1, 0)]).toBe(BLOCK_SAND); // filler
    expect(blocks[localIndex(0, ly - 3, 0)]).toBe(BLOCK_SAND); // filler
    expect(blocks[localIndex(0, ly - 4, 0)]).toBe(BLOCK_STONE); // below band
  });

  it("places snow surface over dirt filler in a cold column", () => {
    const { blocks, ly } = genSurfaceColumn(
      fakeNoise({ tempRaw: -0.6, humRaw: 0, contRaw: 0, terrainRaw: TERRAIN_RAW }),
    );
    expect(blocks[localIndex(0, ly, 0)]).toBe(BLOCK_SNOW); // surface
    expect(blocks[localIndex(0, ly - 1, 0)]).toBe(BLOCK_DIRT); // filler unchanged
  });

  it("leaves grass/dirt unchanged in a plains column", () => {
    const { blocks, ly } = genSurfaceColumn(
      fakeNoise({ tempRaw: 0, humRaw: 0, contRaw: 0, terrainRaw: TERRAIN_RAW }),
    );
    expect(blocks[localIndex(0, ly, 0)]).toBe(BLOCK_GRASS);
    expect(blocks[localIndex(0, ly - 1, 0)]).toBe(BLOCK_DIRT);
  });

  it("never overwrites a stone surface (preserves rocky terrain)", () => {
    const noise = fakeNoise({ tempRaw: 0.6, humRaw: -0.4, contRaw: 0, terrainRaw: TERRAIN_RAW });
    const height = columnHeight(noise, 0, 0);
    const cy = Math.floor(height / CHUNK_SIZE);
    const ly = height - cy * CHUNK_SIZE;
    const ctx: GenContext = { seed: 1, noise };
    const blocks = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, cy, 0, blocks);
    blocks[localIndex(0, ly, 0)] = BLOCK_STONE; // simulate exposed-stone surface
    applySurfacePass(ctx, 0, cy, 0, blocks);
    expect(blocks[localIndex(0, ly, 0)]).toBe(BLOCK_STONE); // stays stone
    expect(blocks[localIndex(0, ly - 1, 0)]).toBe(BLOCK_SAND); // filler still recolored
  });
});
