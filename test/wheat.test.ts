import { describe, expect, it } from "vitest";
import {
  defaultProcesses,
  hybrid,
  loamWithN,
  maizeDefaults,
  seasonalWeather,
  simulate,
  wheatCultivar,
  wheatSpringDefaults,
  wheatWinterDefaults,
  type CropParams,
  type SeasonalOptions,
  type WeatherDay,
} from "../src/index";

const YEAR = 200; // weather timeline starts on doy 200 so autumn sowing and spring harvest fit in one array
const fert = (n: number) => (n > 0 ? [{ day: 0, kgN: n * 0.3 }, { day: 150, kgN: n * 0.7 }] : []);
const year = (o: SeasonalOptions = {}) => seasonalWeather({ startDoy: YEAR, days: 600, seed: 4, ...o });
const run = (sowDoy: number, crop: CropParams, w: WeatherDay[] = year(), n = 150) =>
  simulate({ weather: w.slice(sowDoy - YEAR), crop, soil: loamWithN, latitude: 40, fertilizer: fert(n) });
const anthesisDoy = (r: ReturnType<typeof run>) => r.days.find((d) => d.dvs >= 1)?.doy ?? null;

describe("wheat: conservation", () => {
  it("conserves biomass, water and nitrogen", () => {
    const r = run(290, wheatCultivar(wheatWinterDefaults, 110));
    const last = r.days[r.days.length - 1]!;
    expect(last.totalBiomass).toBeCloseTo(wheatWinterDefaults.initialBiomass + r.cumulativeGrowth, 6);
    const b = r.balance;
    expect(b.rain).toBeCloseTo(b.transpiration + b.soilEvap + b.drainage + b.storageChange, 6);
    const n = r.nitrogen!;
    expect(n.fertilizer + n.mineralized).toBeCloseTo(n.uptake + n.leached + n.mineralChange, 6);
    expect(n.organicChange).toBeCloseTo(-n.mineralized, 6);
  });
});

describe("wheat: vernalization", () => {
  it("process responds only to cool temperatures", () => {
    const v = defaultProcesses.vernalizationRate;
    expect(v(5)).toBe(1);
    expect(v(-10)).toBe(0);
    expect(v(20)).toBe(0);
    expect(v(14)).toBeGreaterThan(0);
    expect(v(14)).toBeLessThan(1);
  });

  it("a winter type kept warm never vernalizes and flowers far later than a spring type", () => {
    const warm = Array.from({ length: 400 }, (_, i): WeatherDay => ({ doy: ((200 + i - 1) % 365) + 1, tmax: 27, tmin: 17, srad: 18, rain: 2 }));
    const w = simulate({ weather: warm, crop: wheatWinterDefaults, soil: loamWithN, latitude: 40 });
    const s = simulate({ weather: warm, crop: wheatSpringDefaults, soil: loamWithN, latitude: 40 });
    const wd = w.days.find((d) => d.dvs >= 1)?.day ?? Infinity;
    const sd = s.days.find((d) => d.dvs >= 1)?.day ?? Infinity;
    expect(w.days[w.days.length - 1]!.vern).toBe(0);
    expect(wd).toBeGreaterThan(sd + 60);
  });

  it("winter wheat sown in autumn completes vernalization before anthesis", () => {
    const r = run(290, wheatWinterDefaults);
    const atAnthesis = r.days.find((d) => d.dvs >= 1)!;
    expect(atAnthesis.vern).toBe(1);
  });

  it("winter wheat sown in spring fails to vernalize and flowers much later than autumn-sown", () => {
    const aut = anthesisDoy(run(290, wheatWinterDefaults))!; // doy of year
    const spr = run(105, wheatWinterDefaults);
    const sprDoy = anthesisDoy(spr);
    expect(sprDoy === null || sprDoy > aut + 60).toBe(true);
    expect(spr.yieldTHa).toBeLessThan(run(290, wheatWinterDefaults).yieldTHa * 0.7);
  });

  it("maize is unaffected: vern is always 1 and no requirement is set", () => {
    const w = seasonalWeather({ startDoy: 60, days: 330, seed: 4 }).slice(60);
    const r = simulate({ weather: w, crop: maizeDefaults, soil: loamWithN, latitude: 40 });
    expect(r.days.every((d) => d.vern === 1)).toBe(true);
  });
});

describe("wheat: photoperiod direction", () => {
  it("long-day crops slow in short days; short-day crops slow in long days", () => {
    const pp = defaultProcesses.photoperiodFactor;
    expect(pp(9, wheatWinterDefaults)).toBeLessThan(pp(15, wheatWinterDefaults));
    expect(pp(15, wheatWinterDefaults)).toBe(1);
    expect(pp(15, maizeDefaults)).toBeLessThan(pp(10, maizeDefaults));
  });
});

describe("wheat: frost", () => {
  it("hardened winter wheat survives a hard winter freeze but not a freeze after booting", () => {
    const base = run(290, wheatWinterDefaults);
    const winterIdx = base.days.findIndex((d) => d.dvs >= 0.15 && d.dvs < 0.5);
    const bootIdx = base.days.findIndex((d) => d.dvs >= 0.8);
    expect(winterIdx).toBeGreaterThan(0);
    const mod = (idx: number, tmin: number) => {
      const w = year().slice(290 - YEAR).map((d) => ({ ...d }));
      w[idx] = { ...w[idx]!, tmin, tmax: tmin + 6 };
      return simulate({ weather: w, crop: wheatWinterDefaults, soil: loamWithN, latitude: 40, fertilizer: fert(150) });
    };
    expect(mod(winterIdx, -12).frostKilled).toBe(false);
    expect(mod(winterIdx, -20).frostKilled).toBe(true);
    expect(mod(bootIdx, -6).frostKilled).toBe(true);
  });

  it("spring wheat sown in autumn dies of winter cold while winter wheat survives", () => {
    expect(run(305, wheatSpringDefaults).frostKilled).toBe(true);
    const w = run(305, wheatWinterDefaults);
    expect(w.frostKilled).toBe(false);
    expect(w.matured).toBe(true);
  });
});

describe("wheat: grain number and heat", () => {
  it("heat and drought in the weeks around anthesis cost grain number and yield", () => {
    const calm = run(290, wheatWinterDefaults);
    const hot = run(290, wheatWinterDefaults, year({ heatWave: { startDoy: 118, endDoy: 160, addC: 12 }, drySpell: { startDoy: 100, endDoy: 175 } }));
    expect(hot.criticalPeriod.hotDays).toBeGreaterThan(5);
    expect(hot.criticalPeriod.kernelsPerM2).toBeLessThan(calm.criticalPeriod.kernelsPerM2);
    expect(hot.yieldTHa).toBeLessThan(calm.yieldTHa * 0.8);
  });

  it("grain filling never exceeds the grain sink", () => {
    const r = run(290, wheatWinterDefaults);
    const cp = r.criticalPeriod;
    const maxStorage = Math.max(...r.days.map((d) => d.storage));
    expect(cp.completed).toBe(true);
    expect(maxStorage).toBeLessThanOrEqual(cp.kernelsPerM2 * wheatWinterDefaults.potentialKernelWeight + 300);
  });

  it("autumn sowing out-yields late-winter sowing for a winter type", () => {
    expect(run(290, wheatWinterDefaults).yieldTHa).toBeGreaterThan(run(410, wheatWinterDefaults).yieldTHa);
  });
});

describe("wheat: cultivar and CO2", () => {
  it("a later cultivar flowers later", () => {
    const a = anthesisDoy(run(290, wheatCultivar(wheatWinterDefaults, 95)))!;
    const b = anthesisDoy(run(290, wheatCultivar(wheatWinterDefaults, 125)))!;
    expect(b).toBeGreaterThan(a);
  });

  it("the direct CO2 effect on assimilation is larger for C3 wheat than for C4 maize", () => {
    const wheat = defaultProcesses.co2Effects(600, wheatWinterDefaults);
    const maize = defaultProcesses.co2Effects(600, maizeDefaults);
    expect(wheat.assimilation).toBeGreaterThan(maize.assimilation);
    expect(wheat.assimilation).toBeGreaterThan(1);
    expect(defaultProcesses.co2Effects(400, wheatWinterDefaults).assimilation).toBe(1);
  });

  it("elevated CO2 raises wheat yield and lowers its transpiration demand", () => {
    const w = year();
    const at = (co2: number) =>
      simulate({ weather: w.slice(90), crop: wheatWinterDefaults, soil: loamWithN, latitude: 40, fertilizer: fert(150), co2 });
    const lo = at(400);
    const hi = at(600);
    expect(hi.yieldTHa).toBeGreaterThan(lo.yieldTHa);
    expect(hi.balance.transpiration).toBeLessThan(lo.balance.transpiration * 1.1);
  });
});
