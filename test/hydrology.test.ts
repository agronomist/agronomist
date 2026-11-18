import { describe, expect, it } from "vitest";
import { fallowWater, runoffMm, snowStep } from "../src/hydrology";
import { loamDefaults, syntheticWeather, type WeatherDay } from "../src";
import { CROPS } from "../src/ui/crops";
import { locationByKey, soilFor } from "../src/ui/locations";
import { simulateOption } from "../src/ui/model-run";
import { syntheticYear, tagPre } from "../src/ui/weather-years";

const day = (rain: number, t = 10): WeatherDay => ({ doy: 1, tmax: t + 5, tmin: t - 5, srad: 8, rain });

describe("runoff", () => {
  it("is zero for light rain, grows with the storm, and is larger on wet soil", () => {
    expect(runoffMm(5, 78, 0.5)).toBe(0);
    expect(runoffMm(60, 78, 0.5)).toBeGreaterThan(runoffMm(30, 78, 0.5));
    expect(runoffMm(40, 78, 1)).toBeGreaterThan(runoffMm(40, 78, 0)); // wet soil sheds more
  });
  it("never exceeds the rain", () => {
    for (const p of [10, 30, 80, 200]) expect(runoffMm(p, 90, 1)).toBeLessThanOrEqual(p);
  });
});

describe("snow store", () => {
  it("holds precipitation below freezing and releases it as melt", () => {
    let s = snowStep(0, day(10, -5), 3);
    expect(s).toEqual({ store: 10, liquid: 0 });
    s = snowStep(s.store, day(0, 2), 3);
    expect(s.liquid).toBeCloseTo(6, 10);
    s = snowStep(s.store, day(0, 10), 3);
    expect(s.store).toBe(0);
    expect(s.liquid).toBeCloseTo(4, 10);
  });
});

describe("fallow soil water", () => {
  const soil = loamDefaults;
  const total = (a: number[]) => a.reduce((x, y) => x + y, 0);
  it("fills over a wet winter and stays near the start after a dry one", () => {
    const wet = Array.from({ length: 150 }, () => day(4, 2));
    const dry = Array.from({ length: 150 }, () => day(0, 2));
    const w = fallowWater(soil, wet, { startFraction: 0.3 });
    const d = fallowWater(soil, dry, { startFraction: 0.3 });
    expect(total(w)).toBeGreaterThan(total(d) + 50);
  });
  it("never holds more than field capacity with free drainage", () => {
    const sw = fallowWater(soil, Array.from({ length: 100 }, () => day(20, 5)), { startFraction: 0.5 });
    sw.forEach((v, i) => expect(v).toBeLessThanOrEqual(soil.layers[i]!.fieldCapacity * soil.layers[i]!.thickness + 1e-9));
  });
  it("delays recharge when precipitation falls as snow, then recharges at the melt", () => {
    const cold = Array.from({ length: 30 }, () => day(5, -6));
    const held = fallowWater(soil, cold, { startFraction: 0.3, snowDegreeDay: 3 });
    const noSnow = fallowWater(soil, cold, { startFraction: 0.3 });
    expect(total(noSnow)).toBeGreaterThan(total(held));
    const melted = fallowWater(soil, [...cold, ...Array.from({ length: 40 }, () => day(0, 6))], { startFraction: 0.3, snowDegreeDay: 3 });
    expect(total(melted)).toBeGreaterThan(total(held) + 20);
  });
  it("runoff keeps water out of the soil in storms", () => {
    const storms = Array.from({ length: 20 }, () => day(60, 15));
    expect(total(fallowWater(soil, storms, { startFraction: 0.3, runoffCN: 85 }))).toBeLessThanOrEqual(total(fallowWater(soil, storms, { startFraction: 0.3 })));
  });
});

describe("the season starts from the soil water the weather left", () => {
  const cfg = CROPS.maize;
  const loc = locationByKey("iowa");
  const soil = soilFor(loc);
  const plan = { sowDoy: 125, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter" as const };
  // a dry summer, so what the soil holds at sowing matters
  const season = () => syntheticYear(cfg, "drought", 4, loc).map((d) => ({ ...d }));
  it("a wet winter gives a higher yield than a dry one in the same dry summer", () => {
    const wetPre = Array.from({ length: 151 }, (_, i) => ({ ...day(5, 1), doy: 274 + (i % 91) }));
    const dryPre = Array.from({ length: 151 }, (_, i) => ({ ...day(0.2, 1), doy: 274 + (i % 91) }));
    const a = simulateOption(cfg, loc, soil, plan, tagPre(season(), wetPre)).yieldTHa;
    const b = simulateOption(cfg, loc, soil, plan, tagPre(season(), dryPre)).yieldTHa;
    expect(a).toBeGreaterThan(b);
  });
  it("a season without pre-season weather still runs", () => {
    expect(simulateOption(cfg, loc, soil, plan, season()).yieldTHa).toBeGreaterThan(0);
  });
});
void syntheticWeather;
