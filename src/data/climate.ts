import type { WeatherDay } from "../types";
import type { HttpOptions } from "./http";
import { fetchWeather } from "./openmeteo";

/** The averages the viewer's synthetic-year generator needs. */
export interface ClimateFit {
  tmeanAnnual: number;
  tmeanAmp: number;
  /** Day of year when daily mean temperature peaks. */
  peakDoy: number;
  sradMean: number;
  sradAmp: number;
  /** Mean rain, mm per day, over the whole record. */
  rainMean: number;
  /** Seasonal swing of rain as a fraction of the mean (first harmonic, 0 to 0.9) and the day of year it peaks. */
  rainAmp: number;
  rainPeakDoy: number;
  years: number;
}

const W = (2 * Math.PI) / 365;

/**
 * Fit the generator's annual cycle to a daily record of any length: average each day of year across
 * years, then take the first harmonic of daily mean temperature (free phase) and of radiation (phase
 * fixed at the solstice, as in the generator). Rain is the plain mean. Day 366 folds into 365.
 * `shiftDays` moves every day of year forward before fitting (southern sites use half a year, so the record looks northern).
 */
export function fitClimate(days: readonly WeatherDay[], shiftDays = 0): ClimateFit {
  if (days.length < 365) throw new Error("Need at least a year of daily weather to fit a climate");
  const t = new Array<number>(365).fill(0);
  const s = new Array<number>(365).fill(0);
  const n = new Array<number>(365).fill(0);
  const r = new Array<number>(365).fill(0);
  let rain = 0;
  for (const d of days) {
    const i = ((((Math.min(365, Math.max(1, d.doy)) - 1 + shiftDays) % 365) + 365) % 365);
    t[i]! += (d.tmax + d.tmin) / 2;
    s[i]! += d.srad;
    r[i]! += d.rain;
    n[i]! += 1;
    rain += d.rain;
  }
  const used = n.filter((x) => x > 0).length;
  if (used < 350) throw new Error("Weather record does not cover the whole year");
  let tMean = 0, sMean = 0;
  for (let i = 0; i < 365; i++) {
    if (n[i]! > 0) {
      t[i]! /= n[i]!;
      s[i]! /= n[i]!;
      r[i]! /= n[i]!;
    } else {
      t[i] = t[i - 1] ?? t[i + 1] ?? 0; // rare uncovered day: carry the neighbour
      s[i] = s[i - 1] ?? s[i + 1] ?? 0;
      r[i] = r[i - 1] ?? r[i + 1] ?? 0;
    }
    tMean += t[i]! / 365;
    sMean += s[i]! / 365;
  }
  let a = 0, b = 0, sa = 0, ra = 0, rb = 0;
  const rMean = r.reduce((x, y) => x + y, 0) / 365;
  for (let i = 0; i < 365; i++) {
    const doy = i + 1;
    ra += ((2 / 365) * (r[i]! - rMean)) * Math.cos(W * doy);
    rb += ((2 / 365) * (r[i]! - rMean)) * Math.sin(W * doy);
    a += ((2 / 365) * (t[i]! - tMean)) * Math.cos(W * doy);
    b += ((2 / 365) * (t[i]! - tMean)) * Math.sin(W * doy);
    sa += ((2 / 365) * (s[i]! - sMean)) * Math.cos(W * (doy - 172));
  }
  const peak = ((Math.atan2(b, a) / W) % 365 + 365) % 365;
  return {
    tmeanAnnual: tMean,
    tmeanAmp: Math.hypot(a, b),
    peakDoy: peak,
    sradMean: sMean,
    sradAmp: Math.max(0, sa),
    rainMean: rain / days.length,
    // daily rain is noisy even after averaging years, so the fitted swing is capped at what a seasonal climate can show
    rainAmp: rMean > 0 ? Math.min(0.9, Math.hypot(ra, rb) / rMean) : 0,
    rainPeakDoy: ((Math.atan2(rb, ra) / W) % 365 + 365) % 365,
    years: days.length / 365.25,
  };
}

/** Ten recent full years of daily weather at a point, fitted to the generator's parameters. */
export async function fetchClimate(lat: number, lon: number, o: HttpOptions = {}, shiftDays = 0, firstYear = 2015, lastYear = 2024): Promise<ClimateFit> {
  const days = await fetchWeather(lat, lon, `${firstYear}-01-01`, `${lastYear}-12-31`, o);
  return fitClimate(days, shiftDays);
}
