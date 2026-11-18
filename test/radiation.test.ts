import { describe, expect, it } from "vitest";
import { diffuseFraction, diffuseRueFactor, extraterrestrial, REFERENCE_DIFFUSE } from "../src/radiation";

describe("radiation", () => {
  it("extraterrestrial radiation is about 41 MJ m-2 d-1 at 42°N in midsummer and far less in midwinter", () => {
    expect(extraterrestrial(180, 42)).toBeGreaterThan(40);
    expect(extraterrestrial(180, 42)).toBeLessThan(43);
    expect(extraterrestrial(355, 42)).toBeLessThan(14);
  });
  it("diffuse fraction falls from near 1 on overcast days to about 0.17 on clear ones", () => {
    expect(diffuseFraction(2, 180, 42)).toBeGreaterThan(0.9);
    expect(diffuseFraction(34, 180, 42)).toBeLessThan(0.3);
    const a = diffuseFraction(10, 180, 42), b = diffuseFraction(20, 180, 42), c = diffuseFraction(30, 180, 42);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
  it("makes an overcast day more efficient than a clear one, a typical day neutral, and is off at zero gain", () => {
    expect(diffuseRueFactor(8, 190, 42, 0.3)).toBeGreaterThan(diffuseRueFactor(32, 190, 42, 0.3));
    expect(diffuseRueFactor(0, 190, 42, 0)).toBe(1);
    // a day with a typical 22 MJ m-2 of global radiation at 42°N is close to neutral
    expect(Math.abs(diffuseRueFactor(22, 190, 42, 0.3) - 1)).toBeLessThan(0.02);
  });
});
