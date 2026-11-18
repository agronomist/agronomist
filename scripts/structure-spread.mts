// How much do model structure choices move the state results, compared with the baseline?
// Usage: npx tsx scripts/structure-spread.mts snapshot.json[.gz] [maize|soy|wheat]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CROPS, type CropKey } from "../src/ui/crops";
import { DEFAULT_PRICES } from "../src/ui/decision";
import { setStructure, setWater } from "../src/ui/model-run";
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
  "VPD cuts growth, exponent 0.5 (needs dew point)": { vpdSensitivity: 0.5 },
  "VPD cuts growth, exponent 1 (needs dew point)": { vpdSensitivity: 1 },
  "diffuse light off": { diffuseGain: 0 },
  "diffuse light x2": { diffuseGain: 0.6 },
  "kernel weight capped at 1.4x": { kernelWeightMaxRatio: 1.4 },
  "stem reserves 15% remobilized": { stemReserveFraction: 0.15, stemRemobRate: 3 },
  "stem reserves 25% remobilized": { stemReserveFraction: 0.25, stemRemobRate: 3 },
};

// water-module choices: each is run with everything else at the default
const waterVariants: Record<string, Parameters<typeof setWater>[0]> = {
  "water: no runoff, no spin-up (old)": null,
  "water: runoff CN 70": { runoffCN: 70 },
  "water: runoff CN 85": { runoffCN: 85 },
  "water: dry autumn start (0.1)": { autumnFraction: 0.1 },
  "water: wet autumn start (0.7)": { autumnFraction: 0.7 },
  "water: roots grow with heat, 1.5 mm/degree-day": { rootGrowthMmPerTT: 1.5 },
  "water: roots grow with heat, 2.2 mm/degree-day": { rootGrowthMmPerTT: 2.2 },
  "dry-down: root uptake limit 0.06/day": { uptakeRate: 0.06 },
  "dry-down: root uptake limit 0.08/day (Messina 2017)": { uptakeRate: 0.08 },
  "dry-down: root uptake limit 0.10/day": { uptakeRate: 0.1 },
  "dry-down: upward flow 0.05": { upwardFlux: 0.05 },
  "dry-down: upward flow 0.12": { upwardFlux: 0.12 },
  "water: two-stage evaporation, 6 mm": { evapStage1Mm: 6 },
  "water: two-stage evaporation, 12 mm": { evapStage1Mm: 12 },
};
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`# ${crop}: mean over states of the full+timed run\nvariant,mean_r,mean_abs_gap,mean_swing`);
const all: [string, Record<string, unknown> | null, Parameters<typeof setWater>[0] | undefined][] = [
  ...Object.entries(variants).map(([n, o]) => [n, o, undefined] as [string, Record<string, unknown> | null, undefined]),
  ...Object.entries(waterVariants).map(([n, w]) => [n, null, w] as [string, null, Parameters<typeof setWater>[0]]),
];
for (const [name, o, w] of all) {
  setStructure(o);
  setWater(w === undefined ? {} : w);
  const rows = (await runStateCheck(crop, plan, DEFAULT_PRICES[crop], () => undefined)).filter((r) => r.timed);
  console.log([name, avg(rows.map((r) => r.timed!.r)).toFixed(3), avg(rows.map((r) => Math.abs(r.timed!.levelGap))).toFixed(3), avg(rows.map((r) => r.timed!.sensitivity)).toFixed(3)].join(","));
}
