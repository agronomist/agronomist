import type { WeatherDay } from "../types";
import type { History } from "./history";

/** Weather stored column by column and rounded to 0.1, which is about a fifth of the size of the day-by-day objects. */
const FIELDS = ["tmax", "tmin", "srad", "rain", "dewpoint", "et0"] as const;
export type Cols = Record<string, number[]>;
const r1 = (x: number) => Math.round(x * 10) / 10;
export function pack(days: WeatherDay[]): Cols {
  const out: Cols = {};
  for (const f of FIELDS) if (days.some((d) => d[f] !== undefined)) out[f] = days.map((d) => r1(d[f] ?? NaN));
  return out;
}
export function unpack(c: Cols, doyOf: (i: number) => number): WeatherDay[] {
  const n = c.tmax!.length;
  return Array.from({ length: n }, (_, i) => {
    const d: WeatherDay = { doy: doyOf(i), tmax: c.tmax![i]!, tmin: c.tmin![i]!, srad: c.srad![i]!, rain: c.rain![i]! };
    if (c.dewpoint && !Number.isNaN(c.dewpoint[i]!)) d.dewpoint = c.dewpoint[i];
    if (c.et0 && !Number.isNaN(c.et0[i]!)) d.et0 = c.et0[i];
    return d;
  });
}


export interface PackedHistory {
  years: Record<string, Cols>;
  partial?: { year: number; cols: Cols };
}
export function packHistory(h: History): PackedHistory {
  const years: Record<string, Cols> = {};
  for (const [y, days] of h.years) years[y] = pack(days);
  return { years, ...(h.partial ? { partial: { year: h.partial.year, cols: pack(h.partial.days) } } : {}) };
}
export function unpackHistory(w: PackedHistory): History {
  const h: History = { years: new Map(Object.entries(w.years).map(([y, c]) => [Number(y), unpack(c, (i) => i + 1)])) };
  if (w.partial) h.partial = { year: w.partial.year, days: unpack(w.partial.cols, (i) => i + 1) };
  return h;
}
