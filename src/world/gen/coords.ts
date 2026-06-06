// Chunk and block coordinate helpers.
//
// Centralizes the string-key and world<->chunk<->local conversions that are
// currently duplicated across World, ChunkManager, and Game. Formulas match
// the existing implementations exactly (see World.getBlock and Chunk.getBlock).

import { CHUNK_SIZE } from "../constants";

/** Build the canonical chunk map key. */
export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/** Parse a chunk key back into [cx, cy, cz]. */
export function parseKey(key: string): [number, number, number] {
  const [cx, cy, cz] = key.split(",").map(Number);
  return [cx, cy, cz];
}

/** World coordinate (one axis) -> chunk coordinate. */
export function worldToChunk(w: number): number {
  return Math.floor(w / CHUNK_SIZE);
}

/** World coordinate (one axis) -> local coordinate within its chunk [0, CHUNK_SIZE). */
export function worldToLocal(w: number): number {
  return ((w % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

/** Flatten local block coordinates to a chunk block array index. */
export function localIndex(lx: number, ly: number, lz: number): number {
  return ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
}
