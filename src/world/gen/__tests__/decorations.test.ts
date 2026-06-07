import { describe, it, expect } from "vitest";
import { generateTerrainShape } from "../terrain";
import { applySurfacePass } from "../surface";
import { placeOres } from "../ores";
import { carveCaves } from "../caves";
import { decorate, treeAt, stampTree } from "../decorations";
import { columnHeight } from "../terrain";
import { generateChunk } from "../ChunkGenerator";
import { localIndex } from "../coords";
import { makeNoise } from "../noise";
import { BIOMES } from "../../biome/biomeTable";
import type { GenContext } from "../types";
import {
  CHUNK_VOLUME,
  CHUNK_SIZE,
  BLOCK_AIR,
  BLOCK_WOOD,
  BLOCK_LEAVES,
  BLOCK_GRASS,
  BLOCK_DIRT,
  BLOCK_SNOW,
} from "../../constants";

const SEED = 12345;

function ctx(): GenContext {
  return { seed: SEED, noise: makeNoise(SEED) };
}

describe("decorate", () => {
  it("only adds wood/leaves into air, never overwriting terrain", () => {
    const c = ctx();
    for (let cy = 2; cy <= 4; cy++) {
      const base = new Uint16Array(CHUNK_VOLUME);
      generateTerrainShape(c, 0, cy, 0, base);
      applySurfacePass(c, 0, cy, 0, base);
      placeOres(c, 0, cy, 0, base);
      carveCaves(c, 0, cy, 0, base);
      const after = base.slice();
      decorate(c, 0, cy, 0, after);

      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (base[i] === after[i]) continue;
        expect(base[i]).toBe(BLOCK_AIR); // only filled air
        expect([BLOCK_WOOD, BLOCK_LEAVES]).toContain(after[i]);
      }
    }
  });

  it("is deterministic", () => {
    const a = new Uint16Array(CHUNK_VOLUME);
    const b = new Uint16Array(CHUNK_VOLUME);
    decorate(ctx(), 0, 4, 0, a);
    decorate(ctx(), 0, 4, 0, b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("produces trees (wood + leaves) on the surface", () => {
    const c = ctx();
    let wood = 0;
    let leaves = 0;
    for (let cy = 3; cy <= 4; cy++) {
      for (let cx = 0; cx <= 2; cx++) {
        for (let cz = 0; cz <= 2; cz++) {
          const buf = generateChunk(cx, cy, cz, SEED);
          for (const b of buf) {
            if (b === BLOCK_WOOD) wood++;
            else if (b === BLOCK_LEAVES) leaves++;
          }
        }
      }
    }
    expect(wood).toBeGreaterThan(0);
    expect(leaves).toBeGreaterThan(0);
  });

  it("places no trees in desert (biome gate)", () => {
    expect(BIOMES.desert.treeDensity).toBe(0);
  });

  it("every trunk sits on solid ground (no floating trees)", () => {
    const GROUND = [BLOCK_GRASS, BLOCK_DIRT, BLOCK_SNOW];
    let trunks = 0;

    for (let cx = 0; cx <= 2; cx++) {
      for (let cz = 0; cz <= 2; cz++) {
        // Stack the vertical layers that can contain trees + their support.
        const cols = new Map<number, Uint16Array>();
        const block = (lx: number, wy: number, lz: number) => {
          const cy = Math.floor(wy / CHUNK_SIZE);
          let buf = cols.get(cy);
          if (!buf) {
            buf = generateChunk(cx, cy, cz, SEED);
            cols.set(cy, buf);
          }
          return buf[localIndex(lx, wy - cy * CHUNK_SIZE, lz)];
        };

        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            // Find the lowest wood block in this column (the trunk base).
            let baseY = -1;
            for (let wy = 32; wy < 80; wy++) {
              if (block(lx, wy, lz) === BLOCK_WOOD) {
                baseY = wy;
                break;
              }
            }
            if (baseY < 0) continue;
            trunks++;
            expect(GROUND).toContain(block(lx, baseY - 1, lz));
          }
        }
      }
    }

    expect(trunks).toBeGreaterThan(0);
  });

  // The key cross-chunk correctness check: a tree whose canopy straddles a
  // chunk border must have every one of its blocks present in the correct
  // neighbouring chunk (no clipping/loss at the seam), across both the x and y
  // chunk boundaries.
  it("stamps a border-straddling tree's blocks into the correct chunks", () => {
    const c = ctx();

    // Find a tree whose canopy crosses the x=16 boundary (trunk x in 14..17).
    let tree = null;
    for (let cellX = 1; cellX <= 6 && !tree; cellX++) {
      for (let cellZ = 0; cellZ <= 6; cellZ++) {
        const t = treeAt(c, cellX, cellZ);
        if (t && t.x >= 14 && t.x <= 17 && t.z >= 1 && t.z <= 13) {
          tree = t;
          break;
        }
      }
    }
    expect(tree).not.toBeNull();

    // Collect the tree's full (unclipped) block set.
    const tb: Array<[number, number, number]> = [];
    stampTree(tree!, (wx, wy, wz) => tb.push([wx, wy, wz]));

    // The two chunk columns the tree spans horizontally, across both vertical
    // layers it can occupy.
    const chunks = new Map<string, Uint16Array>();
    for (const cx of [0, 1]) {
      for (const cy of [3, 4]) {
        chunks.set(`${cx},${cy}`, generateChunk(cx, cy, 0, SEED));
      }
    }

    let left = 0;
    let right = 0;
    for (const [wx, wy, wz] of tb) {
      if (wz < 0 || wz >= CHUNK_SIZE) continue; // outside our z chunk
      if (wx < 0 || wx >= CHUNK_SIZE * 2) continue;
      if (wy < 48 || wy >= 80) continue;
      // Canopy blocks that fall inside neighbouring terrain are legitimately
      // skipped (place only fills air) — only assert ones above their surface.
      if (wy <= columnHeight(c.noise, wx, wz)) continue;

      const cx = wx >= CHUNK_SIZE ? 1 : 0;
      const cy = Math.floor(wy / CHUNK_SIZE);
      const buf = chunks.get(`${cx},${cy}`)!;
      const block = buf[localIndex(wx - cx * CHUNK_SIZE, wy - cy * CHUNK_SIZE, wz)];
      expect([BLOCK_WOOD, BLOCK_LEAVES]).toContain(block);
      if (cx === 0) left++;
      else right++;
    }

    // It genuinely straddles: blocks present on both sides of the x border.
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });
});
