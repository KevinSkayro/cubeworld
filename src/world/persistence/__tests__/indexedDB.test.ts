// fake-indexeddb/auto installs an in-memory IndexedDB on globalThis. It must run
// before the module under test reads `typeof indexedDB`, so keep this import
// first.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  storageKey,
  saveEditedChunk,
  loadStoredChunk,
  deleteStoredChunk,
  clearAll,
} from "../indexedDB";
import { CHUNK_VOLUME } from "../../constants";

const SEED_A = 12345;
const SEED_B = 999;
const KEY = "0,4,0";

function sampleBlocks(): Uint16Array {
  const b = new Uint16Array(CHUNK_VOLUME);
  b[0] = 3; // stone
  b[1] = 8; // wood
  b[CHUNK_VOLUME - 1] = 9; // leaves
  return b;
}

function sampleWater(): Uint8Array {
  const w = new Uint8Array(CHUNK_VOLUME);
  w[5] = 8; // a source
  w[6] = 5; // flowing
  return w;
}

beforeEach(async () => {
  await clearAll();
});

describe("storageKey", () => {
  it("namespaces by seed", () => {
    expect(storageKey(SEED_A, KEY)).toBe("12345:0,4,0");
    expect(storageKey(SEED_A, KEY)).toBe(storageKey(SEED_A, KEY));
    expect(storageKey(SEED_A, KEY)).not.toBe(storageKey(SEED_B, KEY));
  });
});

describe("chunk persistence", () => {
  it("round-trips an edited chunk's blocks, water levels, version, and edited flag", async () => {
    const blocks = sampleBlocks();
    const water = sampleWater();
    await saveEditedChunk(SEED_A, KEY, blocks, water, 7);

    const stored = await loadStoredChunk(SEED_A, KEY);
    expect(stored).not.toBeNull();
    expect(stored!.edited).toBe(true);
    expect(stored!.version).toBe(7);
    expect(Array.from(stored!.blocks)).toEqual(Array.from(blocks));
    expect(Array.from(stored!.waterLevel!)).toEqual(Array.from(water));
  });

  it("stores a copy, not a view of the live buffer", async () => {
    const blocks = sampleBlocks();
    await saveEditedChunk(SEED_A, KEY, blocks, sampleWater(), 1);
    blocks[0] = 1; // mutate after saving
    const stored = await loadStoredChunk(SEED_A, KEY);
    expect(stored!.blocks[0]).toBe(3); // saved value, unaffected
  });

  it("isolates worlds: a different seed does not see another's chunk", async () => {
    await saveEditedChunk(SEED_A, KEY, sampleBlocks(), sampleWater(), 1);
    expect(await loadStoredChunk(SEED_B, KEY)).toBeNull();
    expect(await loadStoredChunk(SEED_A, KEY)).not.toBeNull();
  });

  it("returns null for a chunk that was never stored", async () => {
    expect(await loadStoredChunk(SEED_A, "9,9,9")).toBeNull();
  });

  it("deletes a stored chunk", async () => {
    await saveEditedChunk(SEED_A, KEY, sampleBlocks(), sampleWater(), 1);
    await deleteStoredChunk(SEED_A, KEY);
    expect(await loadStoredChunk(SEED_A, KEY)).toBeNull();
  });
});
