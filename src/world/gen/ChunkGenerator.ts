// Chunk generation pipeline.
//
// A ChunkGenerator holds the per-seed context (seed + noise sampler) and an
// ordered list of stages. `generate` allocates a chunk buffer and runs each
// stage over it. Today there is a single stage (terrain shape); future
// milestones append surface/caves/ores/decoration stages here.

import { CHUNK_VOLUME } from "../constants";
import { makeNoise } from "./noise";
import type { GenContext, GenStage } from "./types";
import { generateTerrainShape } from "./terrain";
import { applySurfacePass } from "./surface";
import { placeOres } from "./ores";
import { carveCaves } from "./caves";
import { applyBedrock } from "./bedrock";
import { decorate } from "./decorations";
import { placeStructures } from "./structures";

export class ChunkGenerator {
  readonly ctx: GenContext;
  private readonly stages: GenStage[];

  constructor(seed: number) {
    this.ctx = { seed, noise: makeNoise(seed) };
    // Ordered generation pipeline. Ores are placed before caves so cave
    // carving exposes veins in cave walls; bedrock runs after caves so it
    // backfills any cave air at the bottom (hole-free floor); decorations run
    // after that so trees sit on the final surface; structures run last so caves
    // don't carve them and they overwrite any vegetation in their footprint.
    this.stages = [
      generateTerrainShape,
      applySurfacePass,
      placeOres,
      carveCaves,
      applyBedrock,
      decorate,
      placeStructures,
    ];
  }

  generate(cx: number, cy: number, cz: number): Uint16Array {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (const stage of this.stages) {
      stage(this.ctx, cx, cy, cz, blocks);
    }
    return blocks;
  }
}

// Cache one generator per seed so the noise sampler (and its permutation
// tables) is built once rather than per chunk.
const generators = new Map<number, ChunkGenerator>();

export function getChunkGenerator(seed: number): ChunkGenerator {
  let gen = generators.get(seed);
  if (!gen) {
    gen = new ChunkGenerator(seed);
    generators.set(seed, gen);
  }
  return gen;
}

/** Convenience entry point: generate a chunk's blocks for a world seed. */
export function generateChunk(
  cx: number,
  cy: number,
  cz: number,
  seed: number,
): Uint16Array {
  return getChunkGenerator(seed).generate(cx, cy, cz);
}
