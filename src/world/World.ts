import { Chunk } from "./Chunk";
import { CHUNK_SIZE, BLOCK_WATER } from "./constants";
import { localIndex } from "./gen/coords";

export class World {
  chunks: Map<string, Chunk> = new Map();

  private getChunkKey(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  private getOrCreateChunk(cx: number, cy: number, cz: number): Chunk {
    const key = this.getChunkKey(cx, cy, cz);
    if (!this.chunks.has(key)) {
      this.chunks.set(key, new Chunk(cx, cy, cz));
    }
    return this.chunks.get(key)!;
  }

  getBlock(wx: number, wy: number, wz: number): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
    return chunk ? chunk.getBlock(lx, ly, lz) : 0;
  }

  setBlock(wx: number, wy: number, wz: number, blockId: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunk = this.getOrCreateChunk(cx, cy, cz);
    chunk.setBlock(lx, ly, lz, blockId);
    // Keep water level consistent: a non-water block clears any water there.
    if (blockId !== BLOCK_WATER) {
      chunk.waterLevel[localIndex(lx, ly, lz)] = 0;
    }
  }

  /** Water level (0..8) at a world cell; 0 if no chunk or no water. */
  getWaterLevel(wx: number, wy: number, wz: number): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
    if (!chunk) return 0;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.waterLevel[localIndex(lx, ly, lz)];
  }

  /** Set the water level (0..8) at a world cell. */
  setWaterLevel(wx: number, wy: number, wz: number, level: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.getOrCreateChunk(cx, cy, cz);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.waterLevel[localIndex(lx, ly, lz)] = level;
  }
}
