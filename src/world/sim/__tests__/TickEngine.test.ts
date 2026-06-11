import { describe, it, expect } from "vitest";
import { TickEngine } from "../TickEngine";

describe("TickEngine", () => {
  it("converts real seconds into whole ticks at the fixed rate", () => {
    const e = new TickEngine(10); // 10 tps -> 0.1s/tick
    let ticks = 0;
    e.onTick = () => ticks++;
    e.advance(0.35); // 3 whole ticks (0.05 left over)
    expect(ticks).toBe(3);
    e.advance(0.05); // now 0.1 accumulated -> 1 more
    expect(ticks).toBe(4);
  });

  it("runs a scheduled block update on the next tick", () => {
    const e = new TickEngine(10);
    const fired: string[] = [];
    e.onBlockUpdate = (x, y, z) => fired.push(`${x},${y},${z}`);
    e.scheduleBlockUpdate(1, 2, 3);
    e.advance(0.1);
    expect(fired).toEqual(["1,2,3"]);
  });

  it("coalesces duplicate schedules for the same cell", () => {
    const e = new TickEngine(10);
    let count = 0;
    e.onBlockUpdate = () => count++;
    e.scheduleBlockUpdate(0, 0, 0);
    e.scheduleBlockUpdate(0, 0, 0);
    e.scheduleBlockUpdate(0, 0, 0);
    e.advance(0.1);
    expect(count).toBe(1);
  });

  it("propagates updates ring-by-ring (one tick apart)", () => {
    const e = new TickEngine(10);
    const order: number[] = [];
    e.onBlockUpdate = (x) => {
      order.push(x);
      if (x < 3) e.scheduleBlockUpdate(x + 1, 0, 0); // each schedules the next
    };
    e.scheduleBlockUpdate(0, 0, 0);
    e.advance(0.1);
    expect(order).toEqual([0]); // only the first this tick
    e.advance(0.3);
    expect(order).toEqual([0, 1, 2, 3]); // then one per tick
  });

  it("caps ticks per advance so a long stall can't freeze the loop", () => {
    const e = new TickEngine(10);
    let ticks = 0;
    e.onTick = () => ticks++;
    e.advance(100); // would be 1000 ticks; capped
    expect(ticks).toBeLessThanOrEqual(5);
  });
});
