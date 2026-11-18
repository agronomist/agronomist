import type { WeatherDay } from "../types";
import { getJson, type HttpOptions } from "./http";

export const OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

export const DAILY_VARS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "shortwave_radiation_sum",
  "precipitation_sum",
  "et0_fao_evapotranspiration",
] as const;

export class WeatherDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherDataError";
  }
}

/** Optional daily mean dew point (°C). Asked for separately because its daily name is not documented: if the archive refuses it the request is repeated without. */
export const DEWPOINT_VAR = "dew_point_2m_mean";

/** Build the archive request URL. Dates are YYYY-MM-DD. */
export function openMeteoUrl(lat: number, lon: number, start: string, end: string, withDewpoint = false): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: start,
    end_date: end,
    daily: (withDewpoint ? [...DAILY_VARS, DEWPOINT_VAR] : DAILY_VARS).join(","),
    timezone: "UTC",
  });
  return `${OPEN_METEO_ARCHIVE}?${q.toString()}`;
}

const MAX_GAP = 3;

/** Linear fill of null runs up to MAX_GAP days; longer runs (or edge gaps) throw. */
function fillGaps(values: (number | null)[], name: string): number[] {
  const out = values.slice() as (number | null)[];
  let i = 0;
  while (i < out.length) {
    if (out[i] !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] === null) j++;
    const len = j - i;
    if (len > MAX_GAP || i === 0 || j === out.length) {
      throw new WeatherDataError(`${name}: ${len} consecutive missing days at index ${i}`);
    }
    const a = out[i - 1] as number;
    const b = out[j] as number;
    for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (len + 1);
    i = j;
  }
  return out as number[];
}

const doyOf = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
};

/** Parse an Open-Meteo archive daily response into model weather. */
export function parseOpenMeteo(json: unknown): WeatherDay[] {
  const j = json as {
    daily?: Record<string, (number | string | null)[]>;
    daily_units?: Record<string, string>;
  };
  const d = j?.daily;
  if (!d || !Array.isArray(d.time)) throw new WeatherDataError("Response has no daily.time");
  for (const v of DAILY_VARS) {
    if (!Array.isArray(d[v]) || d[v]!.length !== d.time.length) {
      throw new WeatherDataError(`Missing or misaligned variable ${v}`);
    }
  }

  const unit = j.daily_units?.shortwave_radiation_sum ?? "MJ/m²";
  let radFactor: number;
  if (/^MJ/i.test(unit)) radFactor = 1;
  else if (/^Wh/i.test(unit)) radFactor = 0.0036; // Wh/m2 -> MJ/m2
  else throw new WeatherDataError(`Unexpected radiation unit: ${unit}`);

  const tmax = fillGaps(d.temperature_2m_max as (number | null)[], "temperature_2m_max");
  const tmin = fillGaps(d.temperature_2m_min as (number | null)[], "temperature_2m_min");
  const srad = fillGaps(d.shortwave_radiation_sum as (number | null)[], "shortwave_radiation_sum");
  const rain = d.precipitation_sum as (number | null)[];
  const et0 = d.et0_fao_evapotranspiration as (number | null)[];
  const dew = Array.isArray(d[DEWPOINT_VAR]) && d[DEWPOINT_VAR]!.length === d.time.length ? (d[DEWPOINT_VAR] as (number | null)[]) : undefined;

  return (d.time as string[]).map((t, i) => {
    const day: WeatherDay = {
      doy: doyOf(t),
      tmax: Math.max(tmax[i]!, tmin[i]!),
      tmin: Math.min(tmax[i]!, tmin[i]!),
      srad: Math.max(0, srad[i]! * radFactor),
      rain: Math.max(0, rain[i] ?? 0), // missing rain is treated as 0 (documented limitation)
    };
    const e = et0[i];
    if (e !== null && e !== undefined) day.et0 = Math.max(0, e);
    const dp = dew?.[i];
    if (dp !== null && dp !== undefined) day.dewpoint = Math.min(dp, day.tmax);
    return day;
  });
}

export async function fetchWeather(
  lat: number,
  lon: number,
  start: string,
  end: string,
  o: HttpOptions = {},
): Promise<WeatherDay[]> {
  return parseOpenMeteo(await getJson(openMeteoUrl(lat, lon, start, end), o));
}
