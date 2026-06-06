// World streaming + generation settings.
//
// A single object consumed by Game, ChunkManager, and the worldgen worker.
// Render distance is user-tunable (and persisted); the vertical range and load
// budget are configurable here and can later be exposed too.

export interface WorldSettings {
  /** World seed. */
  seed: number;
  /** Horizontal chunk radius (in X/Z) loaded around the player. */
  renderRadius: number;
  /** Lowest chunk layer to load (inclusive). y range starts at minChunkY * CHUNK_SIZE. */
  minChunkY: number;
  /** Highest chunk layer to load (inclusive). */
  maxChunkY: number;
  /** Max new chunk load/generate dispatches started per update tick. */
  chunkLoadBudget: number;
}

export const RENDER_RADIUS_MIN = 2;
export const RENDER_RADIUS_MAX = 10;

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  seed: 12345,
  renderRadius: 4,
  // y 0..63 — covers terrain (~y10-20), build headroom above the old 32 cap,
  // and room for future underground features. Kept modest for browser perf;
  // the per-tick load budget smooths the cost of the extra layers.
  minChunkY: 0,
  maxChunkY: 3,
  chunkLoadBudget: 8,
};

const RENDER_RADIUS_KEY = "cubeworld.renderRadius";

function clampRadius(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_WORLD_SETTINGS.renderRadius;
  return Math.max(RENDER_RADIUS_MIN, Math.min(RENDER_RADIUS_MAX, Math.round(r)));
}

/** Load the persisted render radius, clamped, falling back if unset/unavailable. */
export function loadRenderRadius(fallback: number): number {
  try {
    const raw = localStorage.getItem(RENDER_RADIUS_KEY);
    if (raw === null) return clampRadius(fallback);
    return clampRadius(parseInt(raw, 10));
  } catch {
    return clampRadius(fallback);
  }
}

/** Persist the render radius (clamped). No-op if storage is unavailable. */
export function saveRenderRadius(r: number): void {
  try {
    localStorage.setItem(RENDER_RADIUS_KEY, String(clampRadius(r)));
  } catch {
    // ignore: private mode / storage disabled
  }
}
