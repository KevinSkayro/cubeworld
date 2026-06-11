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
    const CANOPY_RADIUS = 2; // matches decorations.ts
    const local = (w: number) => ((w % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    // Find any tree whose canopy crosses a chunk border in x or z (robust to
    // terrain changes — no reliance on a specific tree location).
    let tree = null;
    for (let cellX = -8; cellX <= 8 && !tree; cellX++) {
      for (let cellZ = -8; cellZ <= 8; cellZ++) {
        const t = treeAt(c, cellX, cellZ);
        if (!t) continue;
        const lx = local(t.x);
        const lz = local(t.z);
        const crossesX = lx < CANOPY_RADIUS || lx >= CHUNK_SIZE - CANOPY_RADIUS;
        const crossesZ = lz < CANOPY_RADIUS || lz >= CHUNK_SIZE - CANOPY_RADIUS;
        if (crossesX || crossesZ) {
          tree = t;
          break;
        }
      }
    }
    expect(tree).not.toBeNull();

    // Collect the tree's full (unclipped) block set.
    const tb: Array<[number, number, number]> = [];
    stampTree(tree!, (wx, wy, wz) => tb.push([wx, wy, wz]));

    // Generate (lazily) whichever chunks the tree's blocks fall into.
    const chunks = new Map<string, Uint16Array>();
    const blockAt = (wx: number, wy: number, wz: number) => {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const cz = Math.floor(wz / CHUNK_SIZE);
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

    // Every above-surface block must be present (wood/leaves) in its chunk, and
    // the tree must genuinely span more than one chunk column.
    const columns = new Set<string>();
    for (const [wx, wy, wz] of tb) {
      // Canopy cells that land inside neighbouring terrain are legitimately
      // skipped (place only fills air) — only assert ones above their surface.
      if (wy <= columnHeight(c.noise, wx, wz)) continue;
      expect([BLOCK_WOOD, BLOCK_LEAVES]).toContain(blockAt(wx, wy, wz));
      columns.add(`${Math.floor(wx / CHUNK_SIZE)},${Math.floor(wz / CHUNK_SIZE)}`);
    }
    expect(columns.size).toBeGreaterThan(1);
  });
});
