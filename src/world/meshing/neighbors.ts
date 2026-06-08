// Cross-chunk face culling helpers.
//
// The mesher runs in a worker with only one chunk's blocks, so it can't see
// into adjacent chunks to cull faces at the shared border. Instead the main
// thread extracts each neighbour's adjacent 16x16 block plane (`facePlane`) and
// sends them along; the worker turns them into a sampler (`makeNeighborSampler`)
// that answers "what block is just across this border?".
//
// Plane indexing is shared by both ends: a plane stores blocks at index
// `a * CHUNK_SIZE + b`, where (a, b) are the two in-plane local coords for that
// axis — x face: (ly, lz); y face: (lx, lz); z face: (lx, ly).

import { CHUNK_SIZE } from "../constants";
import { localIndex } from "../gen/coords";
import type { NeighborPlanes } from "./types";

const AREA = CHUNK_SIZE * CHUNK_SIZE;
const LAST = CHUNK_SIZE - 1;

/** Extract a chunk's block plane at `layer` along `axis` (0=x, 1=y, 2=z). */
export function facePlane(
  blocks: Uint16Array,
  axis: 0 | 1 | 2,
  layer: number,
): Uint16Array {
  const plane = new Uint16Array(AREA);
  for (let a = 0; a < CHUNK_SIZE; a++) {
    for (let b = 0; b < CHUNK_SIZE; b++) {
      let lx: number, ly: number, lz: number;
      if (axis === 0) {
        lx = layer;
        ly = a;
        lz = b;
      } else if (axis === 1) {
        lx = a;
        ly = layer;
        lz = b;
      } else {
        lx = a;
        ly = b;
        lz = layer;
      }
      plane[a * CHUNK_SIZE + b] = blocks[localIndex(lx, ly, lz)];
    }
  }
  return plane;
}

/**
 * Build a neighbour-block accessor for the mesher. It is called with a face
 * neighbour coordinate where exactly one of nx/ny/nz is -1 or CHUNK_SIZE (just
 * outside the chunk); it returns that neighbour's block, or null if the plane
 * for that side wasn't supplied (so the caller renders the face).
 */
export function makeNeighborSampler(
  planes: NeighborPlanes | undefined,
): (nx: number, ny: number, nz: number) => number | null {
  return (nx, ny, nz) => {
    if (!planes) return null;
    if (nx === CHUNK_SIZE) return planes.xPos ? planes.xPos[ny * CHUNK_SIZE + nz] : null;
    if (nx === -1) return planes.xNeg ? planes.xNeg[ny * CHUNK_SIZE + nz] : null;
    if (ny === CHUNK_SIZE) return planes.yPos ? planes.yPos[nx * CHUNK_SIZE + nz] : null;
    if (ny === -1) return planes.yNeg ? planes.yNeg[nx * CHUNK_SIZE + nz] : null;
    if (nz === CHUNK_SIZE) return planes.zPos ? planes.zPos[nx * CHUNK_SIZE + ny] : null;
    if (nz === -1) return planes.zNeg ? planes.zNeg[nx * CHUNK_SIZE + ny] : null;
    return null;
  };
}

/**
 * Extract all six neighbour planes for the chunk at (cx,cy,cz), reading from a
 * lookup that returns a neighbour's blocks (or undefined if not loaded).
 */
export function collectNeighborPlanes(
  getBlocks: (cx: number, cy: number, cz: number) => Uint16Array | undefined,
  cx: number,
  cy: number,
  cz: number,
): NeighborPlanes {
  const planes: NeighborPlanes = {};
  const xp = getBlocks(cx + 1, cy, cz);
  if (xp) planes.xPos = facePlane(xp, 0, 0);
  const xn = getBlocks(cx - 1, cy, cz);
  if (xn) planes.xNeg = facePlane(xn, 0, LAST);
  const yp = getBlocks(cx, cy + 1, cz);
  if (yp) planes.yPos = facePlane(yp, 1, 0);
  const yn = getBlocks(cx, cy - 1, cz);
  if (yn) planes.yNeg = facePlane(yn, 1, LAST);
  const zp = getBlocks(cx, cy, cz + 1);
  if (zp) planes.zPos = facePlane(zp, 2, 0);
  const zn = getBlocks(cx, cy, cz - 1);
  if (zn) planes.zNeg = facePlane(zn, 2, LAST);
  return planes;
}
