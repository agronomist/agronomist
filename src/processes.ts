import type { CropParams, Table, WeatherDay } from "./types";

/**
 * Swappable process modules. Each is a pure function, so an improved
 * representation (e.g. photosynthesis-based growth, heat stress on grain set)
 * can replace a default without touching the rest of the model.
 */
export interface ProcessSet {
  /** Daily thermal time (°C d) */
  thermalTime(w: WeatherDay, p: CropParams): number;
  /** Fraction of incident light intercepted by the canopy */
  lightInterception(lai: number, p: CropParams): number;
  /** Growth temperature response, 0-1 */
  temperatureFactor(tmean: number, p: CropParams): number;
  /** New dry matter, g m-2 d-1 */
  dailyGrowth(args: {
    srad: number;
    fi: number;
    tempFactor: number;
    ws: number;
    p: CropParams;
  }): number;
  /** Reference ET, mm d-1 */
  referenceET(w: WeatherDay): number;
  /** Astronomical daylength (h) from day of year and latitude (degrees) */
  daylength(doy: number, latitudeDeg: number): number;
  /** Effective vernalization days gained today (0-1) at this daily mean temperature */
  vernalizationRate(tmean: number): number;
  /** Multiplier (<=1) on vegetative development rate from daylength */
  photoperiodFactor(daylengthH: number, p: CropParams): number;
  /** Maintenance respiration, g DM m-2 d-1, from living non-storage biomass */
  maintenanceRespiration(args: { tmean: number; livingBiomass: number; p: CropParams }): number;
  /** Critical shoot N concentration (%) for shoot biomass in t/ha */
  criticalN(shootTHa: number, p: CropParams): number;
  /** CO2 multipliers on assimilation and on transpiration demand */
  co2Effects(co2: number, p: CropParams): { assimilation: number; transpiration: number };
}

export function interpolate(table: Table, x: number): number {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1]!;
    const b = table[i]!;
    if (x <= b[0]) return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return last[1];
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Standard maize growing-degree-day method with base and ceiling (no photoperiod yet). */
const thermalTime: ProcessSet["thermalTime"] = (w, p) => {
  const tmax = clamp(w.tmax, p.tBase, p.tCeil);
  const tmin = clamp(w.tmin, p.tBase, p.tCeil);
  return Math.max(0, (tmax + tmin) / 2 - p.tBase);
};

/** Beer-Lambert interception. */
const lightInterception: ProcessSet["lightInterception"] = (lai, p) => 1 - Math.exp(-p.k * lai);

/** Trapezoidal response: 0 below Tmin, 1 between Topt1 and Topt2, 0 above Tmax. */
const temperatureFactor: ProcessSet["temperatureFactor"] = (t, p) => {
  const [tmin, topt1, topt2, tmax] = p.tempResponse;
  if (t <= tmin || t >= tmax) return 0;
  if (t < topt1) return (t - tmin) / (topt1 - tmin);
  if (t <= topt2) return 1;
  return (tmax - t) / (tmax - topt2);
};

/** Radiation-use-efficiency growth, scaled by temperature and water stress. */
const dailyGrowth: ProcessSet["dailyGrowth"] = ({ srad, fi, tempFactor, ws, p }) =>
  p.rue * p.parFraction * srad * fi * tempFactor * ws;

/**
 * Priestley-Taylor ET0 with a crude net-radiation approximation (Rn ~ 0.6 * Rs).
 * This is a placeholder; replace with FAO-56 Penman-Monteith when wind/humidity exist.
 */
const referenceET: ProcessSet["referenceET"] = (w) => {
  if (w.et0 !== undefined) return w.et0;
  const tmean = (w.tmax + w.tmin) / 2;
  // slope of saturation vapour pressure curve (kPa/°C)
  const es = 0.6108 * Math.exp((17.27 * tmean) / (tmean + 237.3));
  const delta = (4098 * es) / (tmean + 237.3) ** 2;
  const gamma = 0.066;
  const lambda = 2.45; // MJ/kg
  const rn = 0.6 * w.srad;
  return Math.max(0, (1.26 * (delta / (delta + gamma)) * rn) / lambda);
};

const daylength: ProcessSet["daylength"] = (doy, latDeg) => {
  const lat = (latDeg * Math.PI) / 180;
  const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const x = clamp(-Math.tan(lat) * Math.tan(decl), -1, 1);
  return (24 / Math.PI) * Math.acos(x);
};

const photoperiodFactor: ProcessSet["photoperiodFactor"] = (dl, p) => {
  const excess = p.photoperiodType === "long" ? Math.max(0, p.photoperiodCritical - dl) : Math.max(0, dl - p.photoperiodCritical);
  return clamp(1 - p.photoperiodSensitivity * excess, p.photoperiodMinFactor, 1);
};

/** Trapezoid in daily mean temperature: nothing at or below -4 or at or above 17 °C, full effect from 3 to 10 °C. */
const vernalizationRate: ProcessSet["vernalizationRate"] = (t) => {
  if (t <= -4 || t >= 17) return 0;
  if (t < 3) return (t + 4) / 7;
  if (t <= 10) return 1;
  return (17 - t) / 7;
};

const maintenanceRespiration: ProcessSet["maintenanceRespiration"] = ({ tmean, livingBiomass, p }) =>
  p.maintRespCoef * p.maintRespQ10 ** ((tmean - p.maintRespRefTemp) / 10) * livingBiomass;

const co2Effects: ProcessSet["co2Effects"] = (co2, p) => {
  const d = (co2 - 400) / 100;
  return {
    assimilation: Math.max(0, 1 + p.co2AssimilationSensitivity * d),
    transpiration: Math.max(0, 1 + p.co2TranspirationSensitivity * d),
  };
};

/** Dilution curve; held constant below 1 t/ha. */
const criticalN: ProcessSet["criticalN"] = (w, p) => p.ncritA * Math.max(1, w) ** -p.ncritB;

export const defaultProcesses: ProcessSet = {
  thermalTime,
  lightInterception,
  temperatureFactor,
  dailyGrowth,
  referenceET,
  daylength,
  vernalizationRate,
  photoperiodFactor,
  maintenanceRespiration,
  co2Effects,
  criticalN,
};
