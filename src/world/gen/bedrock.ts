// Stage — bedrock floor.
//
// Lays an unbreakable floor at the bottom of the world so you can't dig past the
// last level. y=0 is always bedrock (a guaranteed solid floor); y=1..2 are a
// ragged band that thins with height, for the classic chaotic bedrock look.
//
// Runs AFTER caves so it overwrites any cave air carved near the bottom — the
// floor is therefore hole-free regardless of cave generation. Deterministic
// (pure function of seed + world coords).

import { CHUNK_SIZE, BLOCK_BEDROCK } from "../constants";
import { localIndex } from "./coords";
import { hash3 } from "./random";
import type { GenContext } from "./types";

// Bedrock occupies world y 0..BEDROCK_MAX_Y.
const BEDROCK_MAX_Y = 2;
const SALT_BEDROCK = 31;

/** Whether a voxel is bedrock: y=0 always; higher layers thin out (y=1 ~1/2,
 *  y=2 ~1/3) so the top of the band is ragged. */
export function isBedrock(
  seed: number,
  worldX: number,
  worldY: number,
  worldZ: number,
): boolean {
  if (worldY < 0 || worldY > BEDROCK_MAX_Y) return false;
  if (worldY === 0) return true;
  return hash3(seed, worldX, worldY, worldZ, SALT_BEDROCK) % (worldY + 1) === 0;
}

export function applyBedrock(
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
): void {
  const chunkMinY = cy * CHUNK_SIZE;
  // Whole chunk above the bedrock band — nothing to do.
  if (chunkMinY > BEDROCK_MAX_Y) return;

  const { seed } = ctx;
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = chunkMinY + ly;
        if (worldY > BEDROCK_MAX_Y) break;
        if (isBedrock(seed, worldX, worldY, worldZ)) {
          blocks[localIndex(lx, ly, lz)] = BLOCK_BEDROCK;
        }
      }
    }
  }
}
