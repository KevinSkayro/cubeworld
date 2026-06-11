// Stage H — structures.
//
// Structures are the first generation feature that a single chunk can't decide
// on its own: a structure has ONE origin but spans many blocks, often crossing
// chunk borders both horizontally and vertically. This module is the placement +
// stamping scaffold; it ships one trivial placeholder (a stone watchtower) to
// prove the framework end-to-end. Real structures are added later by registering
// more StructureDefs.
//
// Placement is region-seeded: the world is tiled into REGION_SIZE-block regions,
// and each region hash-seeds AT MOST ONE candidate structure (coarser than the
// tree grid, so structures are rare). Like trees, every decision is a pure
// function of (seed, region coords), so each chunk independently recomputes the
// structures of every region that could reach into it and stamps only the slice
// that lands in its own bounds — seamless across chunk borders (X/Z AND vertical)
// with no neighbour bookkeeping.
//
// Unlike trees (which only fill AIR), structures OVERWRITE terrain in their
// footprint so they sit flush, and they run LAST in the pipeline so caves don't
// carve them and they cleanly replace any vegetation underneath.

import {
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_STONE,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_SNOW,
} from "../constants";
import { localIndex } from "./coords";
import { columnHeight, BASE_HEIGHT, WATER_LEVEL } from "./terrain";
import { rand01, randInt } from "./random";
import { caveSurfaceMargin, isCaveVoxel } from "./caves";
import { sampleBiomeParams } from "../biome/params";
import { selectBiome } from "../biome/biomeTable";
import type { GenContext } from "./types";

// One candidate structure per REGION_SIZE x REGION_SIZE columns. Larger = rarer.
const REGION_SIZE = 96;
// Chance a region's candidate structure spawns (before terrain suitability
// gating), so structures stay occasional/findable rather than everywhere. Tuned
// low: at ~10% of 96-block regions, towers sit roughly ~300 blocks apart.
const STRUCTURE_CHANCE = 0.1;
// Structures only sit on gentle ground (same ceiling as trees) so they don't
// float off the side of, or bury into, a mountain.
const MAX_GROUND_HEIGHT = BASE_HEIGHT + 4;

// Vertical band any structure block can occupy, used to early-out whole chunks.
// Lowest = the lowest possible surface (origin sits on it); highest = the
// tallest structure's roof above the highest allowed surface.
const MIN_STRUCT_Y = BASE_HEIGHT - 8;
const MAX_STRUCT_Y = MAX_GROUND_HEIGHT + 16;

const SALT_STRUCT_SPAWN = 21;
const SALT_STRUCT_X = 22;
const SALT_STRUCT_Z = 23;
const SALT_STRUCT_KIND = 24;

/** Writes a single block at a world position (clipped to the current chunk). */
type Place = (wx: number, wy: number, wz: number, block: number) => void;

export interface StructureDef {
  id: string;
  /** Horizontal half-extent (blocks from origin) of the footprint, for the
   *  region scan that decides which regions can reach into a chunk. */
  halfExtent: number;
  /** Emit the structure's blocks relative to its origin via `place`. */
  stamp: (originX: number, originY: number, originZ: number, place: Place) => void;
}

export interface Structure {
  def: StructureDef;
  /** Origin world coordinates. originY is the terrain surface height. */
  x: number;
  y: number;
  z: number;
}

/**
 * Placeholder structure: a 3x3 hollow stone watchtower. Tall (8) and wide (3)
 * enough to straddle both horizontal and vertical chunk seams, so it exercises
 * the hard cases. Built entirely from existing blocks (no new art): all stone.
 * Layout, bottom to top:
 *   - foundation: solid 3x3 at the surface
 *   - walls (5 layers): corner posts run full height; the centre of each of the
 *     4 walls is an open 2-high doorway, then solid above
 *   - roof: 3x3 with an open hole in the centre
 *   - crown: a stone block on each of the 4 roof corners
 * The interior is cleared to AIR so a tree that happened to grow on the
 * footprint can't survive inside the tower.
 */
const WATCHTOWER: StructureDef = {
  id: "watchtower",
  halfExtent: 1, // 3x3 footprint
  stamp(x, y, z, place) {
    // Foundation: solid 3x3 at the surface layer (overwrites the surface block).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        place(x + dx, y, z + dz, BLOCK_STONE);
      }
    }
    // Walls: 5 layers. Corners (manhattan 2) are full-height posts; wall centres
    // (manhattan 1) are open 2-high doorways then solid above; interior
    // (manhattan 0) stays air.
    for (let h = 1; h <= 5; h++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const manhattan = Math.abs(dx) + Math.abs(dz);
          let block = BLOCK_AIR;
          if (manhattan === 2) {
            block = BLOCK_STONE; // corner post
          } else if (manhattan === 1) {
            block = h <= 2 ? BLOCK_AIR : BLOCK_STONE; // doorway (2 high) then wall
          }
          place(x + dx, y + h, z + dz, block);
        }
      }
    }
    // Roof: 3x3 stone with an open hole in the centre.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const isCentre = dx === 0 && dz === 0;
        place(x + dx, y + 6, z + dz, isCentre ? BLOCK_AIR : BLOCK_STONE);
      }
    }
    // Crown: a stone block on each of the 4 roof corners.
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        place(x + dx, y + 7, z + dz, BLOCK_STONE);
      }
    }
  },
};

/** The structure registry. Add new StructureDefs here. */
export const STRUCTURES: StructureDef[] = [WATCHTOWER];

const MAX_HALF_EXTENT = STRUCTURES.reduce((m, s) => Math.max(m, s.halfExtent), 0);

/**
 * Deterministic candidate structure for a region, or null if none spawns there.
 * Pure function of (seed, region coords): every chunk that the structure reaches
 * recomputes the identical result.
 */
export function structureAt(
  ctx: GenContext,
  regionX: number,
  regionZ: number,
): Structure | null {
  const { seed, noise } = ctx;

  if (rand01(seed, regionX, 0, regionZ, SALT_STRUCT_SPAWN) >= STRUCTURE_CHANCE) {
    return null;
  }

  const ox = randInt(seed, regionX, 0, regionZ, REGION_SIZE, SALT_STRUCT_X);
  const oz = randInt(seed, regionX, 0, regionZ, REGION_SIZE, SALT_STRUCT_Z);
  const x = regionX * REGION_SIZE + ox;
  const z = regionZ * REGION_SIZE + oz;

  const height = columnHeight(noise, x, z);
  if (height > MAX_GROUND_HEIGHT) return null; // gentle ground only
  if (height < WATER_LEVEL) return null; // not in (flooded) lake basins

  // Real ground beneath (not exposed mountain stone or desert sand), and not
  // over a cave mouth — so the structure never floats.
  const ground = selectBiome(sampleBiomeParams(noise, x, z)).surfaceBlock;
  if (ground !== BLOCK_GRASS && ground !== BLOCK_DIRT && ground !== BLOCK_SNOW) {
    return null;
  }
  const margin = caveSurfaceMargin(noise, x, z);
  // Reject if the surface OR the block directly beneath the foundation is carved
  // away by a cave — otherwise the tower would float over the hole.
  if (isCaveVoxel(noise, x, height, z, height, margin)) return null;
  if (isCaveVoxel(noise, x, height - 1, z, height, margin)) return null;

  const def = STRUCTURES[randInt(seed, regionX, 0, regionZ, STRUCTURES.length, SALT_STRUCT_KIND)];
  return { def, x, y: height, z };
}

/** Stamp a structure's blocks via `place` (which clips to the chunk). */
export function stampStructure(structure: Structure, place: Place): void {
  structure.def.stamp(structure.x, structure.y, structure.z, place);
}

export function placeStructures(
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
): void {
  const chunkMinX = cx * CHUNK_SIZE;
  const chunkMinY = cy * CHUNK_SIZE;
  const chunkMinZ = cz * CHUNK_SIZE;
  const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
  const chunkMaxY = chunkMinY + CHUNK_SIZE - 1;
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;

  // No structure block can reach a chunk entirely outside the structure band.
  if (chunkMaxY < MIN_STRUCT_Y || chunkMinY > MAX_STRUCT_Y) return;

  // Overwrite semantics: structures replace whatever terrain/vegetation is in
  // their footprint so they sit flush (unlike trees, which only fill air).
  const place: Place = (wx, wy, wz, block) => {
    const lx = wx - chunkMinX;
    const ly = wy - chunkMinY;
    const lz = wz - chunkMinZ;
    if (lx < 0 || lx >= CHUNK_SIZE) return;
    if (ly < 0 || ly >= CHUNK_SIZE) return;
    if (lz < 0 || lz >= CHUNK_SIZE) return;
    blocks[localIndex(lx, ly, lz)] = block;
  };

  // Every region whose structure footprint could reach into this chunk.
  const regMinX = Math.floor((chunkMinX - MAX_HALF_EXTENT) / REGION_SIZE);
  const regMaxX = Math.floor((chunkMaxX + MAX_HALF_EXTENT) / REGION_SIZE);
  const regMinZ = Math.floor((chunkMinZ - MAX_HALF_EXTENT) / REGION_SIZE);
  const regMaxZ = Math.floor((chunkMaxZ + MAX_HALF_EXTENT) / REGION_SIZE);

  for (let regionX = regMinX; regionX <= regMaxX; regionX++) {
    for (let regionZ = regMinZ; regionZ <= regMaxZ; regionZ++) {
      const structure = structureAt(ctx, regionX, regionZ);
      if (structure) stampStructure(structure, place);
    }
  }
}
