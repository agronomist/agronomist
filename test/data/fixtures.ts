import { syntheticWeather } from "../../src";

/** SYNTHETIC fixtures that mimic the documented response shapes. They are not real data. */

export function openMeteoResponse(
  opts: { days?: number; start?: string; nullAt?: Partial<Record<string, number[]>>; radUnit?: string } = {},
) {
  const n = opts.days ?? 200;
  const w = syntheticWeather({ days: n, rainMean: 4, seed: 3 });
  const start = Date.UTC(2020, 4, 1); // 2020-05-01
  const time = w.map((_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  const daily: Record<string, (number | string | null)[]> = {
    time,
    temperature_2m_max: w.map((d) => d.tmax),
    temperature_2m_min: w.map((d) => d.tmin),
    shortwave_radiation_sum: w.map((d) => (opts.radUnit === "Wh/m²" ? d.srad / 0.0036 : d.srad)),
    precipitation_sum: w.map((d) => Math.round(d.rain * 10) / 10),
    et0_fao_evapotranspiration: w.map((d) => Math.round((0.17 * d.srad) * 10) / 10),
  };
  for (const [k, idx] of Object.entries(opts.nullAt ?? {})) for (const i of idx!) daily[k]![i] = null;
  return {
    latitude: 40,
    longitude: -90,
    daily_units: {
      time: "iso8601",
      temperature_2m_max: "°C",
      temperature_2m_min: "°C",
      shortwave_radiation_sum: opts.radUnit ?? "MJ/m²",
      precipitation_sum: "mm",
      et0_fao_evapotranspiration: "mm",
    },
    daily,
  };
}

/** Mapped (integer-style) values as SoilGrids returns them, with d_factor per property. */
export function soilGridsResponse(
  o: { clay?: number; sand?: number; soc?: number; nitrogen?: number; bdod?: number; nullDepth?: string } = {},
) {
  const labels = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"];
  const mk = (name: string, d_factor: number, mapped: number) => ({
    name,
    unit_measure: { d_factor },
    depths: labels.map((label, i) => ({
      label,
      range: { top_depth: [0, 5, 15, 30, 60][i]!, bottom_depth: [5, 15, 30, 60, 100][i]!, unit_depth: "cm" },
      values: { mean: label === o.nullDepth ? null : Math.round(mapped * (1 - 0.08 * i)) },
    })),
  });
  return {
    type: "Feature",
    properties: {
      layers: [
        mk("clay", 10, o.clay ?? 250), // 25 %
        mk("sand", 10, o.sand ?? 400), // 40 %
        mk("soc", 10, o.soc ?? 150), // 15 g/kg at surface
        mk("nitrogen", 100, o.nitrogen ?? 150), // 1.5 g/kg at surface
        mk("bdod", 100, o.bdod ?? 130), // 1.30 kg/dm3 at surface
        mk("phh2o", 10, 65),
      ],
    },
  };
}

/** Fetch mock that routes by host and records calls. */
export function routedFetch(handlers: { weather?: () => unknown; soil?: (url: string) => unknown | Error }) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    if (url.includes("open-meteo.com")) {
      return { ok: true, status: 200, json: async () => handlers.weather!() };
    }
    const r = handlers.soil!(url);
    if (r instanceof Error) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
  return { fn, calls };
}
