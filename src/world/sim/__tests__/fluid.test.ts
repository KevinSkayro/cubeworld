import { describe, it, expect } from "vitest";
import { updateCell, SOURCE, FluidWorld, levelToHeight } from "../fluid";

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

// In-memory fluid world for testing the pure flow rules. Processes the schedule
// queue to a fixed point and guards against non-convergence.
class TestWorld implements FluidWorld {
  levels = new Map<string, number>();
  solids = new Set<string>();
  private queue: Array<[number, number, number]> = [];

  solid(x: number, y: number, z: number) {
    this.solids.add(key(x, y, z));
  }
  source(x: number, y: number, z: number) {
    this.levels.set(key(x, y, z), SOURCE);
  }
  getLevel(x: number, y: number, z: number) {
    return this.levels.get(key(x, y, z)) ?? 0;
  }
  isSolid(x: number, y: number, z: number) {
    return this.solids.has(key(x, y, z));
  }
  setLevel(x: number, y: number, z: number, level: number) {
    if (level <= 0) this.levels.delete(key(x, y, z));
    else this.levels.set(key(x, y, z), level);
  }
  schedule(x: number, y: number, z: number) {
    this.queue.push([x, y, z]);
  }
  /** Run to a fixed point; returns steps taken (throws if it won't converge). */
  run(maxSteps = 200000): number {
    let steps = 0;
    while (this.queue.length) {
      const [x, y, z] = this.queue.shift()!;
      updateCell(this, x, y, z);
      if (++steps > maxSteps) throw new Error("fluid did not converge");
    }
    return steps;
  }
}

// A flat solid floor at y=0 across a wide area; water sits at y=1.
function floored(): TestWorld {
  const w = new TestWorld();
  for (let x = -20; x <= 20; x++)
    for (let z = -20; z <= 20; z++) w.solid(x, 0, z);
  return w;
}

describe("water flow", () => {
  it("spreads from a source along a flat floor, losing a level per block, capped at 7", () => {
    const w = floored();
    w.source(0, 1, 0);
    // Kick the source's neighbours (sources are passive).
    w.schedule(1, 1, 0);
    w.schedule(-1, 1, 0);
    w.schedule(0, 1, 1);
    w.schedule(0, 1, -1);
    w.run();

    expect(w.getLevel(1, 1, 0)).toBe(7); // 1 block from source
    expect(w.getLevel(2, 1, 0)).toBe(6);
    expect(w.getLevel(6, 1, 0)).toBe(2);
    expect(w.getLevel(7, 1, 0)).toBe(1); // 7 blocks out — thinnest flow
    expect(w.getLevel(8, 1, 0)).toBe(0); // spread stops after 7 blocks
  });

  it("flows straight down, then pools and spreads at the bottom", () => {
    const w = new TestWorld();
    // A closed 5x5 box: floor at y=0, walls around the perimeter for y=1..5.
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) w.solid(x, 0, z);
    for (let y = 1; y <= 5; y++) {
      for (let x = -2; x <= 2; x++) {
        w.solid(x, y, -2);
        w.solid(x, y, 2);
      }
      for (let z = -2; z <= 2; z++) {
        w.solid(-2, y, z);
        w.solid(2, y, z);
      }
    }
    // Source at the top centre; let it pour down and fill the floor.
    w.source(0, 5, 0);
    w.schedule(0, 4, 0);
    w.run();

    // Water reached the floor and spread to the inner edges of the box.
    expect(w.getLevel(0, 1, 0)).toBeGreaterThan(0);
    expect(w.getLevel(1, 1, 0)).toBeGreaterThan(0);
    expect(w.getLevel(0, 1, 1)).toBeGreaterThan(0);
  });

  it("drains flowing water when the source is removed", () => {
    const w = floored();
    w.source(0, 1, 0);
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      w.schedule(x, 1, z);
    w.run();
    expect(w.getLevel(3, 1, 0)).toBeGreaterThan(0); // water present

    // Remove the source and let it settle.
    w.setLevel(0, 1, 0, 0);
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      w.schedule(x, 1, z);
    w.run();

    // All flowing water is gone.
    for (let x = -9; x <= 9; x++)
      for (let z = -9; z <= 9; z++) expect(w.getLevel(x, 1, z)).toBe(0);
  });

  it("forms an infinite source between two sources (2x2-hole rule)", () => {
    const w = floored();
    w.source(0, 1, 0);
    w.source(2, 1, 0);
    w.schedule(1, 1, 0); // the gap between them
    w.run();
    expect(w.getLevel(1, 1, 0)).toBe(SOURCE);
  });

  it("levelToHeight: source is full, flowing is partial, none is zero", () => {
    expect(levelToHeight(SOURCE)).toBe(1);
    expect(levelToHeight(0)).toBe(0);
    expect(levelToHeight(7)).toBeGreaterThan(0);
    expect(levelToHeight(7)).toBeLessThan(1);
    expect(levelToHeight(4)).toBeLessThan(levelToHeight(7));
  });
});
