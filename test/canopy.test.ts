import { describe, expect, it } from "vitest";
import { canopyOffset, relativeCanopyHeat, vpdKpa, UPPER_LIMIT } from "../src/canopy";

describe("canopy temperature", () => {
  it("vapour pressure deficit grows with the daily range and with heat", () => {
    expect(vpdKpa(32, 22)).toBeGreaterThan(vpdKpa(32, 26));
    expect(vpdKpa(36, 22)).toBeGreaterThan(vpdKpa(30, 22));
    expect(vpdKpa(20, 25)).toBe(0);
  });
  it("a freely transpiring canopy is cooler than the air, more so in dry air; a dead-stressed one is about 4.5 °C warmer", () => {
    expect(canopyOffset(1, 0)).toBeLessThan(0.5);
    expect(canopyOffset(3, 0)).toBeLessThan(canopyOffset(1, 0));
    expect(canopyOffset(3, 0)).toBeLessThan(-2);
    expect(canopyOffset(2, 1)).toBeCloseTo(UPPER_LIMIT, 10);
  });
  it("is warmer the more stressed the crop is, and relative heat is zero at the reference stress", () => {
    expect(relativeCanopyHeat(34, 20, 0.2, 1)).toBeGreaterThan(relativeCanopyHeat(34, 20, 0.8, 1));
    expect(relativeCanopyHeat(34, 20, 0.8, 1)).toBeCloseTo(0, 10);
    expect(relativeCanopyHeat(34, 20, 0.2, 0.3)).toBeCloseTo(0.3 * relativeCanopyHeat(34, 20, 0.2, 1), 10);
  });
});

import { waterLimitedGrowthFactor } from "../src/canopy";
describe("water-limited growth and VPD", () => {
  it("leaves a crop with enough water alone, and is off at zero sensitivity", () => {
    expect(waterLimitedGrowthFactor(1, 38, 20, 1)).toBe(1);
    expect(waterLimitedGrowthFactor(0.6, 38, 20, 0)).toBe(0.6);
  });
  it("gives less growth for the same shortage when the air is drier", () => {
    const humid = waterLimitedGrowthFactor(0.6, 30, 24, 0.5);
    const dry = waterLimitedGrowthFactor(0.6, 36, 14, 0.5);
    expect(dry).toBeLessThan(humid);
    expect(dry).toBeLessThan(0.6);
  });
  it("uses a given dew point in place of the minimum temperature", () => {
    expect(waterLimitedGrowthFactor(0.6, 34, 22, 0.5, 8)).toBeLessThan(waterLimitedGrowthFactor(0.6, 34, 22, 0.5, 21));
  });
});
