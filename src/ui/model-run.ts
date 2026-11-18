import {
  simulate,
  windowConditions,
  type CropParams,
  type SimulationResult,
  type SoilParams,
  type WeatherDay,
  type WindowConditions,
} from "../index";
import { locationByKey, soilFor, type Location } from "./locations";
import { CROPS, type CropConfig, type Habit, type Settings } from "./crops";
import { yearWeather } from "./weather-years";

export { CROPS };
export type { CropConfig, CropKey, Habit, Settings } from "./crops";

export interface Run {
  s: Settings;
  cfg: CropConfig;
  loc: Location;
  soil: SoilParams;
  weather: WeatherDay[];
  crop: CropParams;
  result: SimulationResult;
  conditions: WindowConditions;
  winStartDvs: number;
  maxStem: number;
  maxLeaf: number;
  maxStorage: number;
  maxTotal: number;
  peakLai: number;
  maxRain: number;
}

/** The management choices that define one option in a comparison. */
export interface Management {
  sowDoy: number;
  rm: number;
  nRate: number;
  seedingRate: number;
  depthCm: number;
  habit: Habit;
}

/** Counterfactual switches used to split yield losses; every one defaults to the real thing. */
export interface Tweaks {
  noFrost?: boolean;
  noHeat?: boolean;
  /** Rain never limits: the profile starts full and every day gets at least 12 mm. */
  noWaterLimit?: boolean;
  /** Soil nitrogen never limits. */
  noNLimit?: boolean;
}

/** One simulation of an option on one weather year (the array starts on the crop's model start day). */
export function simulateOption(cfg: CropConfig, loc: Location, soil: SoilParams, m: Management, season: WeatherDay[], tw: Tweaks = {}): SimulationResult {
  const s = { crop: cfg.key, location: loc.key, scenario: "typical", seed: 0, ...m } as Settings;
  let crop = cfg.cropFor(s);
  if (tw.noFrost) crop = { ...crop, frostKillTemp: -99, frostHardyTemp: -99 };
  if (tw.noHeat) crop = { ...crop, heatDamageRate: 0 };
  let sl = soil;
  if (tw.noNLimit) sl = { ...sl, mineralizationRate: undefined };
  if (tw.noWaterLimit) sl = { ...sl, initialFraction: 1 };
  let weather = season.slice(m.sowDoy - cfg.yearStart);
  if (tw.noWaterLimit) weather = weather.map((w) => ({ ...w, rain: Math.max(w.rain, 12) }));
  return simulate({
    weather,
    crop,
    soil: sl,
    latitude: Math.abs(loc.lat),
    fertilizer: cfg.fertilizerFor(m.nRate, m.sowDoy),
    management: { seedingRate: m.seedingRate, sowingDepthCm: m.depthCm },
  });
}

export function runSeason(s: Settings): Run {
  const cfg = CROPS[s.crop];
  const loc = locationByKey(s.location);
  const soil = soilFor(loc);
  const weather = yearWeather(cfg, s.scenario, s.seed, loc).slice(s.sowDoy - cfg.yearStart);
  const crop = cfg.cropFor(s);
  const result = simulateOption(cfg, loc, soil, s, yearWeather(cfg, s.scenario, s.seed, loc));
  const d = result.days;
  const max = (f: (r: (typeof d)[number]) => number) => Math.max(1e-9, ...d.map(f));
  return {
    s,
    cfg,
    loc,
    soil,
    weather,
    crop,
    result,
    conditions: windowConditions(result.criticalPeriod, crop, cfg.idealSrad),
    winStartDvs: 1 - crop.kernelWindowBefore / crop.ttSilking,
    maxStem: max((r) => r.stem),
    maxLeaf: max((r) => r.leaf),
    maxStorage: max((r) => r.storage),
    maxTotal: max((r) => r.totalBiomass),
    peakLai: max((r) => r.lai),
    maxRain: Math.max(10, ...weather.slice(0, d.length).map((w) => w.rain)),
  };
}

export interface BestChoice {
  sowDoy: number;
  rm: number;
  nRate: number;
  seedingRate: number;
  depthCm: number;
  habit: Habit;
  yieldTHa: number;
}

const bestCache = new Map<string, BestChoice>();

/**
 * Highest yield found for this weather year. The search is staged so it stays fast in the browser:
 * 1. coarse grid over sowing date, maturity, nitrogen and habit at the default seeding rate and depth;
 * 2. grid over seeding rate and depth around that best;
 * 3. sowing date and nitrogen again with the new rate and depth;
 * 4. seeding rate and depth again.
 * It is a good-enough benchmark, not a proven global optimum. Among near-ties (1%) it prefers less nitrogen,
 * then a lower seeding rate, then a depth nearer the default.
 */
export function findBest(crop: Settings["crop"], scenario: string, seed: number, location: string): BestChoice {
  const key = `${crop}:${location}:${scenario}:${seed}`;
  const hit = bestCache.get(key);
  if (hit) return hit;
  const loc = locationByKey(location);
  const soil = soilFor(loc);
  const cfg = CROPS[crop];
  const year = yearWeather(cfg, scenario, seed, loc);
  const evalAt = (c: Omit<BestChoice, "yieldTHa">): BestChoice => {
    const s: Settings = { crop, location, scenario, seed, ...c };
    const r = simulate({
      weather: year.slice(c.sowDoy - cfg.yearStart),
      crop: cfg.cropFor(s),
      soil,
      latitude: Math.abs(loc.lat),
      fertilizer: cfg.fertilizerFor(c.nRate, c.sowDoy),
      management: { seedingRate: c.seedingRate, sowingDepthCm: c.depthCm },
    });
    return { ...c, yieldTHa: r.yieldTHa };
  };
  const pick = (rows: BestChoice[]): BestChoice => {
    const top = Math.max(...rows.map((r) => r.yieldTHa));
    const near = rows.filter((r) => r.yieldTHa >= top * 0.99);
    near.sort(
      (a, b) =>
        a.nRate - b.nRate ||
        a.seedingRate - b.seedingRate ||
        Math.abs(a.depthCm - cfg.defaults.depthCm) - Math.abs(b.depthCm - cfg.defaults.depthCm) ||
        b.yieldTHa - a.yieldTHa,
    );
    return near[0]!;
  };
  const popDepth = (b: BestChoice): BestChoice => {
    const rows: BestChoice[] = [];
    for (const seedingRate of cfg.grid.pop) for (const depthCm of cfg.grid.depth) rows.push(evalAt({ ...b, seedingRate, depthCm }));
    return pick(rows);
  };

  const { seedingRate, depthCm } = cfg.defaults;
  const grid: BestChoice[] = [];
  for (const habit of cfg.grid.habits)
    for (const sowDoy of cfg.grid.sow(habit))
      for (const rm of cfg.grid.rm)
        for (const nRate of cfg.grid.n) grid.push(evalAt({ sowDoy, rm, nRate, seedingRate, depthCm, habit }));
  let best = popDepth(pick(grid));
  const again: BestChoice[] = [];
  for (const sowDoy of cfg.grid.sow(best.habit)) for (const nRate of cfg.grid.n) again.push(evalAt({ ...best, sowDoy, nRate }));
  best = popDepth(pick(again));
  bestCache.set(key, best);
  return best;
}
