import { getJson, type HttpOptions } from "./http";

export const SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";
export const SOIL_PROPERTIES = ["clay", "sand", "soc", "nitrogen", "bdod", "phh2o"] as const;
export const SOIL_DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"] as const;

/** Mapped-unit -> conventional-unit divisors, used only if the response omits d_factor. */
const FALLBACK_D_FACTOR: Record<string, number> = {
  clay: 10, // g/kg -> %
  sand: 10, // g/kg -> %
  soc: 10, // dg/kg -> g/kg
  nitrogen: 100, // cg/kg -> g/kg
  bdod: 100, // cg/cm3 -> kg/dm3
  phh2o: 10, // pH*10 -> pH
};

export class SoilDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoilDataError";
  }
}

export interface SoilDepthRecord {
  label: string;
  topCm: number;
  bottomCm: number;
  clayPct: number;
  sandPct: number;
  /** Soil organic carbon, g/kg */
  socGkg: number;
  /** Total nitrogen, g/kg */
  nitrogenGkg: number;
  /** Bulk density of the fine earth fraction, kg/dm3 */
  bdodKgDm3: number;
  ph: number;
}

export interface SoilPointProfile {
  lat: number;
  lon: number;
  depths: SoilDepthRecord[];
}

export function soilGridsUrl(lat: number, lon: number): string {
  const q = new URLSearchParams();
  q.append("lon", lon.toFixed(5));
  q.append("lat", lat.toFixed(5));
  for (const p of SOIL_PROPERTIES) q.append("property", p);
  for (const d of SOIL_DEPTHS) q.append("depth", d);
  q.append("value", "mean");
  return `${SOILGRIDS_URL}?${q.toString()}`;
}

interface RawLayer {
  name: string;
  unit_measure?: { d_factor?: number };
  depths: { label: string; range?: { top_depth: number; bottom_depth: number }; values: { mean: number | null } }[];
}

/** Parse a SoilGrids properties/query response (conversion factors read from the response). */
export function parseSoilGrids(json: unknown, lat: number, lon: number): SoilPointProfile {
  const layers = (json as { properties?: { layers?: RawLayer[] } })?.properties?.layers;
  if (!Array.isArray(layers)) throw new SoilDataError("Response has no properties.layers");

  const byName = new Map(layers.map((l) => [l.name, l]));
  const value = (prop: string, label: string): number => {
    const layer = byName.get(prop);
    if (!layer) throw new SoilDataError(`Missing property ${prop}`);
    const dep = layer.depths.find((x) => x.label === label);
    const raw = dep?.values?.mean;
    if (raw === null || raw === undefined) {
      throw new SoilDataError(`No data for ${prop} at ${label} (water, urban or masked area?)`);
    }
    const f = layer.unit_measure?.d_factor ?? FALLBACK_D_FACTOR[prop];
    if (!f) throw new SoilDataError(`No conversion factor for ${prop}`);
    return raw / f;
  };

  const depths: SoilDepthRecord[] = SOIL_DEPTHS.map((label) => {
    const [top, bottom] = label.replace("cm", "").split("-").map(Number) as [number, number];
    return {
      label,
      topCm: top,
      bottomCm: bottom,
      clayPct: value("clay", label),
      sandPct: value("sand", label),
      socGkg: value("soc", label),
      nitrogenGkg: value("nitrogen", label),
      bdodKgDm3: value("bdod", label),
      ph: value("phh2o", label),
    };
  });
  return { lat, lon, depths };
}

export async function fetchSoilPoint(lat: number, lon: number, o: HttpOptions = {}): Promise<SoilPointProfile> {
  return parseSoilGrids(await getJson(soilGridsUrl(lat, lon), o), lat, lon);
}
