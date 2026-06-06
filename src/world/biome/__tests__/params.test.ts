import { describe, it, expect } from "vitest";
import { sampleBiomeParams } from "../params";
import { makeNoise } from "../../gen/noise";

const SEED = 12345;
const noise = makeNoise(SEED);

describe("sampleBiomeParams", () => {
  it("is deterministic for the same seed and coords", () => {
    const a = sampleBiomeParams(noise, 100, -250);
    const b = sampleBiomeParams(makeNoise(SEED), 100, -250);
    expect(a).toEqual(b);
  });

  it("keeps every parameter in [0, 1]", () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 37 - 9000;
      const z = i * 53 + 4000;
      const p = sampleBiomeParams(noise, x, z);
      for (const v of [p.temperature, p.humidity, p.continentalness]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("varies smoothly between adjacent blocks (continuity)", () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 13 - 500;
      const z = i * 7 + 800;
      const p = sampleBiomeParams(noise, x, z);
      const px = sampleBiomeParams(noise, x + 1, z);
      const pz = sampleBiomeParams(noise, x, z + 1);
      // Low-frequency fields change only a tiny amount per block.
      expect(Math.abs(px.temperature - p.temperature)).toBeLessThan(0.02);
      expect(Math.abs(pz.humidity - p.humidity)).toBeLessThan(0.02);
      expect(Math.abs(px.continentalness - p.continentalness)).toBeLessThan(0.02);
    }
  });

  it("produces independent (non-identical) fields", () => {
    // Across a grid the three fields must clearly diverge, not track each other.
    let maxTempHum = 0;
    let maxTempCont = 0;
    for (let gx = 0; gx < 20; gx++) {
      for (let gz = 0; gz < 20; gz++) {
        const p = sampleBiomeParams(noise, gx * 250, gz * 250);
        maxTempHum = Math.max(maxTempHum, Math.abs(p.temperature - p.humidity));
        maxTempCont = Math.max(
          maxTempCont,
          Math.abs(p.temperature - p.continentalness),
        );
      }
    }
    expect(maxTempHum).toBeGreaterThan(0.2);
    expect(maxTempCont).toBeGreaterThan(0.2);
  });
});
