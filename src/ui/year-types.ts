import type { DayOutput } from "../types";

/**
 * Season types by water supply against demand (the model's water stress factor, 1 = demand met), after Messina et al. 2017.
 * Flowering is the critical window, so a dip there counts for more than the same dip in grain fill.
 */
export type YearType = "none" | "flowering-severe" | "flowering-moderate" | "late";

export const YEAR_TYPES: { key: YearType; label: string; hint: string }[] = [
  { key: "none", label: "Little water stress", hint: "Supply met demand through flowering and grain fill." },
  { key: "flowering-moderate", label: "Moderate stress at flowering", hint: "Supply was 60 to 85% of demand around flowering." },
  { key: "flowering-severe", label: "Severe stress at flowering", hint: "Supply was under 60% of demand around flowering." },
  { key: "late", label: "Stress in grain fill", hint: "Flowering was fine, but supply fell under 85% of demand afterwards." },
];

export interface SupplyDemand {
  /** Mean supply/demand ratio from 0.9 to 1.2 on the development scale (the weeks around silking or flowering). */
  flowering: number;
  /** Mean ratio from 1.2 to maturity. */
  fill: number;
  type: YearType;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 1);

export function supplyDemand(days: DayOutput[]): SupplyDemand {
  const fl = days.filter((d) => d.dvs >= 0.9 && d.dvs < 1.2).map((d) => d.ws);
  const gf = days.filter((d) => d.dvs >= 1.2 && d.dvs <= 2).map((d) => d.ws);
  const flowering = mean(fl);
  const fill = mean(gf);
  const type: YearType = flowering < 0.6 ? "flowering-severe" : flowering < 0.85 ? "flowering-moderate" : fill < 0.85 ? "late" : "none";
  return { flowering, fill, type };
}

export interface TypeRow {
  key: YearType;
  label: string;
  hint: string;
  years: number;
  share: number;
  meanYield: number;
  /** Years that fell in this type, by label. */
  labels: number[];
}

/** Share of seasons and mean yield in every type. Types with no seasons are kept with zero so rows line up between plans. */
export function summariseTypes(items: { label: number; yieldTHa: number; sd?: SupplyDemand }[]): TypeRow[] {
  const n = items.length || 1;
  return YEAR_TYPES.map((t) => {
    const m = items.filter((i) => i.sd?.type === t.key);
    return { ...t, years: m.length, share: m.length / n, meanYield: m.length ? mean(m.map((i) => i.yieldTHa)) : 0, labels: m.map((i) => i.label) };
  });
}
