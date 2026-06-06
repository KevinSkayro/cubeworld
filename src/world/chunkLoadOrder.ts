// Pure chunk streaming decisions (no THREE/DOM deps, so they're unit-testable).
//
// Given the player's chunk coordinate and the world settings, decide which
// chunks to start loading this tick (nearest first, capped at the budget) and
// which loaded chunks fall outside the current view and should be unloaded.

import { chunkKey, parseKey } from "./gen/coords";
import type { WorldSettings } from "./gen/settings";

/**
 * Pick chunks to dispatch this tick: every chunk inside the horizontal render
 * radius and vertical range that is not already loaded, sorted nearest-first
 * (Euclidean in chunk space, so the player's own layer loads first), capped at
 * `settings.chunkLoadBudget`.
 */
export function selectChunksToLoad(
  pcx: number,
  pcy: number,
  pcz: number,
  settings: WorldSettings,
  isLoaded: (key: string) => boolean,
): string[] {
  const candidates: Array<{ key: string; dist: number }> = [];

  for (let cy = settings.minChunkY; cy <= settings.maxChunkY; cy++) {
    for (let cx = pcx - settings.renderRadius; cx <= pcx + settings.renderRadius; cx++) {
      for (let cz = pcz - settings.renderRadius; cz <= pcz + settings.renderRadius; cz++) {
        const key = chunkKey(cx, cy, cz);
        if (isLoaded(key)) continue;
        const dx = cx - pcx;
        const dy = cy - pcy;
        const dz = cz - pcz;
        candidates.push({ key, dist: dx * dx + dy * dy + dz * dz });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, settings.chunkLoadBudget).map((c) => c.key);
}

/**
 * Whether a currently-loaded chunk should be unloaded: outside the vertical
 * range, or beyond the horizontal render radius (Chebyshev distance).
 */
export function shouldUnload(
  key: string,
  pcx: number,
  pcz: number,
  settings: WorldSettings,
): boolean {
  const [cx, cy, cz] = parseKey(key);
  if (cy < settings.minChunkY || cy > settings.maxChunkY) return true;
  const dist = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
  return dist > settings.renderRadius;
}
