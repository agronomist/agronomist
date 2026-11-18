import { defaultProcesses } from "./processes";
import { hybrid } from "./hybrid";
import { simulate } from "./model";
import type { CriticalPeriodReport, CropParams, Fertilizer, SoilParams, WeatherDay } from "./types";

/** How favorable were the conditions during the critical window? Each component is 0-1 (1 = ideal). */
export interface WindowConditions {
  radiation: number;
  temperature: number;
  water: number;
  nitrogen: number;
  heat: number;
  /** Product of the components: a transparent heuristic for feedback, not part of the crop model. */
  score: number;
}

export function windowConditions(
  r: CriticalPeriodReport,
  crop: CropParams,
  idealSrad = 22,
): WindowConditions {
  if (r.days === 0) return { radiation: 0, temperature: 0, water: 0, nitrogen: 0, heat: 0, score: 0 };
  const radiation = Math.min(1, r.meanSrad / idealSrad);
  // approximate daily mean temperature from mean Tmax (diurnal range assumed ~10 °C)
  const temperature = defaultProcesses.temperatureFactor(r.meanTmax - 5, crop);
  const water = r.meanWs;
  const nitrogen = r.meanNni;
  const heat = r.heatSetFactor;
  return { radiation, temperature, water, nitrogen, heat, score: radiation * temperature * water * nitrogen * heat };
}

export interface TimingRow {
  sowingOffset: number; // days after the first weather day
  sowingDoy: number;
  rm: number;
  yieldTHa: number;
  matured: boolean;
  frostKilled: boolean;
  silkingDay: number | null; // days after sowing, null if never reached
  silkingDoy: number | null;
  window: CriticalPeriodReport;
  conditions: WindowConditions;
}

export interface TimingInput {
  weather: WeatherDay[];
  crop: CropParams;
  soil: SoilParams;
  latitude?: number;
  co2?: number;
  /** Day numbers are relative to each sowing date (0 = sowing day). */
  fertilizer?: Fertilizer[];
  sowingOffsets: number[];
  /** Relative maturities (days) of candidate hybrids; see hybrid(). */
  rms: number[];
}

/** Run every (sowing date, hybrid) combination and report where the critical window landed and what it met. */
export function analyzeTimings(o: TimingInput): TimingRow[] {
  const rows: TimingRow[] = [];
  for (const off of o.sowingOffsets) {
    const weather = o.weather.slice(off);
    if (weather.length === 0) continue;
    for (const rm of o.rms) {
      const crop = hybrid(o.crop, rm);
      const r = simulate({
        weather,
        crop,
        soil: o.soil,
        latitude: o.latitude,
        co2: o.co2,
        fertilizer: o.fertilizer,
      });
      const silk = r.days.find((d) => d.dvs >= 1);
      rows.push({
        sowingOffset: off,
        sowingDoy: weather[0]!.doy,
        rm,
        yieldTHa: r.yieldTHa,
        matured: r.matured,
        frostKilled: r.frostKilled,
        silkingDay: silk?.day ?? null,
        silkingDoy: silk?.doy ?? null,
        window: r.criticalPeriod,
        conditions: windowConditions(r.criticalPeriod, crop),
      });
    }
  }
  return rows;
}

export const bestTiming = (rows: TimingRow[]): TimingRow =>
  rows.reduce((a, b) => (b.yieldTHa > a.yieldTHa ? b : a));
