import { describe, expect, it } from "vitest";
import {
  simulate,
  maizeDefaults,
  loamDefaults,
  syntheticWeather,
  interpolate,
  defaultProcesses,
  type CropParams,
} from "../src";

const run = (
  weatherOpts = {},
  crop: CropParams = maizeDefaults,
  processes = {},
  extra: { latitude?: number; co2?: number } = {},
) =>
  simulate({ weather: syntheticWeather(weatherOpts), crop, soil: loamDefaults, processes, ...extra });

describe("partitioning tables", () => {
  it("shoot fractions sum to 1 at every DVS", () => {
    for (let dvs = 0; dvs <= 2; dvs += 0.05) {
      const s =
        interpolate(maizeDefaults.leafFraction, dvs) +
        interpolate(maizeDefaults.stemFraction, dvs) +
        interpolate(maizeDefaults.storageFraction, dvs);
      expect(s).toBeCloseTo(1, 10);
    }
  });
});

describe("conservation", () => {
  for (const opts of [
    { rainMean: 5, seed: 3 },
    { rainMean: 1.2, seed: 3 },
    { rainMean: 3, seed: 9 },
    { rainMean: 5, seed: 3, warming: 12 }, // heat-stressed
  ]) {
    it(`biomass balances (${JSON.stringify(opts)})`, () => {
      const r = run(opts);
      const last = r.days[r.days.length - 1]!;
      expect(last.totalBiomass).toBeCloseTo(maizeDefaults.initialBiomass + r.cumulativeGrowth, 6);
    });

    it(`water balances (${JSON.stringify(opts)})`, () => {
      const r = run(opts);
      const b = r.balance;
      expect(b.rain - b.transpiration - b.soilEvap - b.drainage).toBeCloseTo(b.storageChange, 6);
    });
  }

  it("soil water never drops below air-dry or exceeds field capacity", () => {
    const r = run({ rainMean: 1, seed: 5 });
    for (const d of r.days) {
      d.soilWaterLayers.forEach((v, l) => {
        const layer = loamDefaults.layers[l]!;
        expect(v).toBeLessThanOrEqual(layer.fieldCapacity * layer.thickness + 1e-9);
        // only the top layer can lose water below wilting point (soil evaporation)
        const floor = (l === 0 ? 0.5 : 1) * layer.wiltingPoint * layer.thickness;
        expect(v).toBeGreaterThanOrEqual(floor - 1e-9);
      });
    }
  });
});

describe("physical behavior", () => {
  it("matures, with monotone development and non-decreasing storage/root mass", () => {
    const r = run({ rainMean: 5, seed: 3 });
    expect(r.matured).toBe(true);
    let prevDvs = -1;
    let prevStorage = 0;
    for (const d of r.days) {
      expect(d.dvs).toBeGreaterThanOrEqual(prevDvs);
      expect(d.storage).toBeGreaterThanOrEqual(prevStorage - 1e-9);
      prevDvs = d.dvs;
      prevStorage = d.storage;
    }
  });

  it("all state variables stay non-negative and finite", () => {
    const r = run({ rainMean: 1.2, seed: 3 });
    for (const d of r.days) {
      for (const [k, raw] of Object.entries(d)) {
        if (typeof raw === "boolean") continue;
        for (const v of Array.isArray(raw) ? raw : [raw]) {
          expect(Number.isFinite(v), k).toBe(true);
          if (k !== "dvs") expect(v, k).toBeGreaterThanOrEqual(-1e-9);
        }
      }
    }
  });

  it("drought reduces yield; more water never reduces it (same temperature and light)", () => {
    const yields = [1, 2, 3, 5, 8].map((m) => run({ rainMean: m, seed: 3 }).yieldTHa);
    for (let i = 1; i < yields.length; i++) expect(yields[i]!).toBeGreaterThanOrEqual(yields[i - 1]! - 0.3);
    expect(yields[yields.length - 1]!).toBeGreaterThan(yields[0]! * 2);
  });

  it("more radiation raises yield when water is not limiting", () => {
    const lo = run({ rainMean: 6, sradMean: 14, seed: 4 }).yieldTHa;
    const hi = run({ rainMean: 6, sradMean: 22, seed: 4 }).yieldTHa;
    expect(hi).toBeGreaterThan(lo);
  });

  it("warmer seasons shorten the crop cycle (thermal-time driven)", () => {
    const cool = run({ rainMean: 5, seed: 3, warming: -2 }).days.length;
    const warm = run({ rainMean: 5, seed: 3, warming: 2 }).days.length;
    expect(warm).toBeLessThan(cool);
  });

  it("wet-season yield is in a plausible range for placeholder parameters", () => {
    const y = run({ rainMean: 5, seed: 3 }).yieldTHa;
    expect(y).toBeGreaterThan(4);
    expect(y).toBeLessThan(16);
  });

  it("is deterministic", () => {
    expect(run({ seed: 7 }).yieldTHa).toBe(run({ seed: 7 }).yieldTHa);
  });
});

describe("swappable processes", () => {
  it("replacing a process changes results without touching the rest of the model", () => {
    const base = run({ rainMean: 5, seed: 3 });
    // Experiment: a heat penalty on growth above 34 °C (illustrative only).
    const heat = run({ rainMean: 5, seed: 3, warming: 14 }, maizeDefaults, {
      temperatureFactor: (t: number, p: CropParams) =>
        defaultProcesses.temperatureFactor(t, p) * (t > 34 ? 0.5 : 1),
    });
    expect(heat.yieldTHa).not.toBe(base.yieldTHa);
  });

  it("a constant-growth stub still conserves mass", () => {
    const r = run({ rainMean: 5, seed: 3 }, maizeDefaults, {
      dailyGrowth: () => 10,
    });
    const last = r.days[r.days.length - 1]!;
    expect(last.totalBiomass).toBeCloseTo(maizeDefaults.initialBiomass + r.cumulativeGrowth, 6);
  });
});

describe("respiration", () => {
  it("net growth = gross - maintenance respiration, and respiration is positive", () => {
    const r = run({ rainMean: 5, seed: 3 });
    expect(r.cumulativeRespiration).toBeGreaterThan(0);
    expect(r.cumulativeGross - r.cumulativeRespiration).toBeCloseTo(r.cumulativeGrowth, 6);
    for (const d of r.days) expect(d.respiration).toBeLessThanOrEqual(d.gross + 1e-9);
  });

  it("for the same biomass, maintenance respiration rises with temperature (Q10)", () => {
    const at = (tmean: number) =>
      defaultProcesses.maintenanceRespiration({ tmean, livingBiomass: 500, p: maizeDefaults });
    expect(at(30)).toBeGreaterThan(at(20));
    expect(at(35) / at(25)).toBeCloseTo(maizeDefaults.maintRespQ10, 6);
  });
});

describe("photoperiod", () => {
  it("is neutral at the equator and lengthens vegetative phase at high latitude in summer", () => {
    const eq = run({ rainMean: 5, seed: 3, startDoy: 150 }, maizeDefaults, {}, { latitude: 0 });
    const hi = run({ rainMean: 5, seed: 3, startDoy: 150 }, maizeDefaults, {}, { latitude: 55 });
    expect(hi.days.length).toBeGreaterThan(eq.days.length);
    expect(Math.min(...hi.days.map((d) => d.photoperiodFactor))).toBeLessThan(1);
    expect(Math.min(...eq.days.map((d) => d.photoperiodFactor))).toBe(1);
  });

  it("daylength is about 12 h at the equator and follows the seasons", () => {
    expect(defaultProcesses.daylength(172, 0)).toBeCloseTo(12, 0);
    expect(defaultProcesses.daylength(172, 45)).toBeGreaterThan(15);
    expect(defaultProcesses.daylength(355, 45)).toBeLessThan(9);
  });
});

describe("CO2", () => {
  it("is neutral at 400 ppm and raises yield above it", () => {
    const base = run({ rainMean: 5, seed: 3 });
    expect(run({ rainMean: 5, seed: 3 }, maizeDefaults, {}, { co2: 400 }).yieldTHa).toBe(base.yieldTHa);
    expect(run({ rainMean: 5, seed: 3 }, maizeDefaults, {}, { co2: 600 }).yieldTHa).toBeGreaterThan(base.yieldTHa);
  });

  it("helps proportionally more under drought (water savings)", () => {
    const gain = (rainMean: number) => {
      const a = run({ rainMean, seed: 3 }).yieldTHa;
      const b = run({ rainMean, seed: 3 }, maizeDefaults, {}, { co2: 600 }).yieldTHa;
      return b / a;
    };
    expect(gain(1.5)).toBeGreaterThan(gain(6));
  });
});

describe("heat stress on grain set", () => {
  it("hot silking reduces grain set and yield; disabling the damage rate removes the effect", () => {
    const hot = run({ rainMean: 5, seed: 3, warming: 12 });
    expect(Math.min(...hot.days.map((d) => d.grainSet))).toBeLessThan(1);
    const noDamage = run({ rainMean: 5, seed: 3, warming: 12 }, { ...maizeDefaults, heatDamageRate: 0 });
    expect(noDamage.yieldTHa).toBeGreaterThan(hot.yieldTHa);
  });

  it("does nothing in a cool season", () => {
    const r = run({ rainMean: 5, seed: 3 });
    expect(Math.min(...r.days.map((d) => d.grainSet))).toBe(1);
  });
});

describe("multi-layer soil", () => {
  it("wets the profile top-down: rain refills the top layer before deeper ones", () => {
    const dry = { ...loamDefaults, initialFraction: 0 };
    const weather = syntheticWeather({ days: 5, rainMean: 0 }).map((d, i) => ({ ...d, rain: i === 0 ? 20 : 0 }));
    const r = simulate({ weather, crop: maizeDefaults, soil: dry });
    const l = r.days[0]!.soilWaterLayers;
    const top = loamDefaults.layers[0]!;
    // 20 mm fills the 100 mm top layer by 20 mm of its 16 mm... capacity above wilting
    expect(l[0]!).toBeGreaterThan(top.wiltingPoint * top.thickness * 0.5);
    expect(l[4]!).toBeCloseTo(loamDefaults.layers[4]!.wiltingPoint * loamDefaults.layers[4]!.thickness, 6);
  });

  it("deeper layers retain more water than the top layer after a dry spell (roots and evaporation draw top-down)", () => {
    const r = run({ rainMean: 1, seed: 5 });
    const mid = r.days[Math.floor(r.days.length * 0.7)]!;
    const rel = (l: number) => {
      const layer = loamDefaults.layers[l]!;
      return (mid.soilWaterLayers[l]! - layer.wiltingPoint * layer.thickness) /
        ((layer.fieldCapacity - layer.wiltingPoint) * layer.thickness);
    };
    expect(rel(4)).toBeGreaterThanOrEqual(rel(0));
  });
});
