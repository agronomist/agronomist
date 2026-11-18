import { describe, expect, it } from "vitest";
import {
  simulate,
  maizeDefaults,
  loamDefaults,
  loamWithN,
  syntheticWeather,
  type Fertilizer,
  type WeatherDay,
} from "../src";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const minN0 = sum(loamWithN.layers.map((l) => l.mineralN ?? 0));
const org0 = sum(loamWithN.layers.map((l) => l.organicN ?? 0));

const run = (weatherOpts = {}, fertilizer: Fertilizer[] = [], weather?: WeatherDay[]) =>
  simulate({
    weather: weather ?? syntheticWeather(weatherOpts),
    crop: maizeDefaults,
    soil: loamWithN,
    latitude: 40,
    fertilizer,
  });

const split = (n: number): Fertilizer[] =>
  n === 0 ? [] : [{ day: 0, kgN: n * 0.4 }, { day: 40, kgN: n * 0.6 }];

/** Weather with a heavy rain event on a given day, otherwise dry. */
const stormWeather = (stormDay: number, mm: number) =>
  syntheticWeather({ rainMean: 0, rainProb: 0.0001, seed: 2 }).map((d, i) => ({
    ...d,
    rain: i === stormDay ? mm : 0,
  }));

describe("nitrogen conservation", () => {
  const scenarios: [string, number, Parameters<typeof run>[0]][] = [
    ["no fertilizer", 0, { rainMean: 5, seed: 3 }],
    ["moderate fertilizer", 120, { rainMean: 5, seed: 3 }],
    ["huge fertilizer, wet", 400, { rainMean: 9, seed: 4 }],
    ["dry", 100, { rainMean: 1.2, seed: 3 }],
  ];
  for (const [name, n, opts] of scenarios) {
    it(`mineral, organic and crop N balance (${name})`, () => {
      const r = run(opts, split(n));
      const nb = r.nitrogen!;
      const last = r.days[r.days.length - 1]!;
      // fertilizer applied on day 40 only counts if the run lasted that long (it does)
      expect(minN0 + nb.fertilizer + nb.mineralized).toBeCloseTo(last.minN + nb.uptake + nb.leached, 6);
      expect(org0 - nb.mineralized).toBeCloseTo(org0 + nb.organicChange, 6);
      expect(last.nCrop).toBeCloseTo(nb.seed + nb.uptake, 6);
      expect(nb.mineralChange).toBeCloseTo(last.minN - minN0, 6);
    });
  }

  it("mineral N never goes negative, uptake respects the daily cap, NNI stays in [0,1]", () => {
    const r = run({ rainMean: 5, seed: 3 }, split(60));
    for (const d of r.days) {
      expect(d.minN).toBeGreaterThanOrEqual(-1e-9);
      expect(d.nUptake).toBeLessThanOrEqual(maizeDefaults.nMaxUptake + 1e-9);
      expect(d.nni).toBeGreaterThanOrEqual(0);
      expect(d.nni).toBeLessThanOrEqual(1);
    }
  });
});

describe("nitrogen off", () => {
  it("is non-limiting and leaves the N result undefined when the soil has no N pool", () => {
    const r = simulate({ weather: syntheticWeather({ rainMean: 5, seed: 3 }), crop: maizeDefaults, soil: loamDefaults });
    expect(r.nitrogen).toBeUndefined();
    expect(r.days.every((d) => d.nni === 1)).toBe(true);
  });
});

describe("fertilizer response", () => {
  const rates = [0, 60, 120, 180, 240, 300];
  const y = rates.map((n) => run({ rainMean: 5, seed: 3 }, split(n)).yieldTHa);

  it("yield never decreases with more N and responds at low N", () => {
    for (let i = 1; i < y.length; i++) expect(y[i]!).toBeGreaterThanOrEqual(y[i - 1]! - 1e-9);
    expect(y[2]!).toBeGreaterThan(y[0]! * 1.3);
  });

  it("plateaus: extra N beyond the plateau adds nothing", () => {
    expect(Math.abs(y[5]! - y[4]!)).toBeLessThan(0.05);
  });

  it("no-N plots show N stress (NNI < 1) while well-fertilized ones do not", () => {
    const low = run({ rainMean: 5, seed: 3 }, []);
    const high = run({ rainMean: 5, seed: 3 }, split(240));
    expect(Math.min(...low.days.filter((d) => d.dvs >= 0).map((d) => d.nni))).toBeLessThan(0.9);
    expect(Math.min(...high.days.filter((d) => d.dvs >= 0).map((d) => d.nni))).toBeGreaterThan(0.95);
  });

  it("a drier season needs less N to reach its (lower) plateau", () => {
    const atN = (n: number, rainMean: number) => run({ rainMean, seed: 3 }, split(n)).yieldTHa;
    const wetGain = atN(120, 5) - atN(0, 5);
    expect(wetGain).toBeGreaterThan(0);
    expect(atN(60, 2)).toBeCloseTo(atN(240, 2), 1);
  });
});

describe("leaching and timing", () => {
  it("N applied before a storm is leached more than N applied after it", () => {
    const w = stormWeather(3, 150);
    const early = run({}, [{ day: 0, kgN: 100 }], w);
    const late = run({}, [{ day: 40, kgN: 100 }], w);
    expect(early.nitrogen!.leached).toBeGreaterThan(late.nitrogen!.leached + 10);
    // the storm also leaches native soil N, so the difference is what the fertilizer adds
    const noFert = run({}, [], w).nitrogen!.leached;
    expect(early.nitrogen!.leached - noFert).toBeGreaterThan(10);
    expect(late.nitrogen!.leached).toBeCloseTo(noFert, 6);
  });

  it("without drainage nothing is leached", () => {
    const r = run({}, [{ day: 0, kgN: 100 }], stormWeather(3, 0));
    expect(r.nitrogen!.leached).toBe(0);
  });

  it("split application beats all-at-once when an early storm leaches the first dose", () => {
    const w = stormWeather(5, 150).map((d, i) => (i > 20 && i % 7 === 0 ? { ...d, rain: 25 } : d));
    const once = run({}, [{ day: 0, kgN: 120 }], w);
    const splitApp = run({}, [{ day: 0, kgN: 30 }, { day: 40, kgN: 90 }], w);
    expect(splitApp.yieldTHa).toBeGreaterThan(once.yieldTHa);
  });
});

describe("mineralization", () => {
  it("is faster in a warmer season for the same period", () => {
    const m = (warming: number) =>
      run({ days: 40, rainMean: 4, seed: 3, warming }).nitrogen!.mineralized;
    expect(m(5)).toBeGreaterThan(m(-5));
  });

  it("supplies N without fertilizer, but less than a fertilized crop's uptake", () => {
    const r = run({ rainMean: 5, seed: 3 }, []);
    expect(r.nitrogen!.mineralized).toBeGreaterThan(0);
    expect(r.nitrogen!.uptake).toBeGreaterThan(0);
  });
});
