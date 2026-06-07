import { describe, it, expect } from "vitest";
import { generateChunk } from "../ChunkGenerator";
import {
  placeStructures,
  structureAt,
  stampStructure,
  type Structure,
} from "../structures";
import { localIndex } from "../coords";
import { makeNoise } from "../noise";
import type { GenContext } from "../types";
import { CHUNK_VOLUME, CHUNK_SIZE, BLOCK_AIR } from "../../constants";

const SEED = 12345;
const REGION_SIZE = 96; // must match structures.ts

function ctx(): GenContext {
  return { seed: SEED, noise: makeNoise(SEED) };
}

/** A structure with no structure in any of its 8 neighbouring regions, so its
 *  footprint can't overlap another structure (makes stamp-vs-generate exact). */
function findIsolated(
  c: GenContext,
  range = 5,
  predicate: (s: Structure, regionX: number, regionZ: number) => boolean = () => true,
): { s: Structure; regionX: number; regionZ: number } | null {
  for (let regionX = -range; regionX <= range; regionX++) {
    for (let regionZ = -range; regionZ <= range; regionZ++) {
      const s = structureAt(c, regionX, regionZ);
      if (!s || !predicate(s, regionX, regionZ)) continue;
      let isolated = true;
      for (let dx = -1; dx <= 1 && isolated; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (structureAt(c, regionX + dx, regionZ + dz)) {
            isolated = false;
            break;
          }
        }
      }
      if (isolated) return { s, regionX, regionZ };
    }
  }
  return null;
}

/** World coords of every block a structure stamps (unclipped). */
function stampedCells(s: Structure): Array<[number, number, number, number]> {
  const cells: Array<[number, number, number, number]> = [];
  stampStructure(s, (wx, wy, wz, block) => cells.push([wx, wy, wz, block]));
  return cells;
}

const chunkOf = (w: number) => Math.floor(w / CHUNK_SIZE);

describe("structures", () => {
  it("structureAt is deterministic", () => {
    const a = structureAt(ctx(), 0, 0);
    const b = structureAt(ctx(), 0, 0);
    expect(a).toEqual(b);
  });

  it("placeStructures is deterministic", () => {
    const a = new Uint16Array(CHUNK_VOLUME);
    const b = new Uint16Array(CHUNK_VOLUME);
    placeStructures(ctx(), 0, 3, 0, a);
    placeStructures(ctx(), 0, 3, 0, b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("places at most one structure per region, with the origin inside it", () => {
    const c = ctx();
    for (let regionX = -3; regionX <= 3; regionX++) {
      for (let regionZ = -3; regionZ <= 3; regionZ++) {
        const s = structureAt(c, regionX, regionZ);
        if (!s) continue;
        expect(s.x).toBeGreaterThanOrEqual(regionX * REGION_SIZE);
        expect(s.x).toBeLessThan((regionX + 1) * REGION_SIZE);
        expect(s.z).toBeGreaterThanOrEqual(regionZ * REGION_SIZE);
        expect(s.z).toBeLessThan((regionZ + 1) * REGION_SIZE);
      }
    }
  });

  it("the placeholder structure actually appears in the world", () => {
    expect(findIsolated(ctx())).not.toBeNull();
  });

  // Core correctness: a structure spanning chunk borders has EVERY one of its
  // blocks present, exactly, in the correct chunk — no clipping/loss at the seam
  // and no double-placement. Because structures overwrite, each stamped cell must
  // equal the generated block in its chunk (an isolated structure can't be
  // overlapped by a neighbour).
  it("stamps a border-straddling structure identically from every chunk it touches", () => {
    const c = ctx();
    // Prefer one that touches the most chunks (most seams to check).
    const found = findIsolated(c);
    expect(found).not.toBeNull();
    const cells = stampedCells(found!.s);

    const touched = new Set<string>();
    for (const [wx, wy, wz] of cells) {
      touched.add(`${chunkOf(wx)},${chunkOf(wy)},${chunkOf(wz)}`);
    }
    expect(touched.size).toBeGreaterThan(1); // it genuinely straddles a border

    const chunks = new Map<string, Uint16Array>();
    const blockAt = (wx: number, wy: number, wz: number) => {
      const cx = chunkOf(wx);
      const cy = chunkOf(wy);
      const cz = chunkOf(wz);
      const key = `${cx},${cy},${cz}`;
      let buf = chunks.get(key);
      if (!buf) {
        buf = generateChunk(cx, cy, cz, SEED);
        chunks.set(key, buf);
      }
      return buf[
        localIndex(wx - cx * CHUNK_SIZE, wy - cy * CHUNK_SIZE, wz - cz * CHUNK_SIZE)
      ];
    };

    for (const [wx, wy, wz, block] of cells) {
      expect(blockAt(wx, wy, wz)).toBe(block);
    }
  });

  it("handles structures crossing a vertical (chunk-layer) boundary", () => {
    const c = ctx();
    // An isolated structure whose block span crosses a y = 16k boundary.
    const found = findIsolated(c, 6, (s) => {
      const cells = stampedCells(s);
      const ys = cells.map(([, wy]) => chunkOf(wy));
      return Math.min(...ys) !== Math.max(...ys);
    });
    expect(found).not.toBeNull();

    const cells = stampedCells(found!.s);
    const chunks = new Map<string, Uint16Array>();
    for (const [wx, wy, wz, block] of cells) {
      const cx = chunkOf(wx);
      const cy = chunkOf(wy);
      const cz = chunkOf(wz);
      const key = `${cx},${cy},${cz}`;
      let buf = chunks.get(key);
      if (!buf) {
        buf = generateChunk(cx, cy, cz, SEED);
        chunks.set(key, buf);
      }
      const idx = localIndex(
        wx - cx * CHUNK_SIZE,
        wy - cy * CHUNK_SIZE,
        wz - cz * CHUNK_SIZE,
      );
      expect(buf[idx]).toBe(block);
    }
  });

  it("never floats: the block beneath the foundation is solid ground", () => {
    const c = ctx();
    let checked = 0;
    for (let regionX = -5; regionX <= 5; regionX++) {
      for (let regionZ = -5; regionZ <= 5; regionZ++) {
        const s = structureAt(c, regionX, regionZ);
        if (!s) continue;
        // Block directly under the origin foundation (terrain, untouched by the
        // structure) must be solid in the fully generated world.
        const cx = chunkOf(s.x);
        const cy = chunkOf(s.y - 1);
        const cz = chunkOf(s.z);
        const buf = generateChunk(cx, cy, cz, SEED);
        const idx = localIndex(
          s.x - cx * CHUNK_SIZE,
          s.y - 1 - cy * CHUNK_SIZE,
          s.z - cz * CHUNK_SIZE,
        );
        expect(buf[idx]).not.toBe(BLOCK_AIR);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
