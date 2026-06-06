// Stage F — ore placement.
//
// Replaces stone with ore in vein-like blobs. Each ore type is driven by its
// own low-amplitude 3D noise field: where the field exceeds a high threshold a
// connected blob of ore forms (a vein), rather than salt-and-pepper scatter.
// Placement is gated by depth so rarer/deeper ores (iron) sit below commoner
// shallow ores (coal), giving a depth gradient over the ~60-block underground.
//
// Runs before caves, so cave carving naturally exposes veins in cave walls.
// Only ever replaces STONE, and never within MIN_DEPTH of the surface (so ore
// doesn't show on exposed rocky surfaces). Pure of world coords ⇒ deterministic
// and seamless across chunk borders.

import { CHUNK_SIZE, BLOCK_STONE, BLOCK_COAL_ORE, BLOCK_IRON_ORE } from "../constants";
import { localIndex } from "./coords";
import { columnHeight } from "./terrain";
import type { GenContext } from "./types";
import type { NoiseSampler } from "./noise";

interface OreDef {
  name: string;
  block: number;
  /** Noise frequency (higher = smaller, tighter veins). */
  freq: number;
  /** Noise-space offset, decorrelates this ore's field from the others. */
  offset: readonly [number, number, number];
  /** Place where noise3D > threshold (higher = rarer). */
  threshold: number;
  /** Minimum blocks below the surface. */
  minDepth: number;
  /** Only place at or below this absolute world Y (Infinity = no cap). */
  maxWorldY: number;
}

// Checked in order; the first matching ore wins for a given voxel. Iron is
// listed first so it claims the deep band before coal.
export const ORES: OreDef[] = [
  {
    name: "iron",
    block: BLOCK_IRON_ORE,
    freq: 0.13,
    offset: [211.3, 17.9, 89.1],
    threshold: 0.86,
    minDepth: 8,
    maxWorldY: 30, // deep only
  },
  {
    name: "coal",
    block: BLOCK_COAL_ORE,
    freq: 0.11,
    offset: [-77.4, 143.2, -205.6],
    threshold: 0.83,
    minDepth: 4,
    maxWorldY: Infinity, // throughout the underground
  },
];

function isOreSpot(
  noise: NoiseSampler,
  worldX: number,
  worldY: number,
  worldZ: number,
  ore: OreDef,
): boolean {
  const n = noise.noise3D(
    worldX * ore.freq + ore.offset[0],
    worldY * ore.freq + ore.offset[1],
    worldZ * ore.freq + ore.offset[2],
  );
  return n > ore.threshold;
}

export function placeOres(
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

      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const index = localIndex(lx, ly, lz);
        if (blocks[index] !== BLOCK_STONE) continue; // only replace stone

        const worldY = chunkMinY + ly;
        const depth = height - worldY;

        for (const ore of ORES) {
          if (depth < ore.minDepth) continue;
          if (worldY > ore.maxWorldY) continue;
          if (isOreSpot(noise, worldX, worldY, worldZ, ore)) {
            blocks[index] = ore.block;
            break; // first matching ore wins
          }
        }
      }
    }
  }
}
