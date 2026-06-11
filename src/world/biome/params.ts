// Biome environmental parameters.
//
// Smooth, large-scale fields sampled per world column: temperature, humidity,
// and continentalness (landmass). These are the inputs a future biome-selection
// step (M6) maps to concrete biomes. Each field is low-frequency (so it varies
// gradually and biome transitions are smooth) and uses a large noise-space
// offset so the three fields are decorrelated despite sharing one noise field.

import type { NoiseSampler } from "../gen/noise";

export interface BiomeParams {
  /** Hot (1) to cold (0). */
  temperature: number;
  /** Wet (1) to dry (0). */
  humidity: number;
  /** Inland/high (1) to oceanic/low (0). */
  continentalness: number;
}

// Frequencies are low so the fields span hundreds of blocks per feature.
const TEMP_FREQ = 0.0015;
const HUMIDITY_FREQ = 0.0018;
const CONTINENT_FREQ = 0.0008;

// Large constant offsets (in noise space) put each field in a distant region of
// the shared simplex field, so they are effectively independent.
const HUMIDITY_OFFSET = 1000;
const CONTINENT_OFFSET_X = -3000;
const CONTINENT_OFFSET_Z = 5000;

/** Map raw simplex noise [-1, 1] to a [0, 1] parameter. */
function unit(n: number): number {
  return (n + 1) * 0.5;
}

/** Sample just the humidity field (cheaper than the full params). */
export function sampleHumidity(
  noise: NoiseSampler,
  worldX: number,
  worldZ: number,
): number {
  return unit(
    noise.noise2D(
      worldX * HUMIDITY_FREQ + HUMIDITY_OFFSET,
      worldZ * HUMIDITY_FREQ + HUMIDITY_OFFSET,
    ),
  );
}

/** Sample the biome parameters at a world column. Pure and deterministic. */
export function sampleBiomeParams(
  noise: NoiseSampler,
  worldX: number,
  worldZ: number,
): BiomeParams {
  return {
    temperature: unit(noise.noise2D(worldX * TEMP_FREQ, worldZ * TEMP_FREQ)),
    humidity: sampleHumidity(noise, worldX, worldZ),
    continentalness: unit(
      noise.noise2D(
        worldX * CONTINENT_FREQ + CONTINENT_OFFSET_X,
        worldZ * CONTINENT_FREQ + CONTINENT_OFFSET_Z,
      ),
    ),
  };
}
