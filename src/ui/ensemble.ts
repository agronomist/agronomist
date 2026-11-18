import type { WeatherDay } from "../index";
import { fetchHistory, realDay, seasonDays, seasonLabel, seasonStartYear, sourceOf, type DaySource, type History, type SeasonSpec } from "../data/history";
import type { HttpOptions } from "../data/http";
import type { CropConfig } from "./crops";
import type { Location } from "./locations";
import { syntheticYear, type Ensemble, type EnsembleYear } from "./weather-years";

export const specFor = (cfg: CropConfig, loc: Location): SeasonSpec => ({ yearStart: cfg.yearStart, yearDays: cfg.yearDays, shift: loc.calShift ?? 0 });

/** Thirty synthetic seasons drawn around the location's climate normals. Used when no weather record is available. */
export function syntheticEnsemble(cfg: CropConfig, loc: Location, n = 30, note = ""): Ensemble {
  const years: EnsembleYear[] = Array.from({ length: n }, (_, k) => ({ label: k + 1, weather: syntheticYear(cfg, "typical", k + 1, loc) }));
  return {
    source: "synthetic",
    years,
    note: note || `${n} synthetic seasons drawn around this place's climate averages. They show how much weather can vary, not what happened in any real year.`,
  };
}

/** One season for every year of the record in which the whole season is covered by complete years. */
export function realEnsemble(cfg: CropConfig, loc: Location, h: History): Ensemble {
  const spec = specFor(cfg, loc);
  const src = sourceOf({ years: h.years });
  const ys = [...h.years.keys()];
  const years: EnsembleYear[] = [];
  for (let label = Math.min(...ys); label <= Math.max(...ys) + 1; label++) {
    const w = seasonDays(spec, label, src);
    if (w) years.push({ label, weather: w });
  }
  const first = years[0]?.label;
  const last = years[years.length - 1]?.label;
  return {
    source: "real",
    years,
    note: `${years.length} real seasons, ${first} to ${last}, from the Open-Meteo archive. Each option is run on every one of them.`,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO date of position idx (0..364, no leap day) in a calendar year. */
export function dateOfIndex(year: number, idx: number): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const d = new Date(Date.UTC(year, 0, 1 + idx + (leap && idx >= 59 ? 1 : 0)));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * In-season ensemble: the current season's real weather up to the last day the archive has, then the rest of the
 * season taken from each past year in turn. Null if the archive has no partial year or the latest observation lies
 * outside this crop's season (for example, a northern maize season that ended months ago).
 */
export function inSeasonEnsemble(cfg: CropConfig, loc: Location, h: History): Ensemble | null {
  const part = h.partial;
  if (!part || part.days.length === 0) return null;
  const spec = specFor(cfg, loc);
  const lastIdx = part.days.length - 1;
  // A long timeline (wheat's 600 days) can hold the latest observation twice; the season it belongs to is the one
  // in which it falls earliest.
  let Z: number | null = null;
  let iNow = Infinity;
  for (const cand of [part.year - 1, part.year, part.year + 1])
    for (let i = 0; i < spec.yearDays; i++) {
      const r = realDay(spec, cand, i);
      if (r.year === part.year && r.idx === lastIdx && i < iNow) {
        Z = cand;
        iNow = i;
      }
    }
  if (Z === null || iNow >= spec.yearDays - 1) return null;
  const real = sourceOf(h);
  const years: EnsembleYear[] = [];
  for (const m of [...h.years.keys(), ...[...h.years.keys()].map((y) => y + 1)].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)) {
    if (m === Z) continue;
    const analog: DaySource = (year, idx) => (year < part.year || (year === part.year && idx <= lastIdx) ? real(year, idx) : h.years.get(year - Z! + m)?.[idx]);
    const w = seasonDays(spec, Z, analog);
    if (w) years.push({ label: m, weather: w });
  }
  if (years.length < 5) return null;
  const through = dateOfIndex(part.year, lastIdx);
  return {
    source: "real",
    years,
    note: `${Z} season so far (real weather to ${through}), then the rest of the season as it went in each of ${years.length} past years.`,
    inSeason: { label: Z, through, observedDays: iNow + 1 },
  };
}

const histories = new Map<string, Promise<History>>();
const hkey = (loc: Location) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;

export interface LoadedEnsembles {
  base: Ensemble;
  inSeason: Ensemble | null;
}

/** Fetch (once per place) the weather record and build the ensembles; any failure falls back to synthetic years with a note. */
export async function loadEnsembles(cfg: CropConfig, loc: Location, o: HttpOptions & { now?: Date } = {}): Promise<LoadedEnsembles> {
  if (loc.synthetic) return { base: syntheticEnsemble(cfg, loc, 30, "The test field has no real weather record, so these are 30 synthetic seasons."), inSeason: null };
  try {
    let p = histories.get(hkey(loc));
    if (!p) {
      p = fetchHistory(loc.lat, loc.lon, o);
      histories.set(hkey(loc), p);
      p.catch(() => histories.delete(hkey(loc)));
    }
    const h = await p;
    const base = realEnsemble(cfg, loc, h);
    if (base.years.length < 10) throw new Error(`only ${base.years.length} complete seasons in the record`);
    return { base, inSeason: inSeasonEnsemble(cfg, loc, h) };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { base: syntheticEnsemble(cfg, loc, 30, `Could not load the real weather record (${why}), so these are 30 synthetic seasons drawn around this place's climate averages.`), inSeason: null };
  }
}

export type { WeatherDay };
export { seasonLabel, seasonStartYear };
