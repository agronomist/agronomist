import type { SoilParams, WeatherDay } from "./types";
import { defaultProcesses } from "./processes";

/**
 * Surface water, snow and fallow-soil water before sowing.
 * Runoff is the SCS curve-number method with the curve moved by how wet the top soil is (dry soil takes more of a storm);
 * snow is a degree-day store (precipitation below 0 °C waits, then melts at `ddf` mm per °C-day above 0).
 */

/** Retention S (mm) for a curve number. */
const retention = (cn: number) => 25400 / cn - 254;

/**
 * Runoff, mm, from one day's liquid input. `wetness` is the relative water content of the top soil (0 = at wilting, 1 = at field capacity or wetter):
 * the retention is scaled from 1.6x (dry) to 0.6x (wet) of its average-condition value, about the usual CN I to CN III range.
 */
export function runoffMm(liquid: number, cn: number, wetness: number): number {
  if (liquid <= 0) return 0;
  const w = Math.min(1, Math.max(0, wetness));
  const S = retention(cn) * (1.6 - w);
  const ia = 0.2 * S;
  return liquid > ia ? (liquid - ia) ** 2 / (liquid - ia + S) : 0;
}

/** One day of the snow store: returns the new store and the liquid water reaching the soil. */
export function snowStep(store: number, w: WeatherDay, ddf: number): { store: number; liquid: number } {
  const tmean = (w.tmax + w.tmin) / 2;
  if (tmean <= 0) return { store: store + w.rain, liquid: 0 };
  const melt = Math.min(store, ddf * tmean);
  return { store: store - melt, liquid: w.rain + melt };
}

export interface FallowOptions {
  /** Relative plant-available water in every layer at the first day (0 to 1). */
  startFraction: number;
  /** Curve number for runoff; unset = no runoff. */
  runoffCN?: number;
  /** Degree-day factor for snow, mm per °C-day; unset = rain is never held as snow. */
  snowDegreeDay?: number;
}

/**
 * Bare, cropless soil through `days`: rain (or melt) infiltrates through the layers with the same drainage rule as the crop
 * model, the top layer dries by evaporation. Returns the water held in each layer, mm, on the day after the last one. Mineral nitrogen is not moved.
 */
export function fallowWater(soil: SoilParams, days: readonly WeatherDay[], o: FallowOptions): number[] {
  const L = soil.layers;
  const fc = L.map((l) => l.fieldCapacity * l.thickness);
  const wp = L.map((l) => l.wiltingPoint * l.thickness);
  const airDry1 = 0.5 * wp[0]!;
  const sw = L.map((_, i) => wp[i]! + o.startFraction * (fc[i]! - wp[i]!));
  const dF = Math.min(1, Math.max(0, soil.drainFraction ?? 1));
  const poro = soil.extraPorosity ?? 0.12;
  let snow = 0;
  for (const w of days) {
    let liquid = w.rain;
    if (o.snowDegreeDay !== undefined) {
      const s = snowStep(snow, w, o.snowDegreeDay);
      snow = s.store;
      liquid = s.liquid;
    }
    if (o.runoffCN !== undefined) liquid -= runoffMm(liquid, o.runoffCN, (sw[0]! - wp[0]!) / (fc[0]! - wp[0]!));
    let inflow = liquid;
    for (let l = 0; l < L.length; l++) {
      sw[l]! += inflow;
      const sat = fc[l]! + poro * L[l]!.thickness;
      const over = Math.max(0, sw[l]! - sat);
      const held = Math.max(0, Math.min(sw[l]!, sat) - fc[l]!);
      const excess = dF >= 1 ? Math.max(0, sw[l]! - fc[l]!) : over + dF * held;
      sw[l]! -= excess;
      inflow = excess;
    }
    const relTop = (sw[0]! - wp[0]!) / (fc[0]! - wp[0]!);
    const evap = Math.min(Math.max(0, sw[0]! - airDry1), defaultProcesses.referenceET(w) * Math.min(1, Math.max(0, relTop / 0.5)));
    sw[0]! -= evap;
  }
  return sw;
}
