// Stage C/D — biome surface material pass.
//
// Replaces the terrain stage's generic surface (grass) and subsurface (dirt)
// blocks with biome-appropriate materials: sand in deserts, snow in cold
// regions, grass/dirt in plains. Only GRASS and DIRT are rewritten, so the
// terrain stage's stone features (stone-heavy mountains, exposed-stone patches)
// are preserved. Height-driven, so it handles columns whose surface lies in a
// different vertical chunk than the one being filled.

import { CHUNK_SIZE, BLOCK_GRASS, BLOCK_DIRT } from "../constants";
import { localIndex } from "./coords";
import { columnHeight } from "./terrain";
import { sampleBiomeParams } from "../biome/params";
import { selectBiome } from "../biome/biomeTable";
import type { GenContext } from "./types";

// Layers from the surface downward that the biome controls (surface + filler).
// Matches the terrain stage's dirt band depth.
const SURFACE_DEPTH = 3;

export function applySurfacePass(
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
): void {
  const { noise } = ctx;
  const chunkMinY = cy * CHUNK_SIZE;
  const chunkMaxY = chunkMinY + CHUNK_SIZE - 1;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;

      const height = columnHeight(noise, worldX, worldZ);

      // Skip columns whose surface band doesn't intersect this chunk.
      if (height < chunkMinY || height - SURFACE_DEPTH > chunkMaxY) continue;

      const biome = selectBiome(sampleBiomeParams(noise, worldX, worldZ));

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = chunkMinY + ly;
        if (worldY > height || worldY < height - SURFACE_DEPTH) continue;

        const index = localIndex(lx, ly, lz);
        const block = blocks[index];

        if (worldY === height) {
          // Surface block — leave stone (mountains/exposed patches) untouched.
          if (block === BLOCK_GRASS) blocks[index] = biome.surfaceBlock;
        } else if (block === BLOCK_DIRT) {
          // Subsurface filler.
          blocks[index] = biome.fillerBlock;
        }
      }
    }
  }
}
