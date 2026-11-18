import { tuning } from "./tuning";
import type { WeatherDay } from "../index";
import type { CropKey } from "./crops";

/**
 * Year-by-year sowing date for the state check.
 *
 * Farmers sow late after a wet or cold spring (2013, 2019), so a fixed date misstates exactly the years that matter most.
 * Observed NASS planting progress is the right input, but it is not loaded here: it could not be fetched from the build
 * environment. Until it is, `OBSERVED_SOW` below is the place for "day the state reached 50% planted", and the rule fills the gap.
 *
 * The rule is an assumption, not a fit: the default date is the median year, and the sowing date moves from it by
 * how much wetter and colder than the median year the weeks before sowing were. The two slopes were set by hand to give
 * roughly three weeks of delay in a very wet, cold spring such as 2019; they are the free numbers here.
 */
export const DELAY_PER_MM = 0.12; // days later per mm of extra rain in the window
export const DELAY_PER_DEGC = 2.5; // days later per °C colder than the median year
export const MAX_DELAY = 28;
export const MAX_ADVANCE = 7;

/** Observed day of year when a state reached 50% planted, by state, crop and harvest year. Empty until loaded from NASS. */
export const OBSERVED_SOW: Record<string, Partial<Record<CropKey, Record<number, number>>>> = {};

const WINDOW = { maize: [105, 135], soy: [115, 145] } as const; // Apr 15–May 15 and Apr 25–May 25, day of year

interface Spring { rain: number; tmean: number }

/** Rain and mean temperature of the planting window in one season (the array starts on `yearStart`). */
export function springOf(crop: "maize" | "soy", season: WeatherDay[], yearStart: number): Spring | null {
  const [a, b] = WINDOW[crop];
  const days = season.slice(Math.max(0, a - yearStart), b - yearStart + 1);
  if (days.length < 20) return null;
  return {
    rain: days.reduce((s, d) => s + d.rain, 0),
    tmean: days.reduce((s, d) => s + (d.tmax + d.tmin) / 2, 0) / days.length,
  };
}

const median = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Sowing day for each season label; the median season gets `baseDoy`. Winter wheat and short records keep `baseDoy`. */
export function sowingDays(
  crop: CropKey,
  state: string,
  seasons: { label: number; weather: WeatherDay[] }[],
  yearStart: number,
  baseDoy: number,
): Map<number, { doy: number; source: "observed" | "rule" | "fixed" }> {
  const out = new Map<number, { doy: number; source: "observed" | "rule" | "fixed" }>();
  const springs = crop === "wheat" ? [] : seasons.map((s) => ({ label: s.label, sp: springOf(crop, s.weather, yearStart) }));
  const ok = springs.filter((s): s is { label: number; sp: Spring } => s.sp !== null);
  const rain0 = ok.length >= 10 ? median(ok.map((s) => s.sp.rain)) : NaN;
  const temp0 = ok.length >= 10 ? median(ok.map((s) => s.sp.tmean)) : NaN;
  for (const s of seasons) {
    const seen = OBSERVED_SOW[state]?.[crop]?.[s.label];
    if (seen !== undefined) { out.set(s.label, { doy: seen, source: "observed" }); continue; }
    const sp = ok.find((x) => x.label === s.label)?.sp;
    if (!sp || Number.isNaN(rain0)) { out.set(s.label, { doy: baseDoy, source: "fixed" }); continue; }
    const delay = tuning.delayPerMm * (sp.rain - rain0) + tuning.delayPerDegC * (temp0 - sp.tmean);
    out.set(s.label, { doy: Math.round(baseDoy + Math.max(-MAX_ADVANCE, Math.min(MAX_DELAY, delay))), source: "rule" });
  }
  return out;
}
