// Stage G — decorations (trees).
//
// Trees are placed deterministically on a coarse grid: each CELL×CELL area has
// at most one candidate tree, at a hash-jittered position, gated by biome and
// terrain. Because placement is a pure function of world coordinates, every
// chunk independently recomputes the same trees and stamps only the blocks that
// fall within its own bounds — so a tree whose trunk/canopy crosses a chunk
// border (horizontally or vertically) is seamless with no neighbour bookkeeping.
//
// Runs last in the pipeline (after caves) and only writes into AIR, so trees sit
// on the final surface without overwriting terrain or being carved by caves.

import {
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_WOOD,
  BLOCK_LEAVES,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_SNOW,
} from "../constants";
import { localIndex } from "./coords";
import { columnHeight, BASE_HEIGHT } from "./terrain";
import { rand01, randInt } from "./random";
import { caveSurfaceMargin, isCaveVoxel } from "./caves";
import { sampleBiomeParams } from "../biome/params";
import { selectBiome } from "../biome/biomeTable";
import type { GenContext } from "./types";

const CELL = 5; // one candidate tree per 5x5 columns
const CANOPY_RADIUS = 2; // horizontal reach of leaves (for the neighbour scan)
// Trees only grow on gentle terrain (keeps them off rocky mountains).
const TREE_MAX_HEIGHT = BASE_HEIGHT + 4;
// Lowest world Y a tree could occupy (min surface + 1); chunks fully below this
// can't contain any tree blocks.
const MIN_TREE_Y = BASE_HEIGHT - 20;

const SALT_TREE_SPAWN = 11;
const SALT_TREE_X = 12;
const SALT_TREE_Z = 13;
const SALT_TRUNK = 14;

export interface Tree {
  x: number; // trunk base world coords
  baseY: number;
  z: number;
  trunkHeight: number;
}

/** Deterministic candidate tree for a grid cell, or null if none grows there. */
export function treeAt(ctx: GenContext, cellX: number, cellZ: number): Tree | null {
  const { seed, noise } = ctx;

  const ox = randInt(seed, cellX, 0, cellZ, CELL, SALT_TREE_X);
  const oz = randInt(seed, cellX, 0, cellZ, CELL, SALT_TREE_Z);
  const x = cellX * CELL + ox;
  const z = cellZ * CELL + oz;

  const height = columnHeight(noise, x, z);
  if (height > TREE_MAX_HEIGHT) return null; // not on mountains

  const biome = selectBiome(sampleBiomeParams(noise, x, z));
  if (biome.treeDensity <= 0) return null; // e.g. desert

  if (rand01(seed, cellX, 0, cellZ, SALT_TREE_SPAWN) >= biome.treeDensity) {
    return null;
  }

  // Require solid natural ground directly beneath the trunk. The biome surface
  // must be a ground block, and a cave (entrance) must not have carved it away —
  // otherwise the tree would float over a hole.
  const ground = biome.surfaceBlock;
  if (ground !== BLOCK_GRASS && ground !== BLOCK_DIRT && ground !== BLOCK_SNOW) {
    return null;
  }
  const margin = caveSurfaceMargin(noise, x, z);
  if (isCaveVoxel(noise, x, height, z, height, margin)) return null;

  const trunkHeight = 4 + randInt(seed, x, 0, z, 3, SALT_TRUNK); // 4..6
  return { x, baseY: height + 1, z, trunkHeight };
}

export function decorate(
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

  // No tree blocks can reach a chunk entirely below the lowest possible tree.
  if (chunkMaxY < MIN_TREE_Y) return;

  // Place a tree block at a world position if it lands in this chunk and is air.
  const place = (wx: number, wy: number, wz: number, block: number) => {
    const lx = wx - chunkMinX;
    const ly = wy - chunkMinY;
    const lz = wz - chunkMinZ;
    if (lx < 0 || lx >= CHUNK_SIZE) return;
    if (ly < 0 || ly >= CHUNK_SIZE) return;
    if (lz < 0 || lz >= CHUNK_SIZE) return;
    const idx = localIndex(lx, ly, lz);
    if (blocks[idx] === BLOCK_AIR) blocks[idx] = block;
  };

  // Scan every grid cell whose tree could reach into this chunk (expanded by
  // the canopy radius), then stamp the in-bounds slice of each tree.
  const cellMinX = Math.floor((chunkMinX - CANOPY_RADIUS) / CELL);
  const cellMaxX = Math.floor((chunkMaxX + CANOPY_RADIUS) / CELL);
  const cellMinZ = Math.floor((chunkMinZ - CANOPY_RADIUS) / CELL);
  const cellMaxZ = Math.floor((chunkMaxZ + CANOPY_RADIUS) / CELL);

  for (let cellX = cellMinX; cellX <= cellMaxX; cellX++) {
    for (let cellZ = cellMinZ; cellZ <= cellMaxZ; cellZ++) {
      const tree = treeAt(ctx, cellX, cellZ);
      if (!tree) continue;
      stampTree(tree, place);
    }
  }
}

/** Write a tree's trunk and canopy via `place` (which clips to the chunk). */
export function stampTree(
  tree: Tree,
  place: (wx: number, wy: number, wz: number, block: number) => void,
): void {
  const { x, baseY, z, trunkHeight } = tree;
  const topY = baseY + trunkHeight - 1;

  // Trunk.
  for (let i = 0; i < trunkHeight; i++) {
    place(x, baseY + i, z, BLOCK_WOOD);
  }

  // Canopy: two wide layers around the top, a narrower layer, then a cap.
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -CANOPY_RADIUS; dx <= CANOPY_RADIUS; dx++) {
      for (let dz = -CANOPY_RADIUS; dz <= CANOPY_RADIUS; dz++) {
        // Trim the 4 far corners for a rounder shape.
        if (Math.abs(dx) === CANOPY_RADIUS && Math.abs(dz) === CANOPY_RADIUS) continue;
        place(x + dx, topY + dy, z + dz, BLOCK_LEAVES);
      }
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      place(x + dx, topY + 1, z + dz, BLOCK_LEAVES);
    }
  }
  // Cap (center + 4 orthogonal).
  place(x, topY + 2, z, BLOCK_LEAVES);
  place(x + 1, topY + 2, z, BLOCK_LEAVES);
  place(x - 1, topY + 2, z, BLOCK_LEAVES);
  place(x, topY + 2, z + 1, BLOCK_LEAVES);
  place(x, topY + 2, z - 1, BLOCK_LEAVES);
}
