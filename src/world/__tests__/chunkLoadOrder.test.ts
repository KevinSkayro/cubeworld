import { describe, it, expect } from "vitest";
import { selectChunksToLoad, shouldUnload } from "../chunkLoadOrder";
import { parseKey, chunkKey } from "../gen/coords";
import type { WorldSettings } from "../gen/settings";

const SETTINGS: WorldSettings = {
  seed: 1,
  renderRadius: 2,
  minChunkY: 0,
  maxChunkY: 2,
  chunkLoadBudget: 5,
};

const none = () => false;

describe("selectChunksToLoad", () => {
  it("returns at most the load budget", () => {
    const out = selectChunksToLoad(0, 1, 0, SETTINGS, none);
    expect(out.length).toBe(SETTINGS.chunkLoadBudget);
  });

  it("returns the full window when budget is large enough", () => {
    const big = { ...SETTINGS, chunkLoadBudget: 10000 };
    const out = selectChunksToLoad(0, 1, 0, big, none);
    const width = 2 * big.renderRadius + 1; // 5
    const layers = big.maxChunkY - big.minChunkY + 1; // 3
    expect(out.length).toBe(width * width * layers);
  });

  it("loads nearest chunks first (player's own chunk first)", () => {
    const out = selectChunksToLoad(3, 1, -2, SETTINGS, none);
    expect(out[0]).toBe(chunkKey(3, 1, -2));
  });

  it("never returns an already-loaded chunk", () => {
    const loadedKey = chunkKey(3, 1, -2);
    const isLoaded = (k: string) => k === loadedKey;
    const out = selectChunksToLoad(3, 1, -2, SETTINGS, isLoaded);
    expect(out).not.toContain(loadedKey);
  });

  it("stays within the configured vertical range", () => {
    const big = { ...SETTINGS, chunkLoadBudget: 10000 };
    const out = selectChunksToLoad(0, 1, 0, big, none);
    for (const key of out) {
      const [, cy] = parseKey(key);
      expect(cy).toBeGreaterThanOrEqual(big.minChunkY);
      expect(cy).toBeLessThanOrEqual(big.maxChunkY);
    }
  });

  it("stays within the horizontal render radius", () => {
    const big = { ...SETTINGS, chunkLoadBudget: 10000 };
    const out = selectChunksToLoad(5, 1, 5, big, none);
    for (const key of out) {
      const [cx, , cz] = parseKey(key);
      expect(Math.abs(cx - 5)).toBeLessThanOrEqual(big.renderRadius);
      expect(Math.abs(cz - 5)).toBeLessThanOrEqual(big.renderRadius);
    }
  });
});

describe("shouldUnload", () => {
  it("keeps chunks inside the radius and vertical range", () => {
    expect(shouldUnload(chunkKey(0, 0, 0), 0, 0, SETTINGS)).toBe(false);
    expect(shouldUnload(chunkKey(2, 2, -2), 0, 0, SETTINGS)).toBe(false);
  });

  it("unloads chunks beyond the horizontal radius", () => {
    expect(shouldUnload(chunkKey(3, 1, 0), 0, 0, SETTINGS)).toBe(true);
    expect(shouldUnload(chunkKey(0, 1, -3), 0, 0, SETTINGS)).toBe(true);
  });

  it("unloads chunks outside the vertical range", () => {
    expect(shouldUnload(chunkKey(0, 3, 0), 0, 0, SETTINGS)).toBe(true);
    expect(shouldUnload(chunkKey(0, -1, 0), 0, 0, SETTINGS)).toBe(true);
  });
});
