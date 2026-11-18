import { buildSoilParams, fetchSoilPoint, type SoilParams } from "../index";
import type { CropKey } from "./crops";
import { CROPS } from "./crops";
import { evaluate, type Prices } from "./decision";
import { loadEnsembles } from "./ensemble";
import { locationByKey, registerLocation, soilFor, type Location } from "./locations";
import type { Management } from "./model-run";
import { irrShare, stateYields, type PointRuns } from "./state-model";
import { STATE_PROFILES } from "./states";
import { seriesFor, validate, buAcToDryTHa, type ValidationResult } from "./validation";

export interface StateRow {
  state: string;
  years: number;
  preset: ValidationResult | null;
  points: ValidationResult | null;
  full: ValidationResult | null;
  note: string;
}

const soils = new Map<string, Promise<SoilParams | null>>();
function pointSoil(lat: number, lon: number): Promise<SoilParams | null> {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let p = soils.get(k);
  if (!p) {
    p = fetchSoilPoint(lat, lon, { timeoutMs: 10000, retries: 0 }).then((s) => buildSoilParams([s]), () => null);
    soils.set(k, p);
  }
  return p;
}

/**
 * For each state: the one-point preset run (what the page did before), the weighted points run, and the full run with the
 * irrigated and poorly drained shares added. Every run is the crop's default plan on every real weather year.
 */
export async function runStateCheck(crop: CropKey, plan: Management, prices: Prices, onProgress: (msg: string) => void): Promise<StateRow[]> {
  const cfg = CROPS[crop];
  const rows: StateRow[] = [];
  const list = seriesFor(crop);
  for (const [i, s] of list.entries()) {
    onProgress(`${s.state} (${i + 1} of ${list.length})…`);
    const prof = STATE_PROFILES.find((p) => p.state === s.state)!;
    const preset = locationByKey(s.location);
    const row: StateRow = { state: s.state, years: Object.keys(s.years).length, preset: null, points: null, full: null, note: "" };
    const run = (loc: Location, soil: SoilParams, ens: Awaited<ReturnType<typeof loadEnsembles>>["base"], m: Management) =>
      new Map(evaluate(cfg, loc, soil, { ...m, id: "v", name: "v" }, ens, prices).outcomes.map((o) => [o.label, o.yieldTHa] as [number, number]));

    const got = await loadEnsembles(cfg, preset);
    if (got.base.source !== "real") {
      row.note = "real weather did not load";
      rows.push(row);
      continue;
    }
    row.preset = validate(crop, run(preset, soilFor(preset), got.base, plan), s.years);

    const runs: PointRuns[] = [];
    let soilMisses = 0;
    for (const pt of prof.points) {
      const sp = await pointSoil(pt.lat, pt.lon);
      if (!sp) soilMisses++;
      const loc: Location = registerLocation({ ...preset, key: `pt_${pt.lat}_${pt.lon}`, name: `${s.state} ${pt.name}`, lat: pt.lat, lon: pt.lon, soilParams: sp ?? undefined, pin: true });
      const e = await loadEnsembles(cfg, loc);
      if (e.base.source !== "real") continue;
      const soil = soilFor(loc);
      const irr = irrShare(crop, pt.irrCorn);
      runs.push({
        w: pt.w,
        irr,
        free: run(loc, soil, e.base, plan),
        poor: prof.untiledWet > 0 ? run(loc, soil, e.base, { ...plan, poorDrainage: true }) : undefined,
        irrigated: irr > 0 ? run(loc, soil, e.base, { ...plan, irrigated: true }) : undefined,
      });
    }
    if (runs.length < prof.points.length) row.note = `${prof.points.length - runs.length} point(s) had no real weather`;
    if (soilMisses) row.note += `${row.note ? "; " : ""}soil data missing at ${soilMisses} point(s), preset soil used`;
    if (runs.length) {
      row.points = validate(crop, stateYields(runs, prof, "points"), s.years);
      row.full = validate(crop, stateYields(runs, prof, "full"), s.years);
    }
    rows.push(row);
  }
  return rows;
}

export const toBuAc = (crop: CropKey, tha: number) => tha / buAcToDryTHa(crop, 1);
