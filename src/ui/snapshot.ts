import { packHistory, unpackHistory, type PackedHistory } from "../data/history-pack";
import type { SoilPointProfile } from "../data/soilgrids";
import { fetchedHistories, historySource, seedHistory } from "./ensemble";
import { fetchedSoilProfiles, seedSoilProfile } from "./state-check";

/**
 * A saved copy of every weather record and soil profile the state check fetched, so the whole check can be re-run
 * offline (in tests, or in a sandbox with no network). Weather is stored column by column and rounded to 0.1.
 */
export interface Snapshot {
  version: 1;
  created: string;
  /** Where the weather came from (absent in older files: Open-Meteo) */
  source?: "openmeteo" | "power";
  weather: Record<string, PackedHistory>;
  soil: Record<string, SoilPointProfile>;
}


export async function buildSnapshot(): Promise<Snapshot> {
  const weather: Snapshot["weather"] = {};
  for (const [k, h] of await fetchedHistories()) {
    weather[k] = packHistory(h);
  }
  const soil: Snapshot["soil"] = {};
  for (const [k, s] of fetchedSoilProfiles()) soil[k] = s;
  return { version: 1, created: new Date().toISOString(), source: historySource(), weather, soil };
}

/** Load a snapshot into the caches. Returns how many weather records and soil profiles it held. */
export function loadSnapshot(s: Snapshot): { weather: number; soil: number } {
  if (s.version !== 1) throw new Error("unknown snapshot version");
  for (const [k, w] of Object.entries(s.weather)) {
    const [lat, lon] = k.split(",").map(Number) as [number, number];
    seedHistory(lat, lon, unpackHistory(w));
  }
  for (const [k, p] of Object.entries(s.soil)) {
    const [lat, lon] = k.split(",").map(Number) as [number, number];
    seedSoilProfile(lat, lon, p);
  }
  return { weather: Object.keys(s.weather).length, soil: Object.keys(s.soil).length };
}
