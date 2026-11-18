import type { WeatherDay } from "../types";
import { getJson, type HttpOptions } from "./http";
import { openMeteoUrl, parseOpenMeteo } from "./openmeteo";

/**
 * Daily weather by calendar year at one point. Years are 365 days long: 29 February is dropped so every year lines up
 * day for day (the model's calendar has no leap day either). `doy` is relabelled 1..365 by position.
 */
export interface History {
  /** Complete calendar years. */
  years: Map<number, WeatherDay[]>;
  /** The latest year if the archive only reaches part of it: days from 1 January up to the last day available. */
  partial?: { year: number; days: WeatherDay[] };
}

/** Group a flat daily record (ISO dates in `times`, same length as `days`) into a History. */
export function buildHistory(times: readonly string[], days: readonly WeatherDay[]): History {
  if (times.length !== days.length) throw new Error("times and days differ in length");
  const byYear = new Map<number, { first: string; list: WeatherDay[] }>();
  times.forEach((t, i) => {
    if (t.slice(5) === "02-29") return;
    const y = Number(t.slice(0, 4));
    let e = byYear.get(y);
    if (!e) byYear.set(y, (e = { first: t, list: [] }));
    e.list.push({ ...days[i]!, doy: e.list.length + 1 });
  });
  const years = new Map<number, WeatherDay[]>();
  let partial: History["partial"];
  const latest = Math.max(...byYear.keys());
  for (const [y, e] of byYear) {
    if (e.list.length === 365 && e.first.slice(5) === "01-01") years.set(y, e.list);
    else if (y === latest && e.first.slice(5) === "01-01") partial = { year: y, days: e.list };
    // any other incomplete year (a gap inside the record) is ignored
  }
  return partial ? { years, partial } : { years };
}

/** Cut the trailing days the archive has not filled yet (null temperature or radiation), so gap filling never sees an open end. */
function trimTrailingNulls(json: unknown): unknown {
  const j = json as { daily?: Record<string, unknown[]> };
  const d = j?.daily;
  if (!d || !Array.isArray(d.time)) return json;
  const need = ["temperature_2m_max", "temperature_2m_min", "shortwave_radiation_sum"];
  let n = d.time.length;
  while (n > 0 && need.some((k) => !Array.isArray(d[k]) || d[k]![n - 1] === null || d[k]![n - 1] === undefined)) n--;
  if (n === d.time.length) return json;
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? v.slice(0, n) : v;
  return { ...(json as object), daily: out };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Daily weather from `firstYear` to about a week ago, fetched in chunks of up to 12 years in parallel.
 * The archive lags real time by a few days, so the end date is `now` minus `lagDays`.
 */
export async function fetchHistory(
  lat: number,
  lon: number,
  o: HttpOptions & { firstYear?: number; now?: Date; lagDays?: number } = {},
): Promise<History> {
  const now = o.now ?? new Date();
  const end = new Date(now.getTime() - (o.lagDays ?? 7) * 86400000);
  const first = o.firstYear ?? 1991;
  const lastYear = end.getUTCFullYear();
  const jobs: Promise<{ times: string[]; days: WeatherDay[] }>[] = [];
  for (let y = first; y <= lastYear; y += 12) {
    const y1 = Math.min(lastYear, y + 11);
    const endDate = y1 === lastYear ? iso(end) : `${y1}-12-31`;
    jobs.push(
      getJson(openMeteoUrl(lat, lon, `${y}-01-01`, endDate), o).then((raw) => {
        const json = trimTrailingNulls(raw);
        const times = (json as { daily: { time: string[] } }).daily.time;
        return { times, days: times.length ? parseOpenMeteo(json) : [] };
      }),
    );
  }
  const parts = await Promise.all(jobs);
  return buildHistory(
    parts.flatMap((p) => p.times),
    parts.flatMap((p) => p.days),
  );
}

/** One real day, looked up by calendar year and position in the year (0..364). */
export type DaySource = (year: number, idx: number) => WeatherDay | undefined;

export const sourceOf = (h: History): DaySource => (year, idx) => h.years.get(year)?.[idx] ?? (h.partial && h.partial.year === year ? h.partial.days[idx] : undefined);

/**
 * How a crop's model season sits on the calendar. The model's timeline starts on model day `yearStart` and runs
 * `yearDays` days; `shift` is the number of days between the model calendar and the real one (182 in the southern
 * hemisphere, so the model's northern calendar is mirrored).
 */
export interface SeasonSpec {
  yearStart: number;
  yearDays: number;
  shift: number;
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Position of model-timeline day i on the real calendar, as days since 1 January of `startYear`. */
const offsetOf = (spec: SeasonSpec, i: number) => spec.yearStart - 1 - spec.shift + i;

/** Season label: the calendar year that holds the middle of the season (the harvest year for both crops). */
export function seasonLabel(spec: SeasonSpec, startYear: number): number {
  return startYear + floorDiv(offsetOf(spec, Math.floor(spec.yearDays / 2)), 365);
}
export const seasonStartYear = (spec: SeasonSpec, label: number): number => label - floorDiv(offsetOf(spec, Math.floor(spec.yearDays / 2)), 365);

/** Real calendar position (year, index 0..364) of model-timeline day i. */
export function realDay(spec: SeasonSpec, label: number, i: number): { year: number; idx: number } {
  const L = offsetOf(spec, i);
  return { year: seasonStartYear(spec, label) + floorDiv(L, 365), idx: mod(L, 365) };
}

/**
 * The model weather array for a season, starting on model day `yearStart`; null if any day is missing.
 * Days are relabelled with the model calendar's day of year, as the synthetic generator does.
 */
export function seasonDays(spec: SeasonSpec, label: number, src: DaySource): WeatherDay[] | null {
  const out: WeatherDay[] = [];
  for (let i = 0; i < spec.yearDays; i++) {
    const { year, idx } = realDay(spec, label, i);
    const d = src(year, idx);
    if (!d) return null;
    out.push({ ...d, doy: mod(spec.yearStart + i - 1, 365) + 1 });
  }
  return out;
}

/** Season labels for which a complete season is available. */
export function availableSeasons(spec: SeasonSpec, src: DaySource, from: number, to: number): number[] {
  const out: number[] = [];
  for (let label = from; label <= to; label++) if (seasonDays(spec, label, src)) out.push(label);
  return out;
}
