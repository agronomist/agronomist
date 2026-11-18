import { describe, expect, it } from "vitest";
import { CROPS } from "../src/ui/crops";
import { syntheticYear } from "../src/ui/weather-years";
import { locationByKey, soilFor } from "../src/ui/locations";
import { simulateOption, SHALLOW_WATER_TABLE } from "../src/ui/model-run";
import { simulate, maizeDefaults, loamDefaults, syntheticWeather } from "../src/index";

const cfg = CROPS.maize;
const loc = locationByKey("iowa");
const soil = soilFor(loc);
const m = { sowDoy: 120, rm: 110, nRate: 200, seedingRate: 8, depthCm: 5, habit: "winter" as const };

describe("water table", () => {
  it("closes the water balance with the water that rose", () => {
    const weather = syntheticWeather({ days: 200, rainMean: 1.2, seed: 5 });
    const r = simulate({ weather, crop: maizeDefaults, soil: { ...loamDefaults, waterTable: SHALLOW_WATER_TABLE } });
    const b = r.balance;
    expect(b.capillary).toBeGreaterThan(0);
    expect(b.rain + b.capillary - b.transpiration - b.soilEvap - b.drainage).toBeCloseTo(b.storageChange, 6);
  });
  it("adds nothing when there is no table, or when it is far below the roots", () => {
    const weather = syntheticWeather({ days: 200, rainMean: 1.2, seed: 5 });
    expect(simulate({ weather, crop: maizeDefaults, soil: loamDefaults }).balance.capillary).toBe(0);
    const deep = simulate({ weather, crop: maizeDefaults, soil: { ...loamDefaults, waterTable: { depthCm: 600 } } });
    expect(deep.balance.capillary).toBe(0);
  });
  it("helps most in dry years: a lift on average and a bigger one in the driest years (Rizzo et al. 2018)", () => {
    const rows = Array.from({ length: 40 }, (_, k) => {
      const w = syntheticYear(cfg, "typical", k + 1, loc);
      return { a: simulateOption(cfg, loc, soil, m, w).yieldTHa, b: simulateOption(cfg, loc, soil, { ...m, shallowWT: true }, w).yieldTHa };
    }).sort((x, y) => x.a - y.a);
    const mean = (r: typeof rows, k: "a" | "b") => r.reduce((s, x) => s + x[k], 0) / r.length;
    const all = mean(rows, "b") / mean(rows, "a") - 1;
    const dry = mean(rows.slice(0, 4), "b") / mean(rows.slice(0, 4), "a") - 1;
    expect(all).toBeGreaterThan(0.03);
    expect(dry).toBeGreaterThan(all);
    // with about 30 percent of the land on such soils the regional lift is of the order Rizzo et al. report (6 percent)
    expect(0.3 * all).toBeGreaterThan(0.02);
    expect(0.3 * all).toBeLessThan(0.12);
  });
});
