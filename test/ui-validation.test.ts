import { describe, expect, it } from "vitest";
import { NASS_SERIES, buAcToDryTHa, seriesFor, validate } from "../src/ui/validation";

describe("NASS state series", () => {
  it("covers the ten Midwest states for corn and soybeans, and six winter-wheat states", () => {
    expect(seriesFor("maize")).toHaveLength(10);
    expect(seriesFor("soy")).toHaveLength(10);
    expect(seriesFor("wheat")).toHaveLength(6);
  });
  it("has the well-known years right", () => {
    const iowa = seriesFor("maize").find((s) => s.state === "Iowa")!;
    expect(iowa.years[1993]).toBe(80);
    expect(iowa.years[2012]).toBe(137);
    expect(iowa.years[2008]).toBe(171);
    expect(seriesFor("wheat").find((s) => s.state === "Kansas")!.years[2011]).toBe(35);
    expect(NASS_SERIES.every((s) => Object.keys(s.years).length >= 20)).toBe(true);
  });
});

describe("validate", () => {
  // a model that reproduces the observed departures exactly, with no technology trend
  const s = seriesFor("maize").find((x) => x.state === "Iowa")!;
  const years = Object.keys(s.years).map(Number).filter((y) => y <= 2011);
  const obs = Object.fromEntries(years.map((y) => [y, s.years[y]!]));
  it("gives r near 1, swing size near 1 and a level gap against the 2020 trend for a model that tracks the anomalies", () => {
    // build modelled yields as trend-free versions of the observed anomalies
    const t = years.map((y) => buAcToDryTHa("maize", obs[y]!));
    const ym = years.reduce((a, b) => a + b, 0) / years.length;
    const om = t.reduce((a, b) => a + b, 0) / t.length;
    const slope = years.reduce((a, y, i) => a + (y - ym) * (t[i]! - om), 0) / years.reduce((a, y) => a + (y - ym) ** 2, 0);
    const modelled = new Map(years.map((y, i) => [y, 12 * (t[i]! / (om + slope * (y - ym)))]));
    const v = validate("maize", modelled, obs)!;
    expect(v.r).toBeGreaterThan(0.99);
    expect(v.sensitivity).toBeGreaterThan(0.95);
    expect(v.sensitivity).toBeLessThan(1.05);
    expect(v.trendRef).toBeGreaterThan(om);
  });
  it("shows swing size above 1 when the model's swings are too small, and below 1 when too big", () => {
    const base = new Map(years.map((y, i) => [y, 10 + (i % 2 ? 1 : -1)]));
    const o: Record<number, number> = Object.fromEntries(years.map((y, i) => [y, 100 + (i % 2 ? 20 : -20)]));
    const small = validate("maize", base, o)!;
    const big = validate("maize", new Map(years.map((y, i) => [y, 10 + (i % 2 ? 4 : -4)])), o)!;
    expect(small.sensitivity).toBeGreaterThan(big.sensitivity);
  });
});
