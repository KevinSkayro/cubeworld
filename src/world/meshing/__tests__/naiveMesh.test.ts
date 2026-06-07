import { describe, it, expect } from "vitest";
import { naiveMesh } from "../naiveMesh";
import { Chunk } from "../../Chunk";
import { BlockRegistry } from "../../BlockRegistry";
import { BLOCK_WOOD, BLOCK_LEAVES, BLOCK_STONE } from "../../constants";

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
