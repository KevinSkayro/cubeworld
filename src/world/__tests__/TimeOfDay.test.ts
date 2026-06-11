import { describe, it, expect } from "vitest";
import { TimeOfDay, DAY_LENGTH_SECONDS } from "../TimeOfDay";

describe("TimeOfDay", () => {
  it("starts in the morning", () => {
    const t = new TimeOfDay();
    expect(t.hours).toBe(8);
  });

  it("advances one in-game hour per real minute", () => {
    const t = new TimeOfDay();
    t.hours = 0;
    t.advance(60); // 60 real seconds = 1 minute
    expect(t.hours).toBeCloseTo(1, 5);
  });

  it("completes a full day in DAY_LENGTH_SECONDS and wraps", () => {
    const t = new TimeOfDay();
    t.hours = 0;
    t.advance(DAY_LENGTH_SECONDS);
    expect(t.hours).toBeCloseTo(0, 5); // wrapped back to midnight
  });

  it("wraps past 24h without going negative", () => {
    const t = new TimeOfDay();
    t.hours = 23;
    t.advance(120); // +2 hours -> 25 -> wraps to 1
    expect(t.hours).toBeCloseTo(1, 5);
    expect(t.hours).toBeGreaterThanOrEqual(0);
    expect(t.hours).toBeLessThan(24);
  });

  it("ignores non-positive dt", () => {
    const t = new TimeOfDay();
    const before = t.hours;
    t.advance(0);
    t.advance(-5);
    expect(t.hours).toBe(before);
  });

  it("formats a zero-padded HH:MM label", () => {
    const t = new TimeOfDay();
    t.hours = 8.5;
    expect(t.label).toBe("08:30");
    t.hours = 13.75;
    expect(t.label).toBe("13:45");
    t.hours = 0;
    expect(t.label).toBe("00:00");
  });

  it("reports day fraction", () => {
    const t = new TimeOfDay();
    t.hours = 12;
    expect(t.dayFraction).toBeCloseTo(0.5, 5);
  });
});
