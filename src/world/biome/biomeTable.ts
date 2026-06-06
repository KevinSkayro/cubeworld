// Biome table and selection.
//
// Maps the smooth biome parameters (see params.ts) to a small set of discrete
// biomes. Each biome defines the surface and subsurface (filler) blocks the
// surface pass applies, plus a debug colour for the biome overlay. Selection
// uses hard thresholds on smooth parameter fields, so biome regions are large
// and coherent with clean borders.

import { BLOCK_GRASS, BLOCK_DIRT, BLOCK_SAND, BLOCK_SNOW } from "../constants";
import type { BiomeParams } from "./params";

export type BiomeId = "plains" | "desert" | "snowy";

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Block placed at the surface (y === terrain height). */
  surfaceBlock: number;
  /** Block placed in the few layers just below the surface. */
  fillerBlock: number;
  /** RGB the debug overlay uses to colour this biome's region. */
  debugColor: readonly [number, number, number];
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  plains: {
    id: "plains",
    name: "Plains",
    surfaceBlock: BLOCK_GRASS,
    fillerBlock: BLOCK_DIRT,
    debugColor: [80, 160, 60],
  },
  desert: {
    id: "desert",
    name: "Desert",
    surfaceBlock: BLOCK_SAND,
    fillerBlock: BLOCK_SAND,
    debugColor: [222, 205, 128],
  },
  snowy: {
    id: "snowy",
    name: "Snowy",
    surfaceBlock: BLOCK_SNOW,
    fillerBlock: BLOCK_DIRT,
    debugColor: [236, 238, 245],
  },
};

/**
 * Choose a biome from environmental parameters. Plains is the default;
 * cold columns become snowy, hot+dry columns become desert.
 */
export function selectBiome(params: BiomeParams): BiomeDef {
  if (params.temperature < 0.3) return BIOMES.snowy;
  if (params.temperature > 0.65 && params.humidity < 0.4) return BIOMES.desert;
  return BIOMES.plains;
}
