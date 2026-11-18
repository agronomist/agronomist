// Calibrate the hand-set numbers of the state check against NASS with differential evolution, scoring held-out states.
// Usage: npx tsx scripts/calibrate.mts snapshot.json[.gz] [maize|soy|wheat] [generations] [seed]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CROPS, type CropKey } from "../src/ui/crops";
import { DEFAULT_PRICES } from "../src/ui/decision";
import { setStructure, setWater, WATER_DEFAULTS, type WaterSettings } from "../src/ui/model-run";
import { loadSnapshot, type Snapshot } from "../src/ui/snapshot";
import { runStateCheck } from "../src/ui/state-check";
import { componentCheck, rowOk } from "../src/ui/component-check";
import { DEFAULT_TUNING, setTuning, type Tuning } from "../src/ui/tuning";

const [file, cropArg, genArg, seedArg] = process.argv.slice(2);
if (!file) throw new Error("give a snapshot file");
const raw = readFileSync(file);
loadSnapshot(JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString()) as Snapshot);
const crop = (cropArg ?? "maize") as CropKey;
const cfg = CROPS[crop];
const plan = { sowDoy: cfg.sow.value, rm: cfg.defaults.rm, nRate: cfg.defaults.nRate, seedingRate: cfg.defaults.seedingRate, depthCm: cfg.defaults.depthCm, habit: cfg.defaults.habit, prev: "rotated" as const };

// what moves, and within what range. Ranges are what a reasonable agronomist would defend, not what fits.
interface Dim { name: string; lo: number; hi: number; set: (v: number, t: Partial<Tuning>, s: Record<string, number>, w: Partial<WaterSettings>) => void; base: number }
const dims: Dim[] = [
  { name: "delayPerMm", lo: 0.03, hi: 0.25, base: DEFAULT_TUNING.delayPerMm, set: (v, t) => void (t.delayPerMm = v) },
  { name: "delayPerDegC", lo: 0.5, hi: 5, base: DEFAULT_TUNING.delayPerDegC, set: (v, t) => void (t.delayPerDegC = v) },
  { name: "runoffCN", lo: 68, hi: 88, base: WATER_DEFAULTS.runoffCN, set: (v, _t, _s, w) => void (w.runoffCN = v) },
  { name: "autumnFraction", lo: 0.1, hi: 0.7, base: WATER_DEFAULTS.autumnFraction, set: (v, _t, _s, w) => void (w.autumnFraction = v) },
  { name: "wetScale", lo: 0.4, hi: 1.6, base: 1, set: (v, t) => void (t.wetScale = v) },
  { name: "wtScale", lo: 0.4, hi: 1.6, base: 1, set: (v, t) => void (t.wtScale = v) },
  { name: "irrScale", lo: 0.5, hi: 1.5, base: 1, set: (v, t) => void (t.irrScale = v) },
  { name: "canopyCoupling", lo: 0.1, hi: 0.6, base: 0.3, set: (v, _t, s) => void (s.canopyCoupling = v) },
  { name: "heatDamageRate", lo: 0.004, hi: 0.014, base: 0.0088, set: (v, _t, s) => void (s.heatDamageRate = v) },
  { name: "uptakeRate", lo: 0.03, hi: 0.2, base: 0.1, set: (v, _t, s) => void (s.uptakeRate = v) },
  { name: "vpdSensitivity", lo: 0, hi: 1, base: 0, set: (v, _t, s) => void (s.vpdSensitivity = v) },
  { name: "diffuseGain", lo: 0, hi: 0.6, base: 0.3, set: (v, _t, s) => void (s.diffuseGain = v) },
  { name: "stemReserveFraction", lo: 0, hi: 0.25, base: 0, set: (v, _t, s) => void ((s.stemReserveFraction = v), (s.stemRemobRate = 3)) },
];
const structural = crop === "maize"; // the crop-parameter dimensions above are maize's; other crops tune the first five only
const shared = new Set(["delayPerMm", "delayPerDegC", "runoffCN", "autumnFraction", "wetScale", "wtScale", "irrScale"]);
const active = structural ? dims : dims.filter((d) => shared.has(d.name));

const apply = (x: number[]) => {
  const t: Partial<Tuning> = {};
  const s: Record<string, number> = {};
  const w: Partial<WaterSettings> = {};
  active.forEach((d, i) => d.set(x[i]!, t, s, w));
  setWater(w);
  setTuning(t);
  setStructure(Object.keys(s).length ? s : null);
};

// split: every third state (alphabetical) is held out and never seen by the optimizer
const all = (await runStateCheck(crop, plan, DEFAULT_PRICES[crop], () => undefined, { timedOnly: true })).map((r) => r.state).sort();
const hold = all.filter((_, i) => i % 3 === 2);
const train = all.filter((s) => !hold.includes(s));
console.error(`train ${train.join(", ")}\nhold-out ${hold.join(", ")}`);

const LAMBDA = 1; // weight of the level gap against (1 - r)
async function score(x: number[], states: string[]) {
  apply(x);
  const rows = (await runStateCheck(crop, plan, DEFAULT_PRICES[crop], () => undefined, { timedOnly: true, states })).filter((r) => r.timed);
  const m = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
  const r = m((q) => q.timed!.r), gap = m((q) => Math.abs(q.timed!.levelGap));
  return { loss: 1 - r + LAMBDA * gap, r, gap };
}

// differential evolution (rand/1/bin)
let seed = Number(seedArg ?? 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const N = active.length * 3, G = Number(genArg ?? 10), F = 0.6, CR = 0.8;
const clamp = (v: number, d: Dim) => Math.max(d.lo, Math.min(d.hi, v));
let pop = [active.map((d) => d.base), ...Array.from({ length: N - 1 }, () => active.map((d) => d.lo + rnd() * (d.hi - d.lo)))];
let fit = [];
for (const x of pop) fit.push((await score(x, train)).loss);
for (let g = 0; g < G; g++) {
  for (let i = 0; i < N; i++) {
    const pick = () => { let j; do j = Math.floor(rnd() * N); while (j === i); return j; };
    const [a, b, c] = [pick(), pick(), pick()];
    const jr = Math.floor(rnd() * active.length);
    const trial = active.map((d, k) => (rnd() < CR || k === jr ? clamp(pop[a]![k]! + F * (pop[b]![k]! - pop[c]![k]!), d) : pop[i]![k]!));
    const f = (await score(trial, train)).loss;
    if (f <= fit[i]!) { pop[i] = trial; fit[i] = f; }
  }
  console.error(`generation ${g + 1}/${G}: best training loss ${Math.min(...fit).toFixed(4)}`);
}
const bi = fit.indexOf(Math.min(...fit));
const best = pop[bi]!;
const before = { train: await score(active.map((d) => d.base), train), hold: await score(active.map((d) => d.base), hold) };
const after = { train: await score(best, train), hold: await score(best, hold) };
const f = (s: { r: number; gap: number }) => `r ${s.r.toFixed(3)}, level gap ${(100 * s.gap).toFixed(1)}%`;
console.log(`# ${crop}\nparameter,default,calibrated,range`);
active.forEach((d, i) => console.log(`${d.name},${d.base},${best[i]!.toFixed(4)},${d.lo}-${d.hi}`));
console.log(`\nset,default,calibrated\ntrain,${f(before.train)},${f(after.train)}\nhold-out,${f(before.hold)},${f(after.hold)}`);
if (crop === "maize") {
  const parts = (x: number[]) => { apply(x); return componentCheck().map((r) => `${r.name}: ${rowOk(r) ? "within" : "OUTSIDE"}`); };
  console.log("\nphysiology check (published ranges), default vs calibrated");
  const a = parts(active.map((d) => d.base)), b = parts(best);
  a.forEach((row, i) => console.log(`${row}  ->  ${b[i]}`));
}
const atBound = active.filter((d, i) => Math.abs(best[i]! - d.lo) < 0.02 * (d.hi - d.lo) || Math.abs(best[i]! - d.hi) < 0.02 * (d.hi - d.lo)).map((d) => d.name);
if (atBound.length) console.log(`\nat the edge of the allowed range (the data may want more than is defensible, or something else is wrong): ${atBound.join(", ")}`);
writeFileSync(`/tmp/calibration-${crop}.json`, JSON.stringify({ crop, train, hold, params: Object.fromEntries(active.map((d, i) => [d.name, best[i]])), before, after }, null, 1));
