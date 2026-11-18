import { describe, expect, it } from "vitest";
import { simulate, maizeDefaults, loamDefaults, syntheticWeather } from "../src";

const run = (o: { rainMean: number; seed?: number }, extra: Partial<Parameters<typeof simulate>[0]> = {}, soil = loamDefaults) =>
  simulate({ weather: syntheticWeather({ rainMean: o.rainMean, seed: o.seed ?? 3 }), crop: maizeDefaults, soil, ...extra });

describe("irrigation", () => {
  it("lifts a dry-season yield, and never exceeds the seasonal limit", () => {
    const dry = run({ rainMean: 0.8 });
    const irr = run({ rainMean: 0.8 }, { irrigation: { maxSeasonMm: 250 } });
    expect(irr.yieldTHa).toBeGreaterThan(dry.yieldTHa * 1.15);
    expect(irr.balance.irrigation).toBeGreaterThan(50);
    expect(irr.balance.irrigation).toBeLessThanOrEqual(250);
  });
  it("applies little or nothing when rain is plentiful", () => {
    const wet = run({ rainMean: 6 }, { irrigation: {} });
    const dry = run({ rainMean: 0.8 }, { irrigation: {} });
    expect(wet.balance.irrigation).toBeLessThan(dry.balance.irrigation * 0.6);
  });
  it("does nothing when not asked for", () => {
    expect(run({ rainMean: 1 }).balance.irrigation).toBe(0);
  });
  it("keeps the water balance closed, counting irrigation as an input", () => {
    const r = run({ rainMean: 1 }, { irrigation: {} });
    const b = r.balance;
    expect(b.rain + b.irrigation - b.transpiration - b.soilEvap - b.drainage).toBeCloseTo(b.storageChange, 6);
  });
});

describe("poor drainage", () => {
  const poor = { ...loamDefaults, drainFraction: 0.08 };
  it("is identical to free drainage when drainFraction is 1", () => {
    const a = run({ rainMean: 4 });
    const b = run({ rainMean: 4 }, {}, { ...loamDefaults, drainFraction: 1 });
    expect(b.yieldTHa).toBe(a.yieldTHa);
  });
  it("costs yield in a wet season and almost nothing in a dry one", () => {
    const wetFree = run({ rainMean: 8 }).yieldTHa;
    const wetPoor = run({ rainMean: 8 }, {}, poor).yieldTHa;
    const dryFree = run({ rainMean: 1 }).yieldTHa;
    const dryPoor = run({ rainMean: 1 }, {}, poor).yieldTHa;
    expect(wetPoor).toBeLessThan(wetFree * 0.97);
    expect(dryPoor).toBeGreaterThan(dryFree * 0.97);
  });
  it("keeps the water balance closed and never goes above saturation", () => {
    const r = run({ rainMean: 8 }, {}, poor);
    const b = r.balance;
    expect(b.rain - b.transpiration - b.soilEvap - b.drainage).toBeCloseTo(b.storageChange, 6);
    for (const d of r.days) {
      d.soilWaterLayers.forEach((v, l) => {
        const layer = poor.layers[l]!;
        expect(v).toBeLessThanOrEqual((layer.fieldCapacity + 0.12) * layer.thickness + 1e-6);
      });
    }
  });
  it("reports an aeration stress only on a waterlogged profile", () => {
    const free = run({ rainMean: 8 });
    const wet = run({ rainMean: 8 }, {}, poor);
    expect(Math.min(...free.days.map((d) => d.aeration))).toBe(1);
    expect(Math.min(...wet.days.map((d) => d.aeration))).toBeLessThan(1);
  });
});
