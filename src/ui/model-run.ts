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
import { preOf, yearWeather } from "./weather-years";
import { fallowWater } from "../hydrology";

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
  /** Corn after soybeans or soybeans after corn (default), or the same crop as last year. */
  prev?: "rotated" | "same";
  /** Irrigated field (automatic scheduling). Used for state averages, not offered as a control. */
  irrigated?: boolean;
  /** Naturally poorly drained field without tile. Used for state averages, not offered as a control. */
  poorDrainage?: boolean;
  /** Soil with a shallow water table that rises into the root zone in dry spells. Used for state averages, not offered as a control. */
  shallowWT?: boolean;
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

/** A table about a metre down at sowing that sinks half a centimetre a day. Depth, sinking rate and the 2 mm a day rise were set so 30 percent of land on such soils gives a regional lift near Rizzo et al. 2018 (6 percent on average, 24 in severe drought); they are placeholders, not measurements (see test/water-table.test.ts for the check against Rizzo et al. 2018). */
export const SHALLOW_WATER_TABLE = { depthCm: 100, deepeningCmPerDay: 0.5, fringeCm: 40, maxRiseMm: 2 };

/**
 * A structural override applied to every simulation: switches one model choice (kernel curve, canopy coupling, VPD
 * effect, diffuse light) so the spread across model structures can be measured next to the spread across weather years.
 * Null in the app; set by the offline runner.
 */
let structure: Record<string, unknown> | null = null;
export const setStructure = (o: Record<string, unknown> | null) => void (structure = o);

/**
 * Water-module settings applied to every simulation. `runoffCN` and the snow store act on real seasons and everywhere runoff applies;
 * `autumnFraction` is how full the root zone is on 1 October, before the winter spin-up. Set to null to run without them (for comparisons).
 */
export interface WaterSettings { runoffCN: number; snowDegreeDay: number; autumnFraction: number; rootGrowthMmPerTT?: number; evapStage1Mm?: number; upwardFlux?: number }
export const WATER_DEFAULTS: WaterSettings = { runoffCN: 78, snowDegreeDay: 3, autumnFraction: 0.35 };
let water: WaterSettings | null = WATER_DEFAULTS;
export const setWater = (w: Partial<WaterSettings> | null) => void (water = w === null ? null : { ...WATER_DEFAULTS, ...w });

/** One simulation of an option on one weather year (the array starts on the crop's model start day). */
export function simulateOption(cfg: CropConfig, loc: Location, soil: SoilParams, m: Management, season: WeatherDay[], tw: Tweaks = {}): SimulationResult {
  const s = { crop: cfg.key, location: loc.key, scenario: "typical", seed: 0, ...m } as Settings;
  let crop = cfg.cropFor(s);
  if (structure) crop = { ...crop, ...structure };
  if (tw.noFrost) crop = { ...crop, frostKillTemp: -99, frostHardyTemp: -99 };
  if (tw.noHeat) crop = { ...crop, heatDamageRate: 0 };
  let sl = soil;
  if (m.prev === "same") {
    // continuous cropping: no legume nitrogen credit (about 35 kg N ha-1 less in the profile) and a rotation penalty on growth
    crop = { ...crop, rue: crop.rue * (cfg.key === "maize" ? 0.95 : cfg.key === "soy" ? 0.96 : 0.97) };
    if (cfg.key === "maize" && sl.layers.some((l) => l.mineralN !== undefined)) {
      let left = 35;
      sl = { ...sl, layers: sl.layers.map((l) => { const take = Math.min(left, l.mineralN ?? 0); left -= take; return { ...l, mineralN: (l.mineralN ?? 0) - take }; }) };
    }
  }
  if (tw.noNLimit) sl = { ...sl, mineralizationRate: undefined };
  if (tw.noWaterLimit) sl = { ...sl, initialFraction: 1 };
  if (m.poorDrainage) sl = { ...sl, drainFraction: 0.08 };
  if (m.poorDrainage || m.shallowWT) sl = { ...sl, waterTable: SHALLOW_WATER_TABLE };
  if (water) {
    sl = { ...sl, runoffCN: water.runoffCN, ...(water.evapStage1Mm !== undefined ? { evapStage1Mm: water.evapStage1Mm } : {}), ...(water.upwardFlux !== undefined ? { upwardFlux: water.upwardFlux } : {}) };
    if (water.rootGrowthMmPerTT !== undefined) crop = { ...crop, rootGrowthMmPerTT: water.rootGrowthMmPerTT };
    const pre = preOf(season);
    if (pre) {
      // bare soil from 1 October to sowing, on the weather that really fell
      const toSowing = season.slice(0, m.sowDoy - cfg.yearStart);
      sl = { ...sl, initialWater: fallowWater(sl, [...pre, ...toSowing], { startFraction: water.autumnFraction, runoffCN: water.runoffCN, snowDegreeDay: water.snowDegreeDay }) };
    }
  }
  let weather = season.slice(m.sowDoy - cfg.yearStart);
  if (tw.noWaterLimit) weather = weather.map((w) => ({ ...w, rain: Math.max(w.rain, 12) }));
  return simulate({
    weather,
    crop,
    soil: sl,
    latitude: Math.abs(loc.lat),
    fertilizer: cfg.fertilizerFor(m.nRate, m.sowDoy),
    management: { seedingRate: m.seedingRate, sowingDepthCm: m.depthCm },
    irrigation: m.irrigated ? { trigger: 0.5, amountMm: 25, maxSeasonMm: cfg.key === "maize" ? 300 : cfg.key === "soy" ? 220 : 150 } : undefined,
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
  const evalAt = (c: Omit<BestChoice, "yieldTHa">): BestChoice => ({ ...c, yieldTHa: simulateOption(cfg, loc, soil, c, year).yieldTHa });
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
