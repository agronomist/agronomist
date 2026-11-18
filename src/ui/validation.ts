import type { CropKey } from "./crops";

/**
 * State-average yields from USDA NASS, bushels per acre, for the years a published figure was found.
 * Iowa corn: 2012 to 2018 from NASS via Iowa Farm Bureau / Farm Progress / Iowa State (2018 is the final NASS estimate of 196, not the 198 forecast);
 * 2021 to 2024 from NASS crop reports. Kansas wheat: NASS Kansas Wheat History (2024 is 43, the NASS history table).
 * Years not verified against a NASS document are left out on purpose.
 */
export const NASS: Record<CropKey, { place: string; location: string; years: Record<number, number> }> = {
  maize: {
    place: "Iowa corn",
    location: "iowa",
    years: { 2012: 137, 2013: 165, 2014: 178, 2015: 192, 2016: 203, 2017: 202, 2018: 196, 2021: 205, 2022: 200, 2023: 201, 2024: 211 },
  },
  soy: {
    place: "Iowa soybeans",
    location: "iowa",
    // Iowa Soybean Association's table of NASS state yields (2021 is the NASS figure of 62; later revisions put it near 63)
    years: { 2012: 45, 2013: 45.5, 2014: 51.5, 2015: 56.5, 2016: 60.5, 2017: 56.5, 2018: 57, 2019: 55, 2020: 53, 2021: 62, 2022: 58.5, 2023: 58, 2024: 60 },
  },
  wheat: {
    place: "Kansas winter wheat",
    location: "kansas",
    years: { 2014: 28, 2015: 37, 2016: 57, 2017: 48, 2018: 38, 2019: 52, 2020: 45, 2021: 52, 2022: 37, 2023: 35, 2024: 43 },
  },
};

/** bu/ac to t/ha of dry grain: 56 lb bushel at 15.5% moisture for corn, 60 lb at 13.5% for wheat and 13% for soybeans. */
export const buAcToDryTHa = (crop: CropKey, bu: number) =>
  crop === "maize" ? bu * 0.062766 * (1 - 0.155) : crop === "soy" ? bu * 0.067253 * (1 - 0.13) : bu * 0.067253 * (1 - 0.135);

export interface ValidationRow {
  year: number;
  observed: number; // t/ha dry
  modelled: number;
  /** Departure from the trend line (observed) or from the mean (model), as a fraction. */
  obsAnomaly: number;
  modAnomaly: number;
}

export interface ValidationResult {
  rows: ValidationRow[];
  meanObserved: number;
  meanModelled: number;
  /** Pearson correlation of the two anomaly series, NaN with fewer than 4 points. */
  r: number;
  /** Mean absolute difference of anomalies, as a fraction. */
  mae: number;
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * Compare modelled weather-driven yield with state averages. Observed yields carry a technology trend the model does not
 * have, so both are turned into departures first: observed from its linear trend, modelled from its own mean.
 */
export function validate(crop: CropKey, modelled: Map<number, number>): ValidationResult | null {
  const obs = NASS[crop].years;
  const years = Object.keys(obs).map(Number).filter((y) => modelled.has(y)).sort((a, b) => a - b);
  if (years.length < 4) return null;
  const o = years.map((y) => buAcToDryTHa(crop, obs[y]!));
  const m = years.map((y) => modelled.get(y)!);
  const ym = mean(years), om = mean(o);
  const slope = years.reduce((s, y, i) => s + (y - ym) * (o[i]! - om), 0) / years.reduce((s, y) => s + (y - ym) ** 2, 0);
  const trend = (y: number) => om + slope * (y - ym);
  const mm = mean(m);
  const rows = years.map((y, i) => ({ year: y, observed: o[i]!, modelled: m[i]!, obsAnomaly: o[i]! / trend(y) - 1, modAnomaly: m[i]! / mm - 1 }));
  const a = rows.map((r) => r.obsAnomaly), b = rows.map((r) => r.modAnomaly);
  const am = mean(a), bm = mean(b);
  const cov = a.reduce((s, x, i) => s + (x - am) * (b[i]! - bm), 0);
  const r = cov / Math.sqrt(a.reduce((s, x) => s + (x - am) ** 2, 0) * b.reduce((s, x) => s + (x - bm) ** 2, 0));
  return { rows, meanObserved: om, meanModelled: mm, r, mae: mean(rows.map((x) => Math.abs(x.obsAnomaly - x.modAnomaly))) };
}
