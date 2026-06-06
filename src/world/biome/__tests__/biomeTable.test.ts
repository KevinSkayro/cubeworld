import { describe, it, expect } from "vitest";
import { selectBiome, BIOMES } from "../biomeTable";
import { sampleBiomeParams } from "../params";
import { makeNoise } from "../../gen/noise";
import { BLOCK_GRASS, BLOCK_DIRT, BLOCK_SAND, BLOCK_SNOW } from "../../constants";

describe("selectBiome", () => {
  it("picks snowy when cold", () => {
    expect(selectBiome({ temperature: 0.1, humidity: 0.5, continentalness: 0.5 })).toBe(
      BIOMES.snowy,
    );
  });

  it("picks desert when hot and dry", () => {
    expect(selectBiome({ temperature: 0.8, humidity: 0.2, continentalness: 0.5 })).toBe(
      BIOMES.desert,
    );
  });

  it("picks plains when hot but humid (not desert)", () => {
    expect(selectBiome({ temperature: 0.8, humidity: 0.8, continentalness: 0.5 })).toBe(
      BIOMES.plains,
    );
  });

  it("picks plains for temperate conditions", () => {
    expect(selectBiome({ temperature: 0.5, humidity: 0.5, continentalness: 0.5 })).toBe(
      BIOMES.plains,
    );
  });
});

describe("biome table", () => {
  it("maps biomes to the expected surface/filler blocks", () => {
    expect(BIOMES.plains.surfaceBlock).toBe(BLOCK_GRASS);
    expect(BIOMES.plains.fillerBlock).toBe(BLOCK_DIRT);
    expect(BIOMES.desert.surfaceBlock).toBe(BLOCK_SAND);
    expect(BIOMES.desert.fillerBlock).toBe(BLOCK_SAND);
    expect(BIOMES.snowy.surfaceBlock).toBe(BLOCK_SNOW);
  });
});

describe("biome variety in the world", () => {
  it("produces all three biomes across a large area", () => {
    const noise = makeNoise(12345);
    const seen = new Set<string>();
    for (let gx = 0; gx < 60; gx++) {
      for (let gz = 0; gz < 60; gz++) {
        const biome = selectBiome(sampleBiomeParams(noise, gx * 64, gz * 64));
        seen.add(biome.id);
      }
    }
    expect(seen.has("plains")).toBe(true);
    expect(seen.has("desert")).toBe(true);
    expect(seen.has("snowy")).toBe(true);
  });
});
