import type { SoilParams, WeatherDay } from "../types";
import { centroid, samplePoints, validateField, type FieldLimits, type LngLat } from "./field";
import { areaHectares } from "./field";
import type { HttpOptions } from "./http";
import { fetchWeather } from "./openmeteo";
import { buildSoilParams, type BuildSoilOptions } from "./soil";
import { fetchSoilPoint, SoilDataError, type SoilPointProfile } from "./soilgrids";

export class SoilUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoilUnavailable";
  }
}

export interface FieldScenario {
  ring: LngLat[];
  centroid: LngLat;
  latitude: number;
  areaHa: number;
  weather: WeatherDay[];
  soil: SoilParams;
  soilPointsUsed: number;
  warnings: string[];
}

export interface ScenarioOptions extends HttpOptions {
  /** Inclusive date range, YYYY-MM-DD. Day 0 of the weather array is startDate. */
  startDate: string;
  endDate: string;
  /** Number of soil sample points inside the field (each is one API call). Default 3. */
  soilPoints?: number;
  limits?: FieldLimits;
  soil?: BuildSoilOptions;
  /** Optional cache keyed by ~250 m grid cell to avoid repeat SoilGrids calls. */
  soilCache?: Map<string, SoilPointProfile>;
}

const cellKey = (lat: number, lon: number) => `${(Math.round(lat / 0.0025) * 0.0025).toFixed(4)},${(Math.round(lon / 0.0025) * 0.0025).toFixed(4)}`;

/**
 * Load everything the game needs for a user-drawn field: validated geometry, daily weather at
 * the centroid, and soil aggregated across sample points. Partial soil failures degrade to a
 * warning; total soil failure throws SoilUnavailable so the UI can fall back to a preset soil.
 */
export async function loadFieldScenario(drawn: readonly LngLat[], o: ScenarioOptions): Promise<FieldScenario> {
  const ring = validateField(drawn, o.limits);
  const c = centroid(ring);
  const [lon, lat] = c;
  const areaHa = areaHectares(ring);
  const warnings: string[] = [];
  if (areaHa < 1) warnings.push("Very small field: weather and soil data are coarser than the field (about 10 km weather, 250 m soil).");

  const pts = samplePoints(ring, o.soilPoints ?? 3);
  const [weather, soilResults] = await Promise.all([
    fetchWeather(lat, lon, o.startDate, o.endDate, o),
    // sequential per point to stay gentle on the SoilGrids rate limit
    (async () => {
      const profiles: SoilPointProfile[] = [];
      const errors: string[] = [];
      for (const [plon, plat] of pts) {
        const key = cellKey(plat, plon);
        const cached = o.soilCache?.get(key);
        if (cached) {
          profiles.push(cached);
          continue;
        }
        try {
          const p = await fetchSoilPoint(plat, plon, o);
          o.soilCache?.set(key, p);
          profiles.push(p);
        } catch (e) {
          errors.push(e instanceof SoilDataError || e instanceof Error ? e.message : String(e));
        }
      }
      return { profiles, errors };
    })(),
  ]);

  if (soilResults.profiles.length === 0) {
    throw new SoilUnavailable(`No soil data for this field (${soilResults.errors.join("; ")})`);
  }
  if (soilResults.errors.length > 0) {
    warnings.push(`Soil data missing for ${soilResults.errors.length} of ${pts.length} sample points; using the rest.`);
  }

  return {
    ring,
    centroid: c,
    latitude: lat,
    areaHa,
    weather,
    soil: buildSoilParams(soilResults.profiles, o.soil),
    soilPointsUsed: soilResults.profiles.length,
    warnings,
  };
}
