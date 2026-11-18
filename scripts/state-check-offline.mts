// Re-run the state check with no network, from a saved snapshot.
// Usage: npx tsx scripts/state-check-offline.mts snapshot.json[.gz] [maize|soy|wheat ...]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CROPS, type CropKey } from "../src/ui/crops";
import { DEFAULT_PRICES } from "../src/ui/decision";
import { loadSnapshot, type Snapshot } from "../src/ui/snapshot";
import { runStateCheck } from "../src/ui/state-check";

const [file, ...crops] = process.argv.slice(2);
if (!file) throw new Error("give a snapshot file");
const raw = readFileSync(file);
const snap = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString()) as Snapshot;
console.error(loadSnapshot(snap));
const defaultPlan = (k: CropKey) => {
  const cfg = CROPS[k];
  return { sowDoy: cfg.sow.value, rm: cfg.defaults.rm, nRate: cfg.defaults.nRate, seedingRate: cfg.defaults.seedingRate, depthCm: cfg.defaults.depthCm, habit: cfg.defaults.habit };
};
const list = (crops.length ? crops : Object.keys(CROPS)) as CropKey[];
for (const c of list) {
  const rows = await runStateCheck(c, { ...defaultPlan(c), prev: "rotated" }, DEFAULT_PRICES[c], () => undefined);
  console.log(`# ${c}\nstate,years,r_one,gap_one,r_points,gap_points,r_full,gap_full,r_timed,gap_timed,swing_timed,note`);
  const f = (x?: number) => (x === undefined || Number.isNaN(x) ? "" : x.toFixed(3));
  for (const r of rows) console.log([r.state, r.years, f(r.preset?.r), f(r.preset?.levelGap), f(r.points?.r), f(r.points?.levelGap), f(r.full?.r), f(r.full?.levelGap), f(r.timed?.r), f(r.timed?.levelGap), f(r.timed?.sensitivity), r.note].join(","));
}
