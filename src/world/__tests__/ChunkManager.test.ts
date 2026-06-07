// Exercises the M11 persistence wiring in ChunkManager without a browser:
// edited chunks are saved, eviction frees memory but the edit survives, and a
// generation result for an already-unloaded chunk is dropped (no orphan).
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { ChunkManager } from "../ChunkManager";
import { World } from "../World";
import { Chunk } from "../Chunk";
import { loadStoredChunk, clearAll } from "../persistence/indexedDB";
import { DEFAULT_WORLD_SETTINGS } from "../gen/settings";

const SEED = DEFAULT_WORLD_SETTINGS.seed;

function makeManager() {
  const world = new World();
  const scene = { add() {}, remove() {} } as unknown as THREE.Scene;
  const worker = { postMessage() {} } as unknown as Worker;
  const settings = { ...DEFAULT_WORLD_SETTINGS };
  const mgr = new ChunkManager(world, scene, worker, worker, settings, () => {});
  return { mgr, world };
}

/** Put a chunk into the world with one edited block. */
function seedChunk(world: World, key: string, blockValue = 42): Chunk {
  const [cx, cy, cz] = key.split(",").map(Number);
  const chunk = new Chunk(cx, cy, cz);
  chunk.blocks[0] = blockValue;
  world.chunks.set(key, chunk);
  return chunk;
}

beforeEach(async () => {
  await clearAll();
});

const unload = (mgr: ChunkManager, key: string) =>
  (mgr as unknown as { unloadChunk(k: string): void }).unloadChunk(key);

describe("ChunkManager persistence", () => {
  it("auto-save off: markEdited flags but does not persist until saveAll", async () => {
    const { mgr, world } = makeManager(); // auto-save off by default
    const key = "1,4,2";
    seedChunk(world, key, 77);

    mgr.markEdited(key);
    expect(world.chunks.get(key)!.edited).toBe(true);
    await mgr.flushSaves();
    expect(await loadStoredChunk(SEED, key)).toBeNull(); // not written yet

    expect(mgr.saveAll()).toBe(1);
    await mgr.flushSaves();
    expect((await loadStoredChunk(SEED, key))!.blocks[0]).toBe(77);
  });

  it("auto-save on: markEdited persists immediately", async () => {
    const { mgr, world } = makeManager();
    mgr.setAutoSave(true);
    const key = "2,4,1";
    seedChunk(world, key, 33);

    mgr.markEdited(key);
    await mgr.flushSaves();
    const stored = await loadStoredChunk(SEED, key);
    expect(stored!.edited).toBe(true);
    expect(stored!.blocks[0]).toBe(33);
  });

  it("enabling auto-save flushes already-dirty chunks", async () => {
    const { mgr, world } = makeManager();
    const key = "8,4,8";
    seedChunk(world, key, 21);
    mgr.markEdited(key); // dirty, unsaved (auto-save off)

    mgr.setAutoSave(true); // flushes the backlog
    await mgr.flushSaves();
    expect((await loadStoredChunk(SEED, key))!.blocks[0]).toBe(21);
  });

  it("auto-save on: a burst of edits persists the final state (latest wins)", async () => {
    const { mgr, world } = makeManager();
    mgr.setAutoSave(true);
    const key = "0,4,0";
    const chunk = seedChunk(world, key, 1);

    for (let i = 2; i <= 6; i++) {
      chunk.blocks[0] = i;
      mgr.markEdited(key);
    }
    await mgr.flushSaves();
    expect((await loadStoredChunk(SEED, key))!.blocks[0]).toBe(6);
  });

  it("keeps unsaved (dirty) chunks resident on unload", () => {
    const { mgr, world } = makeManager(); // auto-save off
    const key = "4,4,4";
    seedChunk(world, key, 9);
    mgr.markEdited(key); // dirty, unsaved

    unload(mgr, key);
    expect(world.chunks.has(key)).toBe(true); // not evicted — edit would be lost
  });

  it("evicts a saved chunk from memory but keeps it durable", async () => {
    const { mgr, world } = makeManager();
    const key = "3,4,3";
    seedChunk(world, key, 55);
    mgr.markEdited(key);
    mgr.saveAll();
    await mgr.flushSaves();

    unload(mgr, key);
    expect(world.chunks.has(key)).toBe(false); // memory freed
    expect((await loadStoredChunk(SEED, key))!.blocks[0]).toBe(55); // recoverable
  });

  it("does not persist generated (unedited) chunks", async () => {
    const { mgr } = makeManager();
    const key = "5,4,5";
    mgr.loadedChunks.add(key); // pretend it's wanted
    mgr.onWorldgenComplete(key, new Uint16Array(4096));

    await mgr.flushSaves();
    expect(await loadStoredChunk(SEED, key)).toBeNull();
  });

  it("drops a generation result for a chunk that was unloaded mid-flight", () => {
    const { mgr, world } = makeManager();
    const key = "7,4,7";
    // Not in loadedChunks (already unloaded) -> result must be discarded.
    mgr.onWorldgenComplete(key, new Uint16Array(4096));
    expect(world.chunks.has(key)).toBe(false);
  });
});
