// Shared types for the chunk generation pipeline.
//
// Kept in their own module so generation stages (e.g. terrain.ts) and the
// ChunkGenerator can reference them without forming a runtime import cycle.

import type { NoiseSampler } from "./noise";

/** Read-only context shared by every generation stage for a given world seed. */
export interface GenContext {
  /** The world seed. */
  seed: number;
  /** Deterministic noise sampler built from the seed. */
  noise: NoiseSampler;
}

/**
 * A single generation stage. Stages run in order, each reading the context plus
 * chunk coordinates and writing into the shared `blocks` buffer. Stages must be
 * pure with respect to (seed, coordinates) — no module-level mutable state — so
 * generation stays deterministic and order-independent.
 */
export type GenStage = (
  ctx: GenContext,
  cx: number,
  cy: number,
  cz: number,
  blocks: Uint16Array,
) => void;
