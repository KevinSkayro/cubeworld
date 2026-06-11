// Stage E — caves.
//
// Two carve passes, combined (a voxel is carved if either matches):
//   • Tunnels  — "spaghetti" caves: two decorrelated 3D noise fields both near
//                zero (|A|<t && |B|<t) → winding connected tunnels.
//   • Caverns  — one low-frequency 3D field above a high threshold, gated to
//                depth → big open rooms deep underground.
//
// Every decision is a pure function of world coordinates, so caves are
// deterministic and seamless across chunk borders with no neighbour bookkeeping.
// Caves keep a solid surface margin (so they don't punch holes in the surface)
// and a thin floor — except in rare "entrance" regions where the margin is
// reduced so a cave can break through to the surface, giving occasional
// findable cave mouths.

import { CHUNK_SIZE, BLOCK_AIR } from "../constants";
import { localIndex } from "./coords";
import { columnHeight, WATER_LEVEL } from "./terrain";
import type { GenContext } from "./types";
import type { NoiseSampler } from "./noise";

// Tunnels.
const TUNNEL_FREQ = 0.04;
const TUNNEL_THRESHOLD = 0.13;
const T_OFFSET_X = 137.2;
const T_OFFSET_Y = 49.7;
const T_OFFSET_Z = 211.9;

// Caverns (low frequency = large rooms), only well below the surface.
const CAVERN_FREQ = 0.018;
const CAVERN_THRESHOLD = 0.55;
const CAVERN_MIN_DEPTH = 16;
const C_OFFSET_X = -512.4;
const C_OFFSET_Y = 91.3;
const C_OFFSET_Z = 64.8;

// Surface protection: keep this many solid blocks below the surface, and a thin
// floor at the world bottom.
const SURFACE_MARGIN = 4;
const CAVE_FLOOR = 1;

// Occasional entrances: rare columns get a reduced margin so a cave can reach
// the surface. Doubly gated (entrance region AND a cave actually present), so
// openings stay occasional rather than turning the surface to swiss cheese.
const ENTRANCE_FREQ = 0.01;
const ENTRANCE_THRESHOLD = 0.62;
const ENTRANCE_MARGIN = 0;
const E_OFFSET_X = 800.0;
const E_OFFSET_Z = -300.0;

function isTunnel(
  noise: NoiseSampler,
  worldX: number,
  worldY: number,
  worldZ: number,
): boolean {
  const a = noise.noise3D(
    worldX * TUNNEL_FREQ,
    worldY * TUNNEL_FREQ,
    worldZ * TUNNEL_FREQ,
  );
  if (Math.abs(a) >= TUNNEL_THRESHOLD) return false; // early out (most voxels)

  const b = noise.noise3D(
    worldX * TUNNEL_FREQ + T_OFFSET_X,
    worldY * TUNNEL_FREQ + T_OFFSET_Y,
    worldZ * TUNNEL_FREQ + T_OFFSET_Z,
  );
  return Math.abs(b) < TUNNEL_THRESHOLD;
}

export function isCavern(
  noise: NoiseSampler,
  worldX: number,
  worldY: number,
  worldZ: number,
  height: number,
): boolean {
  if (height - worldY < CAVERN_MIN_DEPTH) return false; // only deep down
  const c = noise.noise3D(
    worldX * CAVERN_FREQ + C_OFFSET_X,
    worldY * CAVERN_FREQ + C_OFFSET_Y,
    worldZ * CAVERN_FREQ + C_OFFSET_Z,
  );
  return c > CAVERN_THRESHOLD;
}

/**
 * Surface margin for a column: usually SURFACE_MARGIN, but reduced in rare
 * low-frequency "entrance" regions so caves can break the surface there.
 */
export function caveSurfaceMargin(
  noise: NoiseSampler,
  worldX: number,
  worldZ: number,
): number {
  const e = noise.noise2D(
    worldX * ENTRANCE_FREQ + E_OFFSET_X,
    worldZ * ENTRANCE_FREQ + E_OFFSET_Z,
  );
  return e > ENTRANCE_THRESHOLD ? ENTRANCE_MARGIN : SURFACE_MARGIN;
}

/**
 * Whether the voxel should be carved to air, given the column's surface height
 * and the column's (possibly reduced) surface margin. Pure and deterministic.
 */
export function isCaveVoxel(
  noise: NoiseSampler,
  worldX: number,
  worldY: number,
  worldZ: number,
  height: number,
  margin: number,
): boolean {
  if (worldY < CAVE_FLOOR) return false;
  if (worldY > height - margin) return false;
  return (
    isTunnel(noise, worldX, worldY, worldZ) ||
    isCavern(noise, worldX, worldY, worldZ, height)
  );
}

export function carveCaves(
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
): void {
  const { noise } = ctx;
  const chunkMinY = cy * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = cx * CHUNK_SIZE + lx;
      const worldZ = cz * CHUNK_SIZE + lz;

      const height = columnHeight(noise, worldX, worldZ);
      const margin = caveSurfaceMargin(noise, worldX, worldZ);
      const caveTop = height - margin;

      // Skip columns whose carve zone is below the floor or above this chunk.
      if (caveTop < CAVE_FLOOR || caveTop < chunkMinY) continue;

      // Near sea level, a cave could open into the side of surface water and
      // leave water touching air. Only there do we look at neighbour surfaces so
      // we can keep a solid wall between caves and water. (Terrain is smooth, so
      // a column well above sea level can't border a flooded one.)
      const checkWater = height <= WATER_LEVEL + 2;
      const hxp = checkWater ? columnHeight(noise, worldX + 1, worldZ) : 0;
      const hxn = checkWater ? columnHeight(noise, worldX - 1, worldZ) : 0;
      const hzp = checkWater ? columnHeight(noise, worldX, worldZ + 1) : 0;
      const hzn = checkWater ? columnHeight(noise, worldX, worldZ - 1) : 0;

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const worldY = chunkMinY + ly;
        if (worldY > caveTop || worldY < CAVE_FLOOR) continue;

        const index = localIndex(lx, ly, lz);
        if (blocks[index] === BLOCK_AIR) continue;

        if (!isCaveVoxel(noise, worldX, worldY, worldZ, height, margin)) continue;

        // Don't carve where water would sit in this cell or an adjacent one (a
        // neighbour column whose surface is below y is flooded at y; height <= y
        // catches a surface-breaching entrance directly under the water).
        if (
          checkWater &&
          worldY <= WATER_LEVEL &&
          (height <= worldY ||
            hxp < worldY ||
            hxn < worldY ||
            hzp < worldY ||
            hzn < worldY)
        ) {
          continue;
        }

        blocks[index] = BLOCK_AIR;
      }
    }
  }
}
