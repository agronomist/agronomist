import type { WeatherDay } from "./types";

/** Small deterministic PRNG (mulberry32) so tests and demos are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  days?: number;
  startDoy?: number;
  tmeanSeason?: number; // °C
  sradMean?: number; // MJ m-2 d-1
  /** Mean rain per day in mm (rain falls on ~rainProb of days) */
  rainMean?: number;
  rainProb?: number;
  seed?: number;
  /** Add this many °C to every day (for heat-sensitivity tests) */
  warming?: number;
}

/** Simple synthetic weather for tests and demos (NOT a calibrated generator). */
export function syntheticWeather(o: SyntheticOptions = {}): WeatherDay[] {
  const n = o.days ?? 200;
  const rand = rng(o.seed ?? 1);
  const out: WeatherDay[] = [];
  const tmean = o.tmeanSeason ?? 22;
  const rainDay = o.rainProb ?? 0.3;
  const rainMean = o.rainMean ?? 4; // mm/day average
  for (let i = 0; i < n; i++) {
    const doy = (((o.startDoy ?? 120) + i - 1) % 365) + 1;
    const wiggle = (rand() - 0.5) * 6;
    const t = tmean + wiggle + (o.warming ?? 0);
    const srad = Math.max(4, (o.sradMean ?? 20) + (rand() - 0.5) * 10);
    const rains = rand() < rainDay;
    const rain = rains ? (-Math.log(1 - rand()) * rainMean) / rainDay : 0;
    out.push({ doy, tmax: t + 5, tmin: t - 5, srad, rain });
  }
  return out;
}

export interface SeasonalOptions {
  startDoy?: number;
  days?: number;
  seed?: number;
  /** Annual mean and amplitude of daily mean temperature (°C); peaks on peakDoy. */
  tmeanAnnual?: number;
  tmeanAmp?: number;
  peakDoy?: number;
  /** Mean and seasonal amplitude of daily radiation (MJ m-2 d-1); peaks near the solstice. */
  sradMean?: number;
  sradAmp?: number;
  rainProb?: number;
  rainMean?: number; // mean mm per day
  /** Seasonality of rain: mean rain on day d is rainMean * (1 + rainAmp * cos(2π(d - rainPeakDoy)/365)). Default 0 (even through the year). */
  rainAmp?: number;
  rainPeakDoy?: number;
  /** Add °C to Tmax and Tmin between these days of year (inclusive). */
  heatWave?: { startDoy: number; endDoy: number; addC: number };
  /** No rain between these days of year (inclusive). */
  drySpell?: { startDoy: number; endDoy: number };
}

/**
 * Synthetic Northern-Hemisphere season with a real annual cycle, for testing sowing-date effects.
 * Not a calibrated generator. Defaults give cold springs/autumns (frost-prone) and a warm summer.
 */
export function seasonalWeather(o: SeasonalOptions = {}): WeatherDay[] {
  const n = o.days ?? 280;
  const start = o.startDoy ?? 90;
  const rand = rng(o.seed ?? 1);
  const tAnn = o.tmeanAnnual ?? 11;
  const tAmp = o.tmeanAmp ?? 13;
  const peak = o.peakDoy ?? 200;
  const sMean = o.sradMean ?? 15;
  const sAmp = o.sradAmp ?? 7;
  const rainProb = o.rainProb ?? 0.3;
  const rainMean = o.rainMean ?? 3;
  const rainAmp = Math.min(0.95, Math.max(0, o.rainAmp ?? 0));
  const rainPeak = o.rainPeakDoy ?? 172;
  const within = (doy: number, r?: { startDoy: number; endDoy: number }) => !!r && doy >= r.startDoy && doy <= r.endDoy;
  const out: WeatherDay[] = [];
  for (let i = 0; i < n; i++) {
    const doy = ((start + i - 1) % 365) + 1;
    let t = tAnn + tAmp * Math.cos((2 * Math.PI * (doy - peak)) / 365) + (rand() - 0.5) * 6;
    if (within(doy, o.heatWave)) t += o.heatWave!.addC;
    const srad = Math.max(3, sMean + sAmp * Math.cos((2 * Math.PI * (doy - 172)) / 365) + (rand() - 0.5) * 8);
    // always draw both numbers so hazards (dry spell, heat wave) never shift the random sequence;
    // scenarios that differ only by a hazard are then identical elsewhere
    const u1 = rand();
    const u2 = rand();
    // seasonal rain: wetter seasons have both more rainy days and heavier rain on them (mean per day follows the cycle)
    const c = rainAmp * Math.cos((2 * Math.PI * (doy - rainPeak)) / 365);
    const pDay = Math.min(0.9, rainProb * (1 + c / 2));
    const rains = u1 < pDay && !within(doy, o.drySpell);
    const rain = rains ? (-Math.log(1 - u2) * rainMean * (1 + c)) / pDay : 0;
    out.push({ doy, tmax: t + 5, tmin: t - 5, srad, rain });
  }
  return out;
}
