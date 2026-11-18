// How much do model structure choices move the state results, compared with the baseline?
// Usage: npx tsx scripts/structure-spread.mts snapshot.json[.gz] [maize|soy|wheat]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CROPS, type CropKey } from "../src/ui/crops";
import { DEFAULT_PRICES } from "../src/ui/decision";
import { setStructure } from "../src/ui/model-run";
import { loadSnapshot, type Snapshot } from "../src/ui/snapshot";
import { runStateCheck } from "../src/ui/state-check";

const [file, cropArg] = process.argv.slice(2);
if (!file) throw new Error("give a snapshot file");
const raw = readFileSync(file);
loadSnapshot(JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString()) as Snapshot);
const crop = (cropArg ?? "maize") as CropKey;
const cfg = CROPS[crop];
const plan = { sowDoy: cfg.sow.value, rm: cfg.defaults.rm, nRate: cfg.defaults.nRate, seedingRate: cfg.defaults.seedingRate, depthCm: cfg.defaults.depthCm, habit: cfg.defaults.habit, prev: "rotated" as const };

// One change at a time from the baseline. Values are alternatives a reasonable modeller could defend.
const variants: Record<string, Record<string, unknown> | null> = {
  baseline: null,
  "kernel set: linear (no ceiling)": { kernelAsymptote: undefined },
  "canopy heat coupling off": { canopyCoupling: undefined },
  "canopy heat coupling x2": { canopyCoupling: 0.6 },
  "vpd efficiency on": { vpdSensitivity: 0.5 },
  "diffuse light off": { diffuseGain: 0 },
  "diffuse light x2": { diffuseGain: 0.6 },
};

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`# ${crop}: mean over states of the full+timed run\nvariant,mean_r,mean_abs_gap,mean_swing`);
for (const [name, o] of Object.entries(variants)) {
  setStructure(o);
  const rows = (await runStateCheck(crop, plan, DEFAULT_PRICES[crop], () => undefined)).filter((r) => r.timed);
  console.log([name, avg(rows.map((r) => r.timed!.r)).toFixed(3), avg(rows.map((r) => Math.abs(r.timed!.levelGap))).toFixed(3), avg(rows.map((r) => r.timed!.sensitivity)).toFixed(3)].join(","));
}
