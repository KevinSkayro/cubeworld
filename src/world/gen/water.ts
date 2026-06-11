// Stage — water.
//
// Floods every below-sea-level column (height < WATER_LEVEL) up to WATER_LEVEL.
// Filling ALL sub-sea columns is what keeps water contained: a water voxel's
// horizontal neighbour is then always either water (the neighbour is also below
// sea level, so it's filled too) or solid terrain (the neighbour is above sea
// level) — never open air, so there are no water walls held up by nothing.
//
// The *climate* gate lives upstream: `columnHeight` only carves lake basins in
// humid lowlands (see terrain.ts), so dry/desert flats never dip below sea level
// and stay dry. This stage just fills whatever is below the line.
//
// Runs after caves/bedrock (water only fills air above the surface, so it never
// interferes with carving) and before decorations (trees/structures gate
// themselves off underwater columns).

import { CHUNK_SIZE, BLOCK_AIR, BLOCK_WATER } from "../constants";
import { localIndex } from "./coords";
import { columnHeight, WATER_LEVEL } from "./terrain";
import type { GenContext } from "./types";

export function applyWater(
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
): void {
  const chunkMinY = cy * CHUNK_SIZE;
  // Whole chunk above the water surface — nothing to fill.
  if (chunkMinY > WATER_LEVEL) return;

  const { noise } = ctx;
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;

      const height = columnHeight(noise, worldX, worldZ);
      if (height >= WATER_LEVEL) continue; // at/above sea level → dry

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = chunkMinY + ly;
        if (worldY <= height) continue; // inside terrain
        if (worldY > WATER_LEVEL) break; // above the water surface
        const idx = localIndex(lx, ly, lz);
        if (blocks[idx] === BLOCK_AIR) blocks[idx] = BLOCK_WATER;
      }
    }
  }
}
