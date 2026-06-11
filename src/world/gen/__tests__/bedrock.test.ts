import { describe, it, expect } from "vitest";
import { applyBedrock, isBedrock } from "../bedrock";
import { generateChunk } from "../ChunkGenerator";
import { localIndex } from "../coords";
import { makeNoise } from "../noise";
import type { GenContext } from "../types";
import { CHUNK_VOLUME, CHUNK_SIZE, BLOCK_BEDROCK } from "../../constants";

const SEED = 12345;
const ctx = (): GenContext => ({ seed: SEED, noise: makeNoise(SEED) });

describe("bedrock", () => {
  it("makes y=0 solid bedrock across every column (a true floor)", () => {
    for (const [cx, cz] of [
      [0, 0],
      [3, -2],
      [-5, 7],
    ]) {
      const buf = generateChunk(cx, 0, cz, SEED);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          expect(buf[localIndex(lx, 0, lz)]).toBe(BLOCK_BEDROCK);
        }
      }
    }
  });

  it("never places bedrock above the band (y > 2)", () => {
    // Within the bottom chunk, nothing above y=2 is bedrock.
    const buf = generateChunk(0, 0, 0, SEED);
    for (let ly = 3; ly < CHUNK_SIZE; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          expect(buf[localIndex(lx, ly, lz)]).not.toBe(BLOCK_BEDROCK);
        }
      }
    }
    // And chunks entirely above the band contain no bedrock at all.
    const upper = generateChunk(0, 1, 0, SEED);
    expect(Array.from(upper)).not.toContain(BLOCK_BEDROCK);
  });

  it("is ragged: y=1 and y=2 are partially (not fully) bedrock", () => {
    const c = ctx();
    let y1 = 0;
    let y2 = 0;
    for (let x = 0; x < 64; x++) {
      for (let z = 0; z < 64; z++) {
        if (isBedrock(c.seed, x, 1, z)) y1++;
        if (isBedrock(c.seed, x, 2, z)) y2++;
      }
    }
    const total = 64 * 64;
    expect(y1).toBeGreaterThan(0);
    expect(y1).toBeLessThan(total); // not a full layer
    expect(y2).toBeGreaterThan(0);
    expect(y2).toBeLessThan(y1); // thins with height
  });

  it("survives caves (floor is hole-free even where a cave reached the bottom)", () => {
    // applyBedrock runs after caves, so y=0 is bedrock regardless of carving.
    const c = ctx();
    const buf = new Uint16Array(CHUNK_VOLUME);
    // Pretend caves carved everything to air, then apply bedrock.
    buf.fill(0);
    applyBedrock(c, 0, 0, 0, buf);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        expect(buf[localIndex(lx, 0, lz)]).toBe(BLOCK_BEDROCK);
      }
    }
  });

  it("is deterministic", () => {
    const a = generateChunk(0, 0, 0, SEED);
    const b = generateChunk(0, 0, 0, SEED);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
