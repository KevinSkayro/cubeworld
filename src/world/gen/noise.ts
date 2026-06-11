// Seeded noise sampling for world generation.
//
// Wraps the `simplex-noise` library behind a small interface so generation
// stages request named, reusable fields instead of sprinkling raw frequencies
// inline. One Simplex instance is created per seed (deterministic via alea).

import SimplexNoise from "simplex-noise";
import alea from "alea";

/** Fractal Brownian motion parameters for layering octaves of noise. */
export interface FbmConfig {
  /** Base frequency (multiplied into the coordinate). */
  frequency: number;
  /** Number of octaves to sum. 1 = plain single-frequency noise. */
  octaves: number;
  /** Frequency multiplier per octave. */
  lacunarity: number;
  /** Amplitude multiplier per octave. */
  gain: number;
}

export interface NoiseSampler {
  /** Raw 2D simplex noise in [-1, 1]. */
  noise2D(x: number, z: number): number;
  /** Raw 3D simplex noise in [-1, 1]. */
  noise3D(x: number, y: number, z: number): number;
  /** Octave-summed 2D noise, normalized to roughly [-1, 1]. */
  fbm2D(x: number, z: number, cfg: FbmConfig): number;
  /** Octave-summed 3D noise, normalized to roughly [-1, 1]. */
  fbm3D(x: number, y: number, z: number, cfg: FbmConfig): number;
}

/**
 * Create a deterministic noise sampler for a world seed. The same seed always
 * produces the same sampler.
 */
export function makeNoise(seed: number): NoiseSampler {
  const simplex = new SimplexNoise(alea(seed.toString()));

  return {
    noise2D: (x, z) => simplex.noise2D(x, z),
    noise3D: (x, y, z) => simplex.noise3D(x, y, z),
    fbm2D(x, z, cfg) {
      let amp = 1;
      let freq = cfg.frequency;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < cfg.octaves; o++) {
        sum += amp * simplex.noise2D(x * freq, z * freq);
        norm += amp;
        amp *= cfg.gain;
        freq *= cfg.lacunarity;
      }
      return norm === 0 ? 0 : sum / norm;
    },
    fbm3D(x, y, z, cfg) {
      let amp = 1;
      let freq = cfg.frequency;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < cfg.octaves; o++) {
        sum += amp * simplex.noise3D(x * freq, y * freq, z * freq);
        norm += amp;
        amp *= cfg.gain;
        freq *= cfg.lacunarity;
      }
      return norm === 0 ? 0 : sum / norm;
    },
  };
}

/**
 * Named field configs. The frequencies mirror the values currently used in
 * `terrain.ts` so stages can migrate onto these without changing output.
 */
export const FIELD = {
  /** Low-frequency regional variation (how mountainous an area is). */
  REGION: { frequency: 0.008, octaves: 1, lacunarity: 2, gain: 0.5 },
  /** Base terrain height variation. */
  TERRAIN: { frequency: 0.03, octaves: 1, lacunarity: 2, gain: 0.5 },
  /** Exposed-stone patch placement. */
  STONE_PATCH: { frequency: 0.04, octaves: 1, lacunarity: 2, gain: 0.5 },
  /** Low-frequency lake-basin placement (large, sparse depressions). */
  LAKE: { frequency: 0.012, octaves: 2, lacunarity: 2, gain: 0.5 },
} as const satisfies Record<string, FbmConfig>;
