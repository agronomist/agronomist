import { buildSoilParams, fetchSoilPoint, type SoilParams } from "../index";
import type { SoilPointProfile } from "../data/soilgrids";
import type { CropKey } from "./crops";
import { CROPS } from "./crops";
import { evaluate, type Prices } from "./decision";
import { historyFor, loadEnsembles } from "./ensemble";
import { locationByKey, registerLocation, soilFor, type Location } from "./locations";
import type { Management } from "./model-run";
import { sowingDays } from "./planting";
import { irrShare, stateYields, type PointRuns } from "./state-model";
import { simulateOption } from "./model-run";
import { STATE_PROFILES } from "./states";
import { seriesFor, validate, buAcToDryTHa, type ValidationResult } from "./validation";

export interface StateRow {
  state: string;
  years: number;
  preset: ValidationResult | null;
  points: ValidationResult | null;
  full: ValidationResult | null;
  /** Same as `full`, with the sowing date moved year by year (wet or cold springs sow later). */
  timed: ValidationResult | null;
  note: string;
}

const soils = new Map<string, Promise<SoilParams | null>>();
const profiles = new Map<string, SoilPointProfile>();
const soilKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;
function pointSoil(lat: number, lon: number): Promise<SoilParams | null> {
  const k = soilKey(lat, lon);
  let p = soils.get(k);
  if (!p) {
    p = fetchSoilPoint(lat, lon, { timeoutMs: 10000, retries: 0 }).then(
      (s) => {
        profiles.set(k, s);
        return buildSoilParams([s]);
      },
      () => null,
    );
    soils.set(k, p);
  }
  return p;
}
/** Soil profiles fetched so far, keyed "lat,lon". */
export const fetchedSoilProfiles = (): Map<string, SoilPointProfile> => new Map(profiles);
/** Put a saved soil profile into the cache without fetching it. */
export function seedSoilProfile(lat: number, lon: number, s: SoilPointProfile | null) {
  const k = soilKey(lat, lon);
  if (s) profiles.set(k, s);
  soils.set(k, Promise.resolve(s ? buildSoilParams([s]) : null));
}

/** Fetch the weather and soil of every point of every state (and each crop's preset place) so a snapshot can be saved. */
/** Places the last collection could not fetch, with the reason. */
export const lastFailures: string[] = [];

export async function collectAll(onProgress: (msg: string) => void): Promise<number> {
  const locs: Location[] = [];
  for (const c of Object.keys(CROPS) as CropKey[]) for (const s of seriesFor(c)) locs.push(locationByKey(s.location));
  const pts = STATE_PROFILES.flatMap((p) => p.points.map((pt) => ({ lat: pt.lat, lon: pt.lon, tag: `${p.state} ${pt.name}` })));
  const total = locs.length + pts.length;
  let n = 0;
  let failed = 0;
  lastFailures.length = 0;
  const fetchOne = async (name: string, loc: Location) => {
    for (let k = 0; k < 2; k++) {
      try {
        await historyFor(loc, gentle);
        return;
      } catch (e) {
        if (k === 1) {
          failed++;
          lastFailures.push(`${name}: ${(e as Error).message ?? e}`);
        } else await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  let label = "";
  // Open-Meteo's free allowance is limited: say so while waiting instead of looking stuck
  const gentle = { rateLimitWaitMs: 8000, onWait: (ms: number) => onProgress(`${label} (Open-Meteo is limiting requests; waiting ${Math.round(ms / 1000)} s, then continuing. Places already fetched are kept.)`) };
  const pause = () => new Promise<void>((r) => setTimeout(r, 1500));
  const seen = new Set<string>();
  for (const l of locs) {
    onProgress((label = `weather for ${l.name} (${++n} of ${total})…`));
    if (!seen.has(`${l.lat},${l.lon}`)) {
      seen.add(`${l.lat},${l.lon}`);
      await fetchOne(l.name, l);
      await pause();
    }
  }
  for (const pt of pts) {
    onProgress((label = `weather and soil for ${pt.tag} (${++n} of ${total})…`));
    await fetchOne(pt.tag, { lat: pt.lat, lon: pt.lon } as Location);
    await pause();
    await pointSoil(pt.lat, pt.lon);
  }
  return failed;
}

/**
 * For each state: the one-point preset run (what the page did before), the weighted points run, and the full run with the
 * irrigated and poorly drained shares added. Every run is the crop's default plan on every real weather year.
 */
export async function runStateCheck(crop: CropKey, plan: Management, prices: Prices, onProgress: (msg: string) => void, opts: { timedOnly?: boolean; states?: string[] } = {}): Promise<StateRow[]> {
  const cfg = CROPS[crop];
  const rows: StateRow[] = [];
  const list = seriesFor(crop).filter((s) => !opts.states || opts.states.includes(s.state));
  for (const [i, s] of list.entries()) {
    onProgress(`${s.state} (${i + 1} of ${list.length})…`);
    const prof = STATE_PROFILES.find((p) => p.state === s.state)!;
    const preset = locationByKey(s.location);
    const row: StateRow = { state: s.state, years: Object.keys(s.years).length, preset: null, points: null, full: null, timed: null, note: "" };
    const run = (loc: Location, soil: SoilParams, ens: Awaited<ReturnType<typeof loadEnsembles>>["base"], m: Management) =>
      new Map(evaluate(cfg, loc, soil, { ...m, id: "v", name: "v" }, ens, prices).outcomes.map((o) => [o.label, o.yieldTHa] as [number, number]));

    const runTimed = (loc: Location, soil: SoilParams, ens: Awaited<ReturnType<typeof loadEnsembles>>["base"], m: Management) => {
      const sow = sowingDays(crop, s.state, ens.years, cfg.yearStart, m.sowDoy);
      return new Map(ens.years.map((y) => [y.label, simulateOption(cfg, loc, soil, { ...m, sowDoy: sow.get(y.label)!.doy }, y.weather).yieldTHa] as [number, number]));
    };
    const got = await loadEnsembles(cfg, preset, { rateLimitWaitMs: 8000 });
    if (got.base.source !== "real") {
      row.note = "real weather did not load";
      rows.push(row);
      continue;
    }
    if (!opts.timedOnly) row.preset = validate(crop, run(preset, soilFor(preset), got.base, plan), s.years);

    const runs: PointRuns[] = [];
    const timedRuns: PointRuns[] = [];
    let soilMisses = 0;
    for (const pt of prof.points) {
      const sp = await pointSoil(pt.lat, pt.lon);
      if (!sp) soilMisses++;
      const loc: Location = registerLocation({ ...preset, key: `pt_${pt.lat}_${pt.lon}`, name: `${s.state} ${pt.name}`, lat: pt.lat, lon: pt.lon, soilParams: sp ?? undefined, pin: true });
      const e = await loadEnsembles(cfg, loc, { rateLimitWaitMs: 8000 });
      if (e.base.source !== "real") continue;
      const soil = soilFor(loc);
      const irr = irrShare(crop, pt.irrCorn);
      if (!opts.timedOnly) runs.push({
        w: pt.w,
        irr,
        free: run(loc, soil, e.base, plan),
        poor: prof.untiledWet > 0 ? run(loc, soil, e.base, { ...plan, poorDrainage: true }) : undefined,
        wt: prof.shallowWT > 0 ? run(loc, soil, e.base, { ...plan, shallowWT: true }) : undefined,
        irrigated: irr > 0 ? run(loc, soil, e.base, { ...plan, irrigated: true }) : undefined,
      });
      timedRuns.push({
        w: pt.w,
        irr,
        free: runTimed(loc, soil, e.base, plan),
        poor: prof.untiledWet > 0 ? runTimed(loc, soil, e.base, { ...plan, poorDrainage: true }) : undefined,
        wt: prof.shallowWT > 0 ? runTimed(loc, soil, e.base, { ...plan, shallowWT: true }) : undefined,
        irrigated: irr > 0 ? runTimed(loc, soil, e.base, { ...plan, irrigated: true }) : undefined,
      });
    }
    if (!opts.timedOnly && runs.length < prof.points.length) row.note = `${prof.points.length - runs.length} point(s) had no real weather`;
    if (soilMisses) row.note += `${row.note ? "; " : ""}soil data missing at ${soilMisses} point(s), preset soil used`;
    if (opts.timedOnly) row.timed = validate(crop, stateYields(timedRuns, prof, "full"), s.years);
    else if (runs.length) {
      row.points = validate(crop, stateYields(runs, prof, "points"), s.years);
      row.full = validate(crop, stateYields(runs, prof, "full"), s.years);
      row.timed = validate(crop, stateYields(timedRuns, prof, "full"), s.years);
    }
    rows.push(row);
  }
  return rows;
}

export const toBuAc = (crop: CropKey, tha: number) => tha / buAcToDryTHa(crop, 1);
