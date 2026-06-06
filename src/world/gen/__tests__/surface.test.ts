import { describe, it, expect } from "vitest";
import { generateTerrainShape } from "../terrain";
import { applySurfacePass } from "../surface";
import { localIndex } from "../coords";
import type { GenContext } from "../types";
import type { NoiseSampler } from "../noise";
import { CHUNK_VOLUME, BLOCK_GRASS, BLOCK_DIRT, BLOCK_STONE, BLOCK_SAND, BLOCK_SNOW } from "../../constants";

// A controllable noise stub. Biome params read noise2D at field-specific
// x-offsets (temperature ~0, humidity ~+1000, continentalness ~-3000), so we
// route each field by the x argument. columnHeight reads fbm2D, which we pin to
// terrainRaw to land the surface at a known height inside chunk (0,0,0).
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

// terrainRaw = -0.2 -> height = floor(12 + (-0.2)*4.4) = 11, within chunk (0,0,0).
const TERRAIN_RAW = -0.2;
const EXPECTED_HEIGHT = 11;

function genColumn(noise: NoiseSampler): Uint16Array {
  const ctx: GenContext = { seed: 1, noise };
  const blocks = new Uint16Array(CHUNK_VOLUME);
  generateTerrainShape(ctx, 0, 0, 0, blocks);
  applySurfacePass(ctx, 0, 0, 0, blocks);
  return blocks;
}

describe("applySurfacePass", () => {
  it("places sand surface and filler in a desert column", () => {
    // temp 0.8 (hot), humidity 0.3 (dry) -> desert
    const blocks = genColumn(
      fakeNoise({ tempRaw: 0.6, humRaw: -0.4, contRaw: 0, terrainRaw: TERRAIN_RAW }),
    );
    expect(blocks[localIndex(0, EXPECTED_HEIGHT, 0)]).toBe(BLOCK_SAND); // surface
    expect(blocks[localIndex(0, EXPECTED_HEIGHT - 1, 0)]).toBe(BLOCK_SAND); // filler
    expect(blocks[localIndex(0, EXPECTED_HEIGHT - 3, 0)]).toBe(BLOCK_SAND); // filler
    expect(blocks[localIndex(0, EXPECTED_HEIGHT - 4, 0)]).toBe(BLOCK_STONE); // below band
  });

  it("places snow surface over dirt filler in a cold column", () => {
    // temp 0.2 (cold) -> snowy
    const blocks = genColumn(
      fakeNoise({ tempRaw: -0.6, humRaw: 0, contRaw: 0, terrainRaw: TERRAIN_RAW }),
    );
    expect(blocks[localIndex(0, EXPECTED_HEIGHT, 0)]).toBe(BLOCK_SNOW); // surface
    expect(blocks[localIndex(0, EXPECTED_HEIGHT - 1, 0)]).toBe(BLOCK_DIRT); // filler unchanged
  });

  it("leaves grass/dirt unchanged in a plains column", () => {
    // temp 0.5, humidity 0.5 -> plains
    const blocks = genColumn(
      fakeNoise({ tempRaw: 0, humRaw: 0, contRaw: 0, terrainRaw: TERRAIN_RAW }),
    );
    expect(blocks[localIndex(0, EXPECTED_HEIGHT, 0)]).toBe(BLOCK_GRASS);
    expect(blocks[localIndex(0, EXPECTED_HEIGHT - 1, 0)]).toBe(BLOCK_DIRT);
  });

  it("never overwrites a stone surface (preserves rocky terrain)", () => {
    const noise = fakeNoise({ tempRaw: 0.6, humRaw: -0.4, contRaw: 0, terrainRaw: TERRAIN_RAW });
    const ctx: GenContext = { seed: 1, noise };
    const blocks = new Uint16Array(CHUNK_VOLUME);
    generateTerrainShape(ctx, 0, 0, 0, blocks);
    // Simulate an exposed-stone surface before the surface pass runs.
    blocks[localIndex(0, EXPECTED_HEIGHT, 0)] = BLOCK_STONE;
    applySurfacePass(ctx, 0, 0, 0, blocks);
    // Surface stone stays stone; filler dirt still becomes desert sand.
    expect(blocks[localIndex(0, EXPECTED_HEIGHT, 0)]).toBe(BLOCK_STONE);
    expect(blocks[localIndex(0, EXPECTED_HEIGHT - 1, 0)]).toBe(BLOCK_SAND);
  });
});
