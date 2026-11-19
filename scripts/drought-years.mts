// Season types and yields for one snapshot point, with the observed state yield beside them.
// Usage: npx tsx scripts/drought-years.mts snapshot.json[.gz] [state=Iowa] [pointIndex=1] [years=1988,2010,2012]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CROPS } from "../src/ui/crops";
import { loadSnapshot, type Snapshot } from "../src/ui/snapshot";
import { loadEnsembles } from "../src/ui/ensemble";
import { registerLocation, locationByKey, soilFor } from "../src/ui/locations";
import { STATE_PROFILES } from "../src/ui/states";
import { pointSoil } from "../src/ui/state-check";
import { simulateOption } from "../src/ui/model-run";
import { supplyDemand, summariseTypes } from "../src/ui/year-types";
import { seriesFor, buAcToDryTHa } from "../src/ui/validation";

const [file, stateArg = "Iowa", idx = "1", ys = "1988,2010,2012"] = process.argv.slice(2);
const snap = JSON.parse((file!.endsWith(".gz") ? gunzipSync(readFileSync(file!)) : readFileSync(file!)).toString()) as Snapshot;
loadSnapshot(snap);
const cfg = CROPS.maize;
const prof = STATE_PROFILES.find((p) => p.state === stateArg)!;
const pt = prof.points[Number(idx)]!;
const preset = locationByKey(prof.location);
const sp = await pointSoil(pt.lat, pt.lon);
const loc = registerLocation({ ...preset, key: `dy_${pt.lat}_${pt.lon}`, name: pt.name, lat: pt.lat, lon: pt.lon, soilParams: sp ?? undefined, pin: true });
const ens = (await loadEnsembles(cfg, loc)).base;
const plan = { sowDoy: cfg.sow.value, rm: cfg.defaults.rm, nRate: cfg.defaults.nRate, seedingRate: cfg.defaults.seedingRate, depthCm: cfg.defaults.depthCm, habit: cfg.defaults.habit, prev: "rotated" as const };
const obs = seriesFor("maize").find((s) => s.state === stateArg)!.years as Record<string, number>;
const rows = ens.years.map((y) => {
  const r = simulateOption(cfg, loc, soilFor(loc), plan as never, y.weather);
  return { label: y.label, yieldTHa: r.yieldTHa, sd: supplyDemand(r.days) };
});
const want = ys.split(",").map(Number);
console.log(`${stateArg} ${pt.name} (${pt.lat},${pt.lon}); ${rows.length} seasons ${rows[0]!.label}-${rows[rows.length - 1]!.label}`);
console.log("year,model_t_ha,flowering_sd,fill_sd,type,observed_state_t_ha");
for (const r of rows) if (want.includes(r.label) || r.sd.type !== "none") console.log([r.label, r.yieldTHa.toFixed(1), r.sd.flowering.toFixed(2), r.sd.fill.toFixed(2), r.sd.type, obs[r.label] ? buAcToDryTHa("maize", obs[r.label]!).toFixed(1) : ""].join(","));
console.log("\ntype,years,share,mean_yield");
for (const t of summariseTypes(rows)) console.log([t.key, t.years, t.share.toFixed(2), t.meanYield.toFixed(1)].join(","));

if (process.env.DIAG) {
  const soil = soilFor(loc);
  console.log("\nsoil", JSON.stringify({ src: sp ? "point" : "preset", layers: soil.layers.map((l) => ({ t: l.thickness, fc: l.fc, wp: l.wp })) }));
  for (const y of ens.years.filter((y) => want.concat([2021, 2022, 2023, 2005, 2006]).includes(y.label))) {
    const w = y.weather.slice(plan.sowDoy - cfg.yearStart, plan.sowDoy - cfg.yearStart + 150);
    const sum = (f: (d: (typeof w)[number]) => number) => w.reduce((a, d) => a + f(d), 0);
    console.log(y.label, "rain", sum((d) => d.rain).toFixed(0), "et0", sum((d) => (d as never as { et0?: number }).et0 ?? 0).toFixed(0), "tmax", (sum((d) => d.tmax) / w.length).toFixed(1), "rad", (sum((d) => d.radiation ?? 0) / w.length).toFixed(1));
  }
}

if (process.env.ET0TEST) {
  const factors = [1, 0.85, 0.7];
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const yrs = ens.years.filter((y) => obs[y.label]);
  const o = yrs.map((y) => buAcToDryTHa("maize", obs[y.label]!));
  const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; a.forEach((v, i) => { n += (v - ma) * (b[i]! - mb); da += (v - ma) ** 2; db += (b[i]! - mb) ** 2; }); return n / Math.sqrt(da * db); };
  const detr = (v: number[]) => { const x = yrs.map((y) => y.label); const mx = mean(x), mv = mean(v); let n = 0, d = 0; x.forEach((xi, i) => { n += (xi - mx) * (v[i]! - mv); d += (xi - mx) ** 2; }); const b = n / d; return v.map((vi, i) => vi - b * (x[i]! - mx)); };
  console.log("\net0 scale,mean_model,mean_obs,r_raw,r_detrended_obs,min_model");
  for (const f of [...factors, -1]) {
    const m = yrs.map((y) => simulateOption(cfg, loc, soilFor(loc), plan as never, y.weather.map((d) => (f < 0 ? { ...d, et0: undefined } : { ...d, et0: d.et0 === undefined ? undefined : d.et0 * f }))).yieldTHa);
    console.log([f < 0 ? "model's own estimate" : f, mean(m).toFixed(1), mean(o).toFixed(1), corr(m, o).toFixed(2), corr(m, detr(o)).toFixed(2), Math.min(...m).toFixed(1)].join(","));
  }
}
