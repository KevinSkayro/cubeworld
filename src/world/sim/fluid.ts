// Water flow — a level-based cellular automaton (Minecraft-style).
//
// Each water cell carries a level 1..8: 8 = SOURCE (a permanent, full cell, e.g.
// a generated lake), 1..7 = flowing water that decreases with distance from its
// supply. Level 0 means "no water". A cell's level is computed purely from its
// surroundings ("pull" model): fed strongly from a water cell directly above,
// otherwise one less than its highest water neighbour. This naturally gives the
// 7-block horizontal spread cap, downward flow, and draining when a source is
// cut off. The function is pure given the FluidWorld, so it's unit-testable
// without the renderer or the game.

export const SOURCE = 8;
export const MAX_FLOW = 7; // strongest flowing level (just below a source)

/** Abstract world the flow rules operate on (real or test). */
export interface FluidWorld {
  /** Water level at a cell: 0 none, 1..7 flowing, 8 source. */
  getLevel(x: number, y: number, z: number): number;
  /** True if the cell is a block that water can't enter (not air, not water). */
  isSolid(x: number, y: number, z: number): boolean;
  /** Set a cell's water level (0 clears it back to air). */
  setLevel(x: number, y: number, z: number, level: number): void;
  /** Queue a future re-evaluation of a cell. */
  schedule(x: number, y: number, z: number): void;
}

const HORIZ: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Render height (0..1) of a water cell's top surface for a given level. */
export function levelToHeight(level: number): number {
  if (level >= SOURCE) return 1;
  if (level <= 0) return 0;
  // Flowing 1..7 -> ~0.125..0.875. (Cells with water above render full; the
  // mesher handles that — this is the surface height for an exposed top.)
  return level / 8;
}

/** A water cell is "falling" when the cell below is open air — it pours
 *  straight down and (like Minecraft) does NOT feed its sideways neighbours. */
function isFalling(w: FluidWorld, x: number, y: number, z: number): boolean {
  return (
    w.getLevel(x, y, z) > 0 &&
    !w.isSolid(x, y - 1, z) &&
    w.getLevel(x, y - 1, z) === 0
  );
}

/** The level a non-source cell should settle to, from its surroundings. */
function computeTarget(w: FluidWorld, x: number, y: number, z: number): number {
  let flowing: number;
  if (w.getLevel(x, y + 1, z) > 0) {
    // Fed from above (part of a falling column) — near-full flowing.
    flowing = MAX_FLOW;
  } else {
    // Fed laterally — one less than the highest adjacent water level. Falling
    // neighbours are skipped: water pours down rather than spreading mid-air,
    // so it only spreads out where it actually pools.
    let best = 0;
    for (const [dx, dz] of HORIZ) {
      const nx = x + dx;
      const nz = z + dz;
      const nl = w.getLevel(nx, y, nz);
      if (nl > 0 && !isFalling(w, nx, y, nz)) best = Math.max(best, nl - 1);
    }
    if (best < 1) return 0; // unsupported -> dries up
    flowing = best;
  }

  // Infinite source: a flowing cell touching >=2 sources and resting on solid
  // ground (or another source) becomes a source itself (so 2x2 holes fill).
  let sources = 0;
  for (const [dx, dz] of HORIZ) {
    if (w.getLevel(x + dx, y, z + dz) === SOURCE) sources++;
  }
  if (sources >= 2) {
    const belowSolid = w.isSolid(x, y - 1, z) || w.getLevel(x, y - 1, z) === SOURCE;
    if (belowSolid) return SOURCE;
  }
  return flowing;
}

/**
 * Re-evaluate one cell and, if it changed, queue its neighbours. Sources are
 * fixed supply and never recomputed here (they only change via world edits).
 */
export function updateCell(w: FluidWorld, x: number, y: number, z: number): void {
  if (w.getLevel(x, y, z) === SOURCE) return;
  // Water can't occupy a solid cell.
  if (w.isSolid(x, y, z)) return;

  const current = w.getLevel(x, y, z);
  const target = computeTarget(w, x, y, z);
  if (target === current) return;

  w.setLevel(x, y, z, target);
  // Neighbours may now need to flow in or drain.
  w.schedule(x + 1, y, z);
  w.schedule(x - 1, y, z);
  w.schedule(x, y + 1, z);
  w.schedule(x, y - 1, z);
  w.schedule(x, y, z + 1);
  w.schedule(x, y, z - 1);
}
