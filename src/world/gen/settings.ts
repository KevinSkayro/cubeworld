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

// Generator version, stored with each persisted (edited) chunk. Informational
// today: unedited chunks are never cached (always regenerated, so generator
// changes show immediately), and player-edited chunks are never discarded on a
// bump. Kept for forensics/debugging and future migrations (e.g. if generated
// chunks are ever cached again, or the edit format changes). Bump when the
// generator changes meaningfully.
export const GEN_VERSION = 1;

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  seed: 12345,
  renderRadius: 4,
  // y 0..79 — surface sits ≈ y60 (see BASE_HEIGHT) with ~50-70 blocks of
  // underground for caves/caverns and an ore depth gradient, plus build
  // headroom above the surface. The per-tick load budget smooths the cost of
  // the extra layer; lower this (or render distance) on weak machines.
  minChunkY: 0,
  maxChunkY: 4,
  chunkLoadBudget: 8,
};

const RENDER_RADIUS_KEY = "cubeworld.renderRadius";
const SEED_KEY = "cubeworld.seed";
const AUTOSAVE_KEY = "cubeworld.autoSave";

/**
 * Turn a seed input string into a 32-bit integer seed. Numeric input is used
 * directly; any other text is hashed (FNV-1a) so word seeds work too. Pure and
 * deterministic: the same text always yields the same seed.
 */
export function parseSeed(input: string): number {
  const trimmed = input.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n >>> 0;
  }
  let h = 2166136261 >>> 0;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Load the persisted seed, falling back if unset/unavailable. */
export function loadSeed(fallback: number): number {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    if (raw === null) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Persist the chosen seed. No-op if storage is unavailable. */
export function saveSeed(seed: number): void {
  try {
    localStorage.setItem(SEED_KEY, String(seed));
  } catch {
    // ignore: private mode / storage disabled
  }
}

/** Load the persisted auto-save preference (default: disabled). */
export function loadAutoSave(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

/** Persist the auto-save preference. No-op if storage is unavailable. */
export function saveAutoSave(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore: private mode / storage disabled
  }
}

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
