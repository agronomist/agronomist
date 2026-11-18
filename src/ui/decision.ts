import type { SoilParams } from "../index";
import type { CropConfig, CropKey } from "./crops";
import type { Location } from "./locations";
import { simulateOption, type Management } from "./model-run";
import { syntheticYear, type Ensemble } from "./weather-years";

/** One candidate plan in a comparison. */
export interface Option extends Management {
  id: string;
  name: string;
}

/** Prices for the money view. Grain is $ per tonne at market moisture, nitrogen $ per kg N, seed $ per 1000 seeds. */
export interface Prices {
  grain: number;
  nitrogen: number;
  seedPer1000: number;
}

/** Round, recent-ish US numbers (about $4.80/bu maize, $6.50/bu wheat, $0.50/lb N). Editable on the page. */
export const DEFAULT_PRICES: Record<CropKey, Prices> = {
  maize: { grain: 190, nitrogen: 1.1, seedPer1000: 3.5 },
  wheat: { grain: 240, nitrogen: 1.1, seedPer1000: 0.02 },
};
/** Moisture the grain is sold at; the model's yield is dry matter. */
export const MARKET_MOISTURE: Record<CropKey, number> = { maize: 0.155, wheat: 0.135 };

export interface Stats {
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  sd: number;
  /** Mean of the worst fifth of years (conditional value at risk, 20%). */
  worst20: number;
}

/** Linear-interpolated percentile of an ascending array, p in 0..1. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const x = p * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (x - lo);
}

export function stats(values: readonly number[]): Stats {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const k = Math.max(1, Math.ceil(0.2 * n));
  return { n, mean, median: percentile(v, 0.5), p10: percentile(v, 0.1), p90: percentile(v, 0.9), min: v[0] ?? NaN, max: v[n - 1] ?? NaN, sd, worst20: v.slice(0, k).reduce((a, b) => a + b, 0) / k };
}

export interface Outcome {
  label: number;
  yieldTHa: number;
  /** Return over nitrogen and seed cost, $/ha. */
  net: number;
  frostKilled: boolean;
  matured: boolean;
}

export interface Evaluation {
  option: Option;
  outcomes: Outcome[];
  yield: Stats;
  net: Stats;
  /** Years with a killing frost or almost no grain. */
  failures: number;
  worstYear: number;
}

/** Revenue at market moisture minus nitrogen and seed. Nothing else is counted: other costs are the same for every option. */
export function netReturn(cfg: CropConfig, m: Management, p: Prices, yieldTHa: number): number {
  const tonnes = yieldTHa / (1 - MARKET_MOISTURE[cfg.key]);
  return tonnes * p.grain - m.nRate * p.nitrogen - m.seedingRate * 10 * p.seedPer1000;
}

const ticks = (e: Ensemble) => e.years;

export function evaluate(cfg: CropConfig, loc: Location, soil: SoilParams, opt: Option, ens: Ensemble, p: Prices): Evaluation {
  const outcomes: Outcome[] = ticks(ens).map((y) => {
    const r = simulateOption(cfg, loc, soil, opt, y.weather);
    return { label: y.label, yieldTHa: r.yieldTHa, net: netReturn(cfg, opt, p, r.yieldTHa), frostKilled: r.frostKilled, matured: r.matured };
  });
  const ys = stats(outcomes.map((o) => o.yieldTHa));
  const worst = outcomes.reduce((a, b) => (b.yieldTHa < a.yieldTHa ? b : a), outcomes[0]!);
  return {
    option: opt,
    outcomes,
    yield: ys,
    net: stats(outcomes.map((o) => o.net)),
    failures: outcomes.filter((o) => o.frostKilled || o.yieldTHa < 0.5).length,
    worstYear: worst.label,
  };
}

export interface Comparison {
  /** Mean difference (b minus a) in return, $/ha, and in yield, t/ha. */
  meanNet: number;
  meanYield: number;
  /** Share of years in which b beats a by more than the tolerance, a beats b, or neither. */
  bWins: number;
  aWins: number;
  ties: number;
  /** Difference in the worst fifth of years (b minus a), $/ha. */
  worst20Net: number;
  /** "b" if b is at least as good in every year, "a" the other way round, else null. */
  everyYear: "a" | "b" | null;
  /** First-order dominance of the return distributions (ignoring which year is which). */
  distribution: "a" | "b" | null;
}

export function compare(a: Evaluation, b: Evaluation, tolerance = 5): Comparison {
  const n = Math.min(a.outcomes.length, b.outcomes.length);
  let bw = 0, aw = 0, ties = 0, bAll = true, aAll = true;
  for (let i = 0; i < n; i++) {
    const d = b.outcomes[i]!.net - a.outcomes[i]!.net;
    if (d > tolerance) bw++;
    else if (d < -tolerance) aw++;
    else ties++;
    if (d < -tolerance) bAll = false;
    if (d > tolerance) aAll = false;
  }
  const sa = a.outcomes.map((o) => o.net).sort((x, y) => x - y);
  const sb = b.outcomes.map((o) => o.net).sort((x, y) => x - y);
  const geq = (x: number[], y: number[]) => x.every((v, i) => v >= y[i]! - tolerance);
  const dist = geq(sb, sa) && sb.some((v, i) => v > sa[i]! + tolerance) ? "b" : geq(sa, sb) && sa.some((v, i) => v > sb[i]! + tolerance) ? "a" : null;
  return {
    meanNet: b.net.mean - a.net.mean,
    meanYield: b.yield.mean - a.yield.mean,
    bWins: bw / n,
    aWins: aw / n,
    ties: ties / n,
    worst20Net: b.net.worst20 - a.net.worst20,
    everyYear: bAll && bw > 0 ? "b" : aAll && aw > 0 ? "a" : null,
    distribution: dist,
  };
}

export interface NPoint {
  n: number;
  yieldMean: number;
  yieldP10: number;
  netMean: number;
  netP10: number;
}
export interface NResponse {
  points: NPoint[];
  /** Nitrogen rate with the highest mean return. */
  best: number;
  /** Rates whose mean return is within $2.5/ha (about $1/ac, the width Iowa State's MRTN range uses) of the best. */
  range: [number, number];
}

export function nResponse(cfg: CropConfig, loc: Location, soil: SoilParams, opt: Option, ens: Ensemble, p: Prices, step = 20): NResponse {
  const points: NPoint[] = [];
  for (let n = 0; n <= cfg.nMax; n += step) {
    const e = evaluate(cfg, loc, soil, { ...opt, nRate: n }, ens, p);
    points.push({ n, yieldMean: e.yield.mean, yieldP10: e.yield.p10, netMean: e.net.mean, netP10: e.net.p10 });
  }
  const top = points.reduce((a, b) => (b.netMean > a.netMean ? b : a), points[0]!);
  const near = points.filter((q) => q.netMean >= top.netMean - 2.5);
  return { points, best: top.n, range: [near[0]!.n, near[near.length - 1]!.n] };
}

/** Yield lost to each stress, t/ha, taken in this order: frost, water, heat, nitrogen. */
export interface Losses {
  potential: number;
  frost: number;
  water: number;
  heat: number;
  nitrogen: number;
  actual: number;
}

/**
 * Split one season's yield gap by switching stresses on one at a time: start with no frost, no heat damage,
 * unlimited water and nitrogen, then add frost, water limits, heat and nitrogen limits in that order.
 * Interactions fall to whichever stress is added later, so the split depends on the order; the total does not.
 */
export function lossesFor(cfg: CropConfig, loc: Location, soil: SoilParams, opt: Option, weather: Ensemble["years"][number]["weather"]): Losses {
  const y = (tw: Parameters<typeof simulateOption>[5]) => simulateOption(cfg, loc, soil, opt, weather, tw).yieldTHa;
  const y0 = y({ noFrost: true, noHeat: true, noWaterLimit: true, noNLimit: true });
  const y1 = y({ noHeat: true, noWaterLimit: true, noNLimit: true });
  const y2 = y({ noHeat: true, noNLimit: true });
  const y3 = y({ noNLimit: true });
  const y4 = y({});
  return { potential: y0, frost: y0 - y1, water: y1 - y2, heat: y2 - y3, nitrogen: y3 - y4, actual: y4 };
}

export function meanLosses(cfg: CropConfig, loc: Location, soil: SoilParams, opt: Option, ens: Ensemble): Losses {
  const rows = ens.years.map((yr) => lossesFor(cfg, loc, soil, opt, yr.weather));
  const avg = (k: keyof Losses) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  return { potential: avg("potential"), frost: avg("frost"), water: avg("water"), heat: avg("heat"), nitrogen: avg("nitrogen"), actual: avg("actual") };
}

/** Yield of an option in one synthetic hazard year ("hazard", "freeze", "dry") from the location's climate averages. */
export function stressYield(cfg: CropConfig, loc: Location, soil: SoilParams, opt: Option, scenario: string): number {
  return simulateOption(cfg, loc, soil, opt, syntheticYear(cfg, scenario, 1, loc)).yieldTHa;
}

export type Objective = "mean" | "cautious";

/**
 * Search for the plan with the best objective: mean return, or "cautious" = mean return of the worst fifth of years.
 * Staged: a grid over sowing date and maturity, then two sweeps over nitrogen, seeding rate, depth, sowing date and maturity.
 * It looks at about every third year to stay fast, so the caller should evaluate the result on every year.
 */
export async function optimize(
  cfg: CropConfig,
  loc: Location,
  soil: SoilParams,
  start: Management,
  ens: Ensemble,
  p: Prices,
  objective: Objective,
  o: { onProgress?: (done: number, total: number) => void; pause?: () => Promise<void> } = {},
): Promise<Management> {
  const every = Math.max(1, Math.floor(ens.years.length / 14));
  const sample: Ensemble = { ...ens, years: ens.years.filter((_, i) => i % every === 0) };
  const cache = new Map<string, number>();
  let evals = 0;
  const pause = o.pause ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const value = async (m: Management): Promise<number> => {
    const k = `${m.habit}|${m.sowDoy}|${m.rm}|${m.nRate}|${m.seedingRate}|${m.depthCm}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const nets = sample.years.map((yr) => netReturn(cfg, m, p, simulateOption(cfg, loc, soil, m, yr.weather).yieldTHa));
    const s = stats(nets);
    const v = objective === "mean" ? s.mean : s.worst20;
    cache.set(k, v);
    if (++evals % 20 === 0) {
      o.onProgress?.(evals, total);
      await pause();
    }
    return v;
  };
  const habits = cfg.habits ? cfg.grid.habits : [start.habit];
  const total = habits.reduce((a, h) => a + cfg.grid.sow(h).length * cfg.grid.rm.length, 0) + 2 * (cfg.grid.n.length + cfg.grid.pop.length + cfg.grid.depth.length + cfg.grid.sow(start.habit).length + cfg.grid.rm.length);

  let best = { ...start };
  let bestV = -Infinity;
  for (const habit of habits)
    for (const sowDoy of cfg.grid.sow(habit))
      for (const rm of cfg.grid.rm) {
        const m = { ...start, habit, sowDoy, rm };
        const v = await value(m);
        if (v > bestV) (best = m), (bestV = v);
      }
  type Dim = "nRate" | "seedingRate" | "depthCm" | "sowDoy" | "rm";
  const dims: [Dim, () => number[]][] = [
    ["nRate", () => cfg.grid.n],
    ["seedingRate", () => cfg.grid.pop],
    ["depthCm", () => cfg.grid.depth],
    ["sowDoy", () => cfg.grid.sow(best.habit)],
    ["rm", () => cfg.grid.rm],
  ];
  for (let sweep = 0; sweep < 2; sweep++)
    for (const [d, values] of dims)
      for (const v of [...values()].sort((a, b) => a - b)) {
        const m = { ...best, [d]: v } as Management;
        const val = await value(m);
        // a $1/ha edge is needed to move, so ties keep the cheaper, lower value for nitrogen and seed
        if (val > bestV + 1) (best = m), (bestV = val);
      }
  o.onProgress?.(total, total);
  return { sowDoy: best.sowDoy, rm: best.rm, nRate: best.nRate, seedingRate: best.seedingRate, depthCm: best.depthCm, habit: best.habit };
}
