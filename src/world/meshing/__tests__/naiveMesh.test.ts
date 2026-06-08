import { describe, it, expect } from "vitest";
import { naiveMesh } from "../naiveMesh";
import { facePlane, makeNeighborSampler } from "../neighbors";
import { Chunk } from "../../Chunk";
import { BlockRegistry } from "../../BlockRegistry";
import {
  BLOCK_WOOD,
  BLOCK_LEAVES,
  BLOCK_STONE,
  BLOCK_AIR,
  CHUNK_SIZE,
  CHUNK_VOLUME,
} from "../../constants";

const registry = new BlockRegistry();

function faceCount(chunk: Chunk): number {
  // 6 indices (two triangles) per quad face.
  return naiveMesh(chunk, registry).indices.length / 6;
}

// The six face-neighbours of an interior cell.
const NEIGHBORS: Array<[number, number, number]> = [
  [9, 8, 8],
  [7, 8, 8],
  [8, 9, 8],
  [8, 7, 8],
  [8, 8, 9],
  [8, 8, 7],
];

describe("naiveMesh opaque culling", () => {
  it("renders a block's faces against transparent (leaf) neighbours but not opaque ones", () => {
    const withLeaves = new Chunk(0, 0, 0);
    withLeaves.setBlock(8, 8, 8, BLOCK_WOOD);
    for (const [x, y, z] of NEIGHBORS) withLeaves.setBlock(x, y, z, BLOCK_LEAVES);

    const withStone = new Chunk(0, 0, 0);
    withStone.setBlock(8, 8, 8, BLOCK_WOOD);
    for (const [x, y, z] of NEIGHBORS) withStone.setBlock(x, y, z, BLOCK_STONE);

    // The surrounding blocks render the same number of faces in both cases
    // (each has 5 air-facing faces + 1 culled toward the wood). The only
    // difference is the centre wood: hidden behind opaque stone, but visible
    // through non-opaque leaves -> +6 faces.
    expect(faceCount(withLeaves) - faceCount(withStone)).toBe(6);
  });

  it("renders every leaf face, including leaf-against-leaf (dense canopy)", () => {
    const chunk = new Chunk(0, 0, 0);
    chunk.setBlock(8, 8, 8, BLOCK_LEAVES);
    chunk.setBlock(9, 8, 8, BLOCK_LEAVES);
    // Two adjacent leaves render all 6 faces each — the shared faces are kept.
    expect(faceCount(chunk)).toBe(12);
  });
});

describe("naiveMesh neighbour-aware culling", () => {
  const solidChunk = () => {
    const c = new Chunk(0, 0, 0);
    c.blocks = new Uint16Array(CHUNK_VOLUME).fill(BLOCK_STONE);
    return c;
  };
  const stonePlanes = () => {
    const stone = new Uint16Array(CHUNK_VOLUME).fill(BLOCK_STONE);
    return {
      xPos: facePlane(stone, 0, 0),
      xNeg: facePlane(stone, 0, CHUNK_SIZE - 1),
      yPos: facePlane(stone, 1, 0),
      yNeg: facePlane(stone, 1, CHUNK_SIZE - 1),
      zPos: facePlane(stone, 2, 0),
      zNeg: facePlane(stone, 2, CHUNK_SIZE - 1),
    };
  };
  const meshFaces = (chunk: Chunk, planes?: Parameters<typeof makeNeighborSampler>[0]) =>
    naiveMesh(chunk, registry, makeNeighborSampler(planes)).indices.length / 6;

  it("renders all six outer faces of a solid chunk when no neighbours are known", () => {
    expect(meshFaces(solidChunk())).toBe(6 * CHUNK_SIZE * CHUNK_SIZE);
  });

  it("culls every border face when surrounded by solid neighbours", () => {
    expect(meshFaces(solidChunk(), stonePlanes())).toBe(0);
  });

  it("renders exactly the border face exposed by a hole in a neighbour", () => {
    const planes = stonePlanes();
    // Expose the +X face of cell (15, 3, 5): the +X sampler reads xPos[ny*16+nz].
    planes.xPos[3 * CHUNK_SIZE + 5] = BLOCK_AIR;

    const mesh = naiveMesh(solidChunk(), registry, makeNeighborSampler(planes));
    expect(mesh.indices.length / 6).toBe(1);
    // Confirm it is the +X face — verifies the plane↔face axis/index mapping.
    expect([mesh.normals[0], mesh.normals[1], mesh.normals[2]]).toEqual([1, 0, 0]);
  });
});
