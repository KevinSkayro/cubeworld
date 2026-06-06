// Stage A — base terrain shape.
//
// Produces the heightmapped surface (grass/dirt/stone) plus "stone-heavy
// mountain" clusters and rare exposed-stone patches. The heightmap is driven by
// the shared noise sampler at the same frequencies as before; all per-column
// and per-block randomness is derived deterministically from the seed and world
// coordinates via the hash helpers (replacing per-block PRNG allocation).

import {
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_STONE,
} from "../constants";
import { FIELD } from "./noise";
import type { NoiseSampler } from "./noise";
import { rand01, randInt } from "./random";
import { localIndex } from "./coords";
import type { GenContext } from "./types";

// Each independent random decision draws from its own hash stream (distinct
// salt) so decisions for the same column/block don't collide.
const SALT_STONE_HEAVY = 1;
const SALT_STONE_PCT = 2;
const SALT_SPREAD_CHANCE = 3;
const SALT_SPREAD_PCT = 4;
const SALT_BLOCK_STONE = 5;

// Base surface height (≈ sea level). Higher than the old shallow value of 12 so
// there is a deep underground for caves and an ore depth gradient. Exported so
// caves/ores can reason about depth.
export const BASE_HEIGHT = 60;

// Terrain ruggedness. Most of the world is gentle (FLAT_AMPLITUDE); rugged
// mountains only ramp in where the low-frequency region noise is high, gated by
// a smoothstep so they stay confined to a minority of the map with smooth
// foothill transitions. Mountain peaks stay under the render ceiling (~y79).
const FLAT_AMPLITUDE = 2;
const MOUNTAIN_AMPLITUDE = 16;
const MOUNTAIN_START = 0.55; // region values below this are fully flat
const MOUNTAIN_FULL = 0.85; // region values at/above this are full mountains

// Surface stone (stone-heavy clusters + exposed patches) only appears on
// genuinely elevated/rocky terrain — not flat grassland. Relative to
// BASE_HEIGHT so it tracks the actual terrain, not a stale absolute y.
const HILL_HEIGHT = BASE_HEIGHT + 6;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Terrain surface height for a world column. Single source of truth shared by
 * the terrain stage and the surface pass. The region noise selects ruggedness:
 * flat (gentle rolling) almost everywhere, ramping to rugged mountains only in
 * the rare high-region areas. Heights land ≈ y44–76 (under the render ceiling).
 */
export function columnHeight(
  noise: NoiseSampler,
  worldX: number,
  worldZ: number,
): number {
  const region = (noise.fbm2D(worldX, worldZ, FIELD.REGION) + 1) * 0.5; // 0..1
  const mountainFactor = smoothstep(MOUNTAIN_START, MOUNTAIN_FULL, region);
  const amplitude =
    FLAT_AMPLITUDE + mountainFactor * (MOUNTAIN_AMPLITUDE - FLAT_AMPLITUDE);
  const noiseValue = noise.fbm2D(worldX, worldZ, FIELD.TERRAIN);
  return Math.floor(BASE_HEIGHT + noiseValue * amplitude);
}

export function generateTerrainShape(
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
): void {
  const { seed, noise } = ctx;

  // First pass: identify original stone-heavy columns (and their stone %).
  const stoneHeavyData: Map<
    string,
    { percentage: number; height: number; isOriginal: boolean }
  > = new Map();
  const spreadStoneData: Map<string, { percentage: number }> = new Map();

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;

      const height = columnHeight(noise, worldX, worldZ);
      const isElevated = height > HILL_HEIGHT;

      // 1 in 20 chance that elevated terrain is 80-95% stone (stone-heavy mountains).
      const isStoneHeavyMountain =
        isElevated &&
        randInt(seed, worldX, worldZ, 0, 20, SALT_STONE_HEAVY) === 0;

      if (isStoneHeavyMountain) {
        const stonePercentage =
          0.8 + rand01(seed, worldX, worldZ, 0, SALT_STONE_PCT) * 0.15; // 0.80-0.95
        stoneHeavyData.set(`${lx},${lz}`, {
          percentage: stonePercentage,
          height,
          isOriginal: true,
        });
      }
    }
  }

  // Second pass: generate blocks with horizontal stone spreading.
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;

      const height = columnHeight(noise, worldX, worldZ);
      const mountainFactor = (noise.fbm2D(worldX, worldZ, FIELD.REGION) + 1) * 0.5;

      // Larger stone patches (lower frequency = larger patches).
      const stonePatchNoise = noise.fbm2D(worldX, worldZ, FIELD.STONE_PATCH);
      const stonePatchValue = (stonePatchNoise + 1) * 0.5; // 0 to 1

      // Is this column an original stone-heavy column?
      const currentKey = `${lx},${lz}`;
      const stoneHeavyInfo = stoneHeavyData.get(currentKey);
      const isStoneHeavyMountain = !!stoneHeavyInfo && stoneHeavyInfo.isOriginal;
      let stonePercentage = stoneHeavyInfo?.percentage || 0;

      // Already-spread stone cannot spread further.
      const spreadInfo = spreadStoneData.get(currentKey);
      if (spreadInfo) {
        stonePercentage = spreadInfo.percentage;
      }

      // Only ORIGINAL stone-heavy neighbours can spread stone into this column.
      const neighbors: Array<[number, number]> = [
        [lx - 1, lz],
        [lx + 1, lz],
        [lx, lz - 1],
        [lx, lz + 1],
      ];

      let hasOriginalStoneHeavyNeighbor = false;
      let neighborStonePercentage = 0;

      for (const [nx, nz] of neighbors) {
        if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
          const neighborInfo = stoneHeavyData.get(`${nx},${nz}`);
          if (neighborInfo && neighborInfo.isOriginal) {
            hasOriginalStoneHeavyNeighbor = true;
            neighborStonePercentage = neighborInfo.percentage;
            break; // Use first found neighbour.
          }
        }
      }

      // Spread once only (keeps clusters tight); spread stone can't spread further.
      if (
        hasOriginalStoneHeavyNeighbor &&
        !isStoneHeavyMountain &&
        !spreadInfo &&
        height > HILL_HEIGHT
      ) {
        const spreadChance = rand01(seed, worldX, worldZ, 0, SALT_SPREAD_CHANCE);
        // 10% chance to keep spread very close to the cluster.
        if (spreadChance < 0.1) {
          // 40-60% of the neighbour's stone percentage.
          const spreadPercentage =
            neighborStonePercentage *
            (0.4 + rand01(seed, worldX, worldZ, 0, SALT_SPREAD_PCT) * 0.2);
          stonePercentage = spreadPercentage;
          spreadStoneData.set(currentKey, { percentage: spreadPercentage });
        }
      }

      // Much rarer exposed-stone patches, only on elevated/steep terrain.
      const isElevated = height > HILL_HEIGHT;
      const isRareStonePatch = stonePatchValue > 0.96 && isElevated;

      const isSteepSlope = mountainFactor > 0.7;
      const isRareLowStonePatch = stonePatchValue > 0.98 && isSteepSlope;

      const shouldExposeStone = isRareStonePatch || isRareLowStonePatch;
      const hasStoneContent = stonePercentage > 0;

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = cy * CHUNK_SIZE + ly;
        const index = localIndex(lx, ly, lz);

        if (worldY > height) {
          blocks[index] = BLOCK_AIR;
        } else {
          // For stone-bearing columns, decide per block whether it is stone.
          let shouldBeStone = false;
          if (hasStoneContent) {
            const randomValue = rand01(
              seed,
              worldX,
              worldY,
              worldZ,
              SALT_BLOCK_STONE,
            );
            shouldBeStone = randomValue < stonePercentage;
          }

          if (worldY === height) {
            // Surface layer.
            if (hasStoneContent && shouldBeStone) {
              blocks[index] = BLOCK_STONE;
            } else if (shouldExposeStone) {
              blocks[index] = BLOCK_STONE;
            } else {
              blocks[index] = BLOCK_GRASS;
            }
          } else if (worldY >= height - 3) {
            // Top 3 dirt layers below the surface.
            if (hasStoneContent && shouldBeStone) {
              blocks[index] = BLOCK_STONE;
            } else if (shouldExposeStone) {
              blocks[index] = BLOCK_STONE;
            } else {
              blocks[index] = BLOCK_DIRT;
            }
          } else {
            // Deep underground is always stone.
            blocks[index] = BLOCK_STONE;
          }
        }
      }
    }
  }
}
