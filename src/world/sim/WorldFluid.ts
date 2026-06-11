// Adapts the real World + TickEngine to the FluidWorld the flow rules expect.
//
// It reads/writes block ids + water levels on the World, schedules follow-up
// updates on the tick engine, and records which chunks changed so the game can
// remesh them. Border edits also mark the neighbouring chunk dirty (its mesh
// culls/slopes against this one).

import { World } from "../World";
import { TickEngine } from "./TickEngine";
import type { FluidWorld } from "./fluid";
import { BLOCK_AIR, BLOCK_WATER, CHUNK_SIZE } from "../constants";
import { worldToChunk, worldToLocal, chunkKey } from "../gen/coords";

export class WorldFluid implements FluidWorld {
  /** Chunk keys whose blocks/levels changed and need remeshing. */
  readonly dirty = new Set<string>();

  constructor(
    private readonly world: World,
    private readonly tick: TickEngine,
  ) {}

  getLevel(x: number, y: number, z: number): number {
    if (this.world.getBlock(x, y, z) !== BLOCK_WATER) return 0;
    return this.world.getWaterLevel(x, y, z);
  }

  isSolid(x: number, y: number, z: number): boolean {
    const b = this.world.getBlock(x, y, z);
    return b !== BLOCK_AIR && b !== BLOCK_WATER;
  }

  setLevel(x: number, y: number, z: number, level: number): void {
    if (level <= 0) {
      if (this.world.getBlock(x, y, z) !== BLOCK_WATER) return;
      this.world.setBlock(x, y, z, BLOCK_AIR); // also clears the level
    } else {
      this.world.setBlock(x, y, z, BLOCK_WATER);
      this.world.setWaterLevel(x, y, z, level);
    }
    this.markDirty(x, y, z);
  }

  schedule(x: number, y: number, z: number): void {
    this.tick.scheduleBlockUpdate(x, y, z);
  }

  /** Schedule a cell and its 6 neighbours (used on block edits near water). */
  disturb(x: number, y: number, z: number): void {
    this.schedule(x, y, z);
    this.schedule(x + 1, y, z);
    this.schedule(x - 1, y, z);
    this.schedule(x, y + 1, z);
    this.schedule(x, y - 1, z);
    this.schedule(x, y, z + 1);
    this.schedule(x, y, z - 1);
  }

  private markDirty(x: number, y: number, z: number): void {
    const cx = worldToChunk(x);
    const cy = worldToChunk(y);
    const cz = worldToChunk(z);
    this.dirty.add(chunkKey(cx, cy, cz));
    // A cell on a chunk face also affects the neighbour's mesh.
    const lx = worldToLocal(x);
    const ly = worldToLocal(y);
    const lz = worldToLocal(z);
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz));
    if (lx === CHUNK_SIZE - 1) this.dirty.add(chunkKey(cx + 1, cy, cz));
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz));
    if (ly === CHUNK_SIZE - 1) this.dirty.add(chunkKey(cx, cy + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1));
    if (lz === CHUNK_SIZE - 1) this.dirty.add(chunkKey(cx, cy, cz + 1));
  }
}
