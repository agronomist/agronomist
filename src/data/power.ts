import type { WeatherDay } from "../types";
import { buildHistory, type History } from "./history";
import { getJson, HttpError, type HttpOptions } from "./http";
import { doyOf, fillGaps, WeatherDataError } from "./openmeteo";

/**
 * NASA POWER daily weather (MERRA-2 and CERES, with IMERG-corrected rainfall): a second source with no per-minute
 * allowance, so a whole snapshot can be collected at once. It is coarser than Open-Meteo's archive (about 50 km for
 * temperature and humidity, 100 km for radiation) and has no reference evapotranspiration, so that is computed here
 * (FAO-56 Penman-Monteith).
 */
export const POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
export const POWER_VARS = ["T2M_MAX", "T2M_MIN", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR", "T2MDEW", "WS2M"] as const;
const FILL = -999;

const ymd = (iso: string) => iso.replace(/-/g, "");
const isoOf = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;

/** Request URL. Dates are YYYY-MM-DD. */
export function powerUrl(lat: number, lon: number, start: string, end: string): string {
  const q = new URLSearchParams({
    parameters: POWER_VARS.join(","),
    community: "AG",
    longitude: String(lon),
    latitude: String(lat),
    start: ymd(start),
    end: ymd(end),
    format: "JSON",
  });
  return `${POWER_URL}?${q.toString()}`;
}

const es = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

/** FAO-56 Penman-Monteith reference evapotranspiration, mm per day. `tdew` is the dew point, `u2` the wind at 2 m (m/s). */
export function et0PenmanMonteith(a: { tmax: number; tmin: number; rs: number; tdew: number; u2: number; lat: number; elev: number; doy: number }): number {
  const tmean = (a.tmax + a.tmin) / 2;
  const esMean = (es(a.tmax) + es(a.tmin)) / 2;
  const ea = Math.min(es(a.tdew), esMean);
  const delta = (4098 * es(tmean)) / (tmean + 237.3) ** 2;
  const P = 101.3 * ((293 - 0.0065 * a.elev) / 293) ** 5.26;
  const gamma = 0.000665 * P;
  const phi = (a.lat * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * a.doy) / 365);
  const dec = 0.409 * Math.sin((2 * Math.PI * a.doy) / 365 - 1.39);
  const x = Math.min(1, Math.max(-1, -Math.tan(phi) * Math.tan(dec)));
  const ws = Math.acos(x);
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
  const rso = (0.75 + 2e-5 * a.elev) * ra;
  const rns = 0.77 * a.rs;
  const rel = rso > 0.1 ? Math.min(1, a.rs / rso) : 0.5;
  const rnl = 4.903e-9 * (((a.tmax + 273.16) ** 4 + (a.tmin + 273.16) ** 4) / 2) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * rel - 0.35);
  const rn = rns - rnl;
  const et = (0.408 * delta * rn + ((gamma * 900) / (tmean + 273)) * a.u2 * (esMean - ea)) / (delta + gamma * (1 + 0.34 * a.u2));
  return Math.max(0, et);
}

/** One POWER response as dates and model weather. Trailing days the service has not filled yet are cut. */
export function parsePower(json: unknown): { times: string[]; days: WeatherDay[] } {
  const j = json as {
    geometry?: { coordinates?: number[] };
    properties?: { parameter?: Record<string, Record<string, number>> };
    parameters?: Record<string, { units?: string }>;
  };
  const par = j?.properties?.parameter;
  if (!par) throw new WeatherDataError("Response has no properties.parameter");
  for (const v of POWER_VARS) if (!par[v]) throw new WeatherDataError(`Missing variable ${v}`);
  const keys = Object.keys(par.T2M_MAX!).sort();
  const [lon = 0, lat = 0, elev = 0] = j.geometry?.coordinates ?? [];
  const col = (v: string) => keys.map((k) => (par[v]![k] === undefined || par[v]![k] === FILL || par[v]![k]! <= -990 ? null : par[v]![k]!));
  const tmaxC = col("T2M_MAX");
  const tminC = col("T2M_MIN");
  const radC = col("ALLSKY_SFC_SW_DWN");
  let n = keys.length;
  while (n > 0 && (tmaxC[n - 1] === null || tminC[n - 1] === null || radC[n - 1] === null)) n--;
  if (n === 0) return { times: [], days: [] };
  const cut = <T,>(a: T[]) => a.slice(0, n);
  const unit = j.parameters?.ALLSKY_SFC_SW_DWN?.units ?? "MJ/m^2/day";
  const radFactor = /kw/i.test(unit) ? 3.6 : 1; // kWh/m2 -> MJ/m2 (the AG community reports MJ)
  const tmax = fillGaps(cut(tmaxC), "T2M_MAX");
  const tmin = fillGaps(cut(tminC), "T2M_MIN");
  const rad = fillGaps(cut(radC), "ALLSKY_SFC_SW_DWN");
  const dew = cut(col("T2MDEW"));
  const wind = cut(col("WS2M"));
  const rain = cut(col("PRECTOTCORR"));
  const times = cut(keys).map(isoOf);
  const days = times.map((t, i) => {
    const hi = Math.max(tmax[i]!, tmin[i]!);
    const lo = Math.min(tmax[i]!, tmin[i]!);
    const rs = Math.max(0, rad[i]! * radFactor);
    const doy = doyOf(t);
    const tdew = Math.min(dew[i] ?? lo, hi);
    const day: WeatherDay = { doy, tmax: hi, tmin: lo, srad: rs, rain: Math.max(0, rain[i] ?? 0), dewpoint: tdew };
    day.et0 = et0PenmanMonteith({ tmax: hi, tmin: lo, rs, tdew, u2: Math.max(0.5, wind[i] ?? 2), lat, elev, doy });
    return day;
  });
  void lon;
  return { times, days };
}

let relayBroken = false;
async function getPower(lat: number, lon: number, a: string, b: string, o: HttpOptions): Promise<unknown> {
  const url = powerUrl(lat, lon, a, b);
  const loc = (globalThis as unknown as { location?: { protocol: string } }).location;
  if (!relayBroken && o.fetch === undefined && loc && /^https?:/.test(loc.protocol)) {
    try {
      return await getJson(url.replace(POWER_URL, "/api/power"), { ...o, retries: 1, rateLimitWaitMs: 0, onWait: undefined });
    } catch (e) {
      if (!(e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429)) relayBroken = true;
      else throw e;
    }
  }
  return getJson(url, o);
}

/** A span of years, split in halves when the service refuses it as too long. */
async function chunk(lat: number, lon: number, a: string, b: string, o: HttpOptions): Promise<{ times: string[]; days: WeatherDay[] }[]> {
  try {
    return [parsePower(await getPower(lat, lon, a, b, o))];
  } catch (e) {
    const years = Number(b.slice(0, 4)) - Number(a.slice(0, 4)) + 1;
    if (!(e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) || years < 2) throw e;
    const mid = Number(a.slice(0, 4)) + Math.floor(years / 2) - 1;
    return [...(await chunk(lat, lon, a, `${mid}-12-31`, o)), ...(await chunk(lat, lon, `${mid + 1}-01-01`, b, o))];
  }
}

/** Daily weather from `firstYear` to about ten days ago, in spans of up to 6 years, one after another. */
export async function fetchPowerHistory(lat: number, lon: number, o: HttpOptions & { firstYear?: number; now?: Date; lagDays?: number } = {}): Promise<History> {
  const now = o.now ?? new Date();
  const raw0 = new Date(now.getTime() - (o.lagDays ?? 10) * 86400000);
  const end = new Date(raw0.getTime() - raw0.getUTCDay() * 86400000);
  const first = o.firstYear ?? 1991;
  const lastYear = end.getUTCFullYear();
  const parts: { times: string[]; days: WeatherDay[] }[] = [];
  for (let y = first; y <= lastYear; y += 6) {
    const y1 = Math.min(lastYear, y + 5);
    parts.push(...(await chunk(lat, lon, `${y}-01-01`, y1 === lastYear ? end.toISOString().slice(0, 10) : `${y1}-12-31`, o)));
  }
  return buildHistory(
    parts.flatMap((p) => p.times),
    parts.flatMap((p) => p.days),
  );
}
