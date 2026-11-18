import type { WeatherDay } from "../index";
import type { History } from "../data/history";
import type { SoilPointProfile } from "../data/soilgrids";
import { fetchedHistories, seedHistory } from "./ensemble";
import { fetchedSoilProfiles, seedSoilProfile } from "./state-check";

/**
 * A saved copy of every weather record and soil profile the state check fetched, so the whole check can be re-run
 * offline (in tests, or in a sandbox with no network). Weather is stored column by column and rounded to 0.1.
 */
const FIELDS = ["tmax", "tmin", "srad", "rain", "dewpoint", "et0"] as const;
type Cols = Record<string, number[]>;
export interface Snapshot {
  version: 1;
  created: string;
  weather: Record<string, { years: Record<string, Cols>; partial?: { year: number; cols: Cols } }>;
  soil: Record<string, SoilPointProfile>;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
function pack(days: WeatherDay[]): Cols {
  const out: Cols = {};
  for (const f of FIELDS) if (days.some((d) => d[f] !== undefined)) out[f] = days.map((d) => r1(d[f] ?? NaN));
  return out;
}
function unpack(c: Cols, doyOf: (i: number) => number): WeatherDay[] {
  const n = c.tmax!.length;
  return Array.from({ length: n }, (_, i) => {
    const d: WeatherDay = { doy: doyOf(i), tmax: c.tmax![i]!, tmin: c.tmin![i]!, srad: c.srad![i]!, rain: c.rain![i]! };
    if (c.dewpoint && !Number.isNaN(c.dewpoint[i]!)) d.dewpoint = c.dewpoint[i];
    if (c.et0 && !Number.isNaN(c.et0[i]!)) d.et0 = c.et0[i];
    return d;
  });
}

export async function buildSnapshot(): Promise<Snapshot> {
  const weather: Snapshot["weather"] = {};
  for (const [k, h] of await fetchedHistories()) {
    const years: Record<string, Cols> = {};
    for (const [y, days] of h.years) years[y] = pack(days);
    weather[k] = { years, ...(h.partial ? { partial: { year: h.partial.year, cols: pack(h.partial.days) } } : {}) };
  }
  const soil: Snapshot["soil"] = {};
  for (const [k, s] of fetchedSoilProfiles()) soil[k] = s;
  return { version: 1, created: new Date().toISOString(), weather, soil };
}

/** Load a snapshot into the caches. Returns how many weather records and soil profiles it held. */
export function loadSnapshot(s: Snapshot): { weather: number; soil: number } {
  if (s.version !== 1) throw new Error("unknown snapshot version");
  for (const [k, w] of Object.entries(s.weather)) {
    const [lat, lon] = k.split(",").map(Number) as [number, number];
    const h: History = { years: new Map(Object.entries(w.years).map(([y, c]) => [Number(y), unpack(c, (i) => i + 1)])) };
    if (w.partial) h.partial = { year: w.partial.year, days: unpack(w.partial.cols, (i) => i + 1) };
    seedHistory(lat, lon, h);
  }
  for (const [k, p] of Object.entries(s.soil)) {
    const [lat, lon] = k.split(",").map(Number) as [number, number];
    seedSoilProfile(lat, lon, p);
  }
  return { weather: Object.keys(s.weather).length, soil: Object.keys(s.soil).length };
}
