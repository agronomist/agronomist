import { simulateOption, type Management } from "./model-run";
import { netReturn, stats, type Prices } from "./decision";
import type { CropConfig } from "./crops";
import type { Ensemble } from "./weather-years";
import type { Location } from "./locations";
import type { SoilParams } from "../index";

export interface Candidate {
  plan: Management;
  /** Average return over nitrogen and seed, $/ha. */
  meanNet: number;
  /** Average return of the worst fifth of years, $/ha. */
  worstNet: number;
  meanYield: number;
  /** Nitrogen applied, kg/ha. */
  nRate: number;
}

/**
 * Efficient plans: a plan is dropped if another is at least as good on average return, bad-year return and nitrogen
 * and strictly better on one. `better` says, for each axis, whether bigger is better.
 */
export function paretoFront<T>(items: readonly T[], axes: readonly ((t: T) => number)[], bigger: readonly boolean[]): T[] {
  const score = (t: T) => axes.map((f, i) => (bigger[i] ? f(t) : -f(t)));
  const s = items.map(score);
  return items.filter((_, i) => !s.some((o, j) => j !== i && o.every((v, k) => v >= s[i]![k]!) && o.some((v, k) => v > s[i]![k]!)));
}

/**
 * Evaluate a grid of plans around `start` (sowing date, maturity, nitrogen) on a sample of the years and keep the efficient
 * ones: those that cannot be beaten on average return, bad-year return and nitrogen at once.
 */
export async function tradeoffs(
  cfg: CropConfig,
  loc: Location,
  soil: SoilParams,
  start: Management,
  ens: Ensemble,
  p: Prices,
  o: { onProgress?: (done: number, total: number) => void; pause?: () => Promise<void>; maxPlans?: number } = {},
): Promise<Candidate[]> {
  const every = Math.max(1, Math.floor(ens.years.length / 14));
  const years = ens.years.filter((_, i) => i % every === 0);
  const pause = o.pause ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const sows = cfg.grid.sow(start.habit);
  const grid: Management[] = [];
  for (const sowDoy of sows) for (const rm of cfg.grid.rm) for (const nRate of cfg.grid.n) grid.push({ ...start, sowDoy, rm, nRate });
  const all: Candidate[] = [];
  for (const [i, plan] of grid.entries()) {
    const ys = years.map((y) => simulateOption(cfg, loc, soil, plan, y.weather).yieldTHa);
    const nets = stats(ys.map((v) => netReturn(cfg, plan, p, v)));
    all.push({ plan, meanNet: nets.mean, worstNet: nets.worst20, meanYield: stats(ys).mean, nRate: plan.nRate });
    if (i % 10 === 9) {
      o.onProgress?.(i + 1, grid.length);
      await pause();
    }
  }
  o.onProgress?.(grid.length, grid.length);
  const front = paretoFront(all, [(c) => c.meanNet, (c) => c.worstNet, (c) => c.nRate], [true, true, false]);
  // a few dozen near-identical plans help nobody: keep the spread, sorted by average return
  front.sort((a, b) => b.meanNet - a.meanNet);
  return thin(front, o.maxPlans ?? 8);
}

function thin<T>(sorted: T[], n: number): T[] {
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]!);
}
