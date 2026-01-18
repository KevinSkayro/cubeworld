import { CHUNK_SIZE, CHUNK_VOLUME } from "./constants";

export class Chunk {
  x: number;
  y: number;
  z: number;
  blocks: Uint16Array;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.blocks = new Uint16Array(CHUNK_VOLUME);
  }

  getBlock(lx: number, ly: number, lz: number): number {
    if (
      lx < 0 ||
      lx >= CHUNK_SIZE ||
      ly < 0 ||
      ly >= CHUNK_SIZE ||
      lz < 0 ||
      lz >= CHUNK_SIZE
    ) {
      return 0;
    }
    const index = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    return this.blocks[index];
  }

  setBlock(lx: number, ly: number, lz: number, blockId: number): void {
    if (
      lx < 0 ||
      lx >= CHUNK_SIZE ||
      ly < 0 ||
      ly >= CHUNK_SIZE ||
      lz < 0 ||
      lz >= CHUNK_SIZE
    ) {
      return;
    }
    const index = ly * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
    this.blocks[index] = blockId;
  }
}
