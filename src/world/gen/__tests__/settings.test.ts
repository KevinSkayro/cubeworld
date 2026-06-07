import { describe, it, expect } from "vitest";
import { parseSeed } from "../settings";

describe("parseSeed", () => {
  it("uses numeric input directly", () => {
    expect(parseSeed("12345")).toBe(12345);
    expect(parseSeed("  42 ")).toBe(42);
  });

  it("hashes text seeds deterministically", () => {
    const a = parseSeed("hello");
    expect(a).toBe(parseSeed("hello")); // stable
    expect(parseSeed("hello")).not.toBe(parseSeed("world"));
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });
});
