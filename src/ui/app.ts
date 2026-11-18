import { drawChart, dateLabel, setCalendarShift, tFromPointer, type ChartKind, type Theme } from "./charts";
import { clamp } from "./draw-util";
import { LOCATIONS, DEFAULT_LOCATION, climateFacts, availableWaterMm, locationByKey, soilFor } from "./locations";
import { loadPin, PinError } from "./pin";
import { createPinMap, type PinMap } from "./map";
import { CROPS, runSeason, type CropKey, type Run, type Settings } from "./model-run";
import { drawScene, frameAt } from "./scene";
import { loadEnsembles, syntheticEnsemble, type LoadedEnsembles } from "./ensemble";
import { registerEnsemble, yearScenario, isYearScenario, type Ensemble } from "./weather-years";
import { DEFAULT_PRICES, compare, evaluate, meanLosses, nResponse, optimize, stressYield, type Evaluation, type Losses, type NResponse, type Option, type Prices } from "./decision";
import { LOSS_PARTS, OPTION_COLORS, drawExceedance, drawLosses, drawNResponse, drawYears, yearIndexAt } from "./results";
import { NASS, validate } from "./validation";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The settings of the season being played in the viewer: the selected plan on the selected weather year. */
let settings: Settings = { crop: "maize", location: DEFAULT_LOCATION, scenario: "typical", sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter", seed: 1 };
type HotApi = { snapshot?: (f: () => unknown) => void; ready?: (f: (d: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;

let crop: CropKey = "maize";
let locKey = DEFAULT_LOCATION;
let options: Option[] = [];
let active = 0;
let playKey = "median"; // "median", a year scenario like "y2012", or a stress test like "hazard"
let prices: Prices = { ...DEFAULT_PRICES.maize };
let ensBase: Ensemble = syntheticEnsemble(CROPS.maize, locationByKey(DEFAULT_LOCATION), 30, "Loading real weather…");
let ensIn: Ensemble | null = null;
let useIn = false;
let weatherSeq = 0;
let evals: Evaluation[] = [];
let nres: NResponse | null = null;
let lossRows: { name: string; k: number; l: Losses }[] = [];

let run: Run;
let t = 0;
let playing = false;
let firstPlay = true;
let scrubbing = false;
let dirty = true;
let theme: Theme;
let lastTheme = 0;

const scene = $("scene") as HTMLCanvasElement;
const sctx = scene.getContext("2d")!;
const chartEls: [ChartKind, HTMLCanvasElement][] = [
  ["weather", $("c-weather")],
  ["light", $("c-light")],
  ["biomass", $("c-biomass")],
  ["stress", $("c-stress")],
];

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => cs.getPropertyValue(n).trim();
  return { ink: g("--ink"), muted: g("--muted"), line: g("--line"), gold: g("--gold"), leaf: g("--leaf"), water: g("--water"), heat: g("--heat"), soil: g("--soil"), paper: g("--paper") };
}

function stageName(fr: ReturnType<typeof frameAt>): string {
  const s = fr.state;
  const r = run.result;
  return run.cfg.stageName({
    dvs: s.dvs,
    emerged: fr.emerged,
    killed: r.frostKilled && fr.i >= r.days.length - 1,
    inWindow: s.inWindow,
    kernels: s.kernels,
    tmean: (fr.tmax + fr.tmin) / 2,
  });
}

const fmt = (v: number, d = 1) => v.toFixed(d);

function setBar(key: string, v: number) {
  const f = $(`w-${key}`);
  f.style.width = `${Math.round(v * 100)}%`;
  f.className = "fill" + (v < 0.45 ? " bad" : v < 0.8 ? " warn" : "");
  $(`wv-${key}`).textContent = `${Math.round(v * 100)}%`;
}

function updateResult() {
  const r = run.result;
  const cp = r.criticalPeriod;
  $("res-yield").textContent = fmt(r.yieldTHa);
  $("w-dates").textContent = cp.days > 0 ? `${dateLabel(cp.startDoy)} to ${dateLabel(cp.endDoy)} · ${cp.days} days` : "The crop never reached its window";
  const c = run.conditions;
  setBar("radiation", c.radiation);
  setBar("temperature", c.temperature);
  setBar("water", c.water);
  setBar("nitrogen", c.nitrogen);
  setBar("heat", c.heat);
  $("w-score").textContent = c.score.toFixed(2);
  const flags: [string, string][] = [];
  if (r.frostKilled) flags.push(["bad", "Frost ended the season before maturity"]);
  if (r.matured) flags.push(["good", "Reached maturity"]);
  if (r.stand) {
    const st = r.stand;
    const ratio = st.plants / Math.max(1, st.seeds);
    flags.push([ratio < 0.7 ? "bad" : "good", `${st.plants < 20 ? fmt(st.plants) : Math.round(st.plants).toLocaleString("en-US")} plants per m² from ${st.seeds} seeds`]);
  }
  if (cp.completed) flags.push([cp.kernelsPerM2 < 1500 ? "bad" : "good", `${Math.round(cp.kernelsPerM2).toLocaleString("en-US")} ${run.cfg.grainWord}s per m²`]);
  if (cp.hotDays > 0) flags.push(["bad", `${cp.hotDays} hot days in the window`]);
  if (cp.meanWs < 0.7) flags.push(["bad", "Water stress in the window"]);
  if (cp.meanNni < 0.8) flags.push(["bad", "Nitrogen stress in the window"]);
  $("res-flags").innerHTML = flags.map(([k, v]) => `<li class="${k}">${v}</li>`).join("");
  const sc = $("scrub") as HTMLInputElement;
  const n = r.days.length;
  sc.max = String(n - 1);
  sc.style.setProperty("--w0", `${(100 * (cp.startDay - 1)) / Math.max(1, n - 1)}%`);
  sc.style.setProperty("--w1", `${(100 * (cp.endDay - 1)) / Math.max(1, n - 1)}%`);
}

const TIPS: Record<CropKey, { sow: string; rm: string; n: string; pop: string; depth: string }> = {
  maize: {
    sow: "Earlier means more season but a risk of cold seedlings. Later puts flowering into midsummer heat.",
    rm: "Longer hybrids catch more light and yield more, but need a long warm season to finish.",
    n: "More nitrogen lifts yield until water or light limit it. Extra is wasted and washes out.",
    pop: "More plants close the canopy sooner, but a maize plant makes one ear, so a crowded stand sets fewer kernels each. Dry or sandy fields do best with fewer plants.",
    depth: "Deeper seed sits in moister soil but takes longer to emerge, and slow emergence costs seedlings. Very shallow seed can dry out.",
  },
  wheat: {
    sow: "Autumn sowing lets winter wheat vernalize but exposes it to cold. Spring sowing skips winter.",
    rm: "Later classes fill grain longer but flower later, nearer the heat of early summer.",
    n: "Split in two doses: 30% at sowing, 70% in spring. Too little starves the crop at heading.",
    pop: "Wheat compensates for a thin stand by tillering, so yield is flat over a wide range. Very thin stands lose yield and very dense ones waste seed.",
    depth: "Deeper seed emerges later and loses more seedlings in cold soil. Very shallow seed can dry out.",
  },
};

function setPinOption(key: string, label: string) {
  const sel = $("loc") as HTMLSelectElement;
  sel.querySelectorAll("option[data-pin]").forEach((o) => o.remove());
  const o = document.createElement("option");
  o.value = key;
  o.textContent = label;
  o.dataset.pin = "1";
  sel.insertBefore(o, sel.firstChild);
}

let pinMap: PinMap | null = null;
let pinSeq = 0;
async function usePin(lat: number, lon: number) {
  const seq = ++pinSeq;
  const msg = $("mapMsg");
  msg.textContent = `Fetching weather since 1991 and soil layers for ${lat.toFixed(2)}, ${lon.toFixed(2)}…`;
  try {
    const loc = await loadPin(lat, lon);
    if (seq !== pinSeq) return;
    setPinOption(loc.key, `Your pin, ${loc.region}`);
    locKey = loc.key;
    history.replaceState(null, "", `#pin=${lat.toFixed(3)},${lon.toFixed(3)}`);
    playKey = "median";
    void loadWeather();
    pinMap?.mark(lat, lon);
    msg.textContent = `Pin set at ${loc.region}. Click again to move it. ${loc.blurb.includes("generic loam") ? "No soil data here, so a generic loam is used." : ""}`.trim();
  } catch (e) {
    if (seq !== pinSeq) return;
    msg.textContent = e instanceof PinError ? e.message : `Could not load data for this point (${e instanceof Error ? e.message : e}). Your previous location is unchanged.`;
  }
}

function parseCoords(t: string): [number, number] | null {
  const m = t.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function openMap() {
  const wrap = $("mapWrap");
  const open = wrap.hidden;
  wrap.hidden = !open;
  $("mapBtn").setAttribute("aria-expanded", String(open));
  $("mapBtn").textContent = open ? "Hide the map" : "Drop a pin on the map";
  if (!open) return;
  const loc = locationByKey(locKey);
  try {
    if (!pinMap) {
      $("mapMsg").textContent = "Loading the map…";
      pinMap = await createPinMap($("map"), { lat: loc.lat, lon: loc.lon }, (la, lo) => void usePin(la, lo));
      $("mapMsg").textContent = "Click anywhere between 66°S and 66°N. The site fetches the daily weather since 1991 and the soil layers for that point.";
    }
    pinMap.show(loc.lat, loc.lon);
  } catch (e) {
    $("mapMsg").textContent = `${e instanceof Error ? e.message : e}. You can still type latitude and longitude below.`;
  }
}

function updateLocation() {
  const loc = locationByKey(locKey);
  const f = climateFacts(loc);
  ($("loc") as HTMLSelectElement).value = loc.key;
  $("locCoords").textContent = `${Math.abs(loc.lat).toFixed(1)}°${loc.lat >= 0 ? "N" : "S"}, ${Math.abs(loc.lon).toFixed(1)}°${loc.lon >= 0 ? "E" : "W"}`;
  $("locBlurb").textContent = loc.blurb;
  const facts = [
    `Jan ${Math.round(f.jan)}°C, Jul ${Math.round(f.jul)}°C`,
    `Rain about ${Math.round(f.rainMm / 50) * 50} mm a year`,
    `${loc.soil.texture}, holds about ${Math.round(availableWaterMm(loc) / 10)} cm of usable water in the top metre`,
    `Latitude ${Math.abs(loc.lat).toFixed(1)}°${loc.lat >= 0 ? "N" : "S"} sets day length`,
  ];
  $("locFacts").innerHTML = facts.map((x) => `<li>${x}</li>`).join("");
}

const LEGENDS: Record<CropKey, string> = {
  maize:
    '<span><i style="background:var(--water)"></i>Water</span><span><i style="background:var(--leaf)"></i>Nitrogen</span><span><i style="background:var(--heat)"></i>Temperature response</span>',
  wheat:
    '<span><i style="background:var(--water)"></i>Water</span><span><i style="background:var(--leaf)"></i>Nitrogen</span><span><i style="background:var(--heat)"></i>Temperature response</span><span><i style="background:var(--ink)"></i>Vernalization (dashed)</span>',
};

/** Rebuild everything that depends on the crop: slider ranges, scenario list, labels. */
function configureCrop() {
  const cfg = CROPS[crop];
  const sow = $("sow") as HTMLInputElement;
  sow.min = String(cfg.sow.min);
  sow.max = String(cfg.sow.max);
  sow.step = String(cfg.sow.step);
  ($("nrate") as HTMLInputElement).max = String(cfg.nMax);
  $("rmLab").textContent = cfg.rmLabel;
  $("habitField").hidden = !cfg.habits;
  $("eyebrow").textContent = `Crop decision lab · ${cfg.label.toLowerCase()}`;
  $("r-kernels-t").textContent = cfg.grainWord === "kernel" ? "Kernels" : "Grains";
  $("lg-stress").innerHTML = LEGENDS[crop];
  $("tip-sow").textContent = TIPS[crop].sow;
  $("tip-rm").textContent = TIPS[crop].rm;
  $("tip-n").textContent = TIPS[crop].n;
  $("tip-pop").textContent = TIPS[crop].pop;
  $("tip-depth").textContent = TIPS[crop].depth;
  for (const [id, r] of [["pop", cfg.pop], ["depth", cfg.depth]] as const) {
    const el = $(id) as HTMLInputElement;
    el.min = String(r.min);
    el.max = String(r.max);
    el.step = String(r.step);
  }
  $("popLab").textContent = "Seeding rate";
  for (const k of Object.keys(CROPS) as CropKey[]) $(`crop-${k}`).setAttribute("aria-pressed", String(k === crop));
  const vis = cfg.habits ? "" : "none";
  $("r-vern-t").style.display = vis;
  $("r-vern").style.display = vis;
}

/** Show the selected plan's values on the sliders. */
function syncOutputs() {
  const o = options[active]!;
  $("sowOut").textContent = dateLabel(o.sowDoy);
  $("rmOut").textContent = crop === "wheat" ? `class ${o.rm}` : `${o.rm} days`;
  $("nOut").textContent = `${o.nRate} kg/ha`;
  $("popOut").textContent = `${o.seedingRate} seeds/m²`;
  $("depthOut").textContent = `${o.depthCm} cm`;
  ($("pop") as HTMLInputElement).value = String(o.seedingRate);
  ($("depth") as HTMLInputElement).value = String(o.depthCm);
  ($("habit") as HTMLSelectElement).value = o.habit;
  ($("sow") as HTMLInputElement).value = String(o.sowDoy);
  ($("rm") as HTMLInputElement).value = String(o.rm);
  ($("nrate") as HTMLInputElement).value = String(o.nRate);
}

/** Label of the year whose yield is the median for the selected plan. */
function medianLabel(): number {
  const e = evals[active];
  if (!e) return 1;
  const sorted = [...e.outcomes].sort((a, b) => a.yieldTHa - b.yieldTHa);
  return sorted[Math.floor((sorted.length - 1) / 2)]!.label;
}

function viewerScenario(): string {
  if (playKey === "median") return yearScenario(medianLabel());
  return playKey;
}

/** Play the selected plan on the selected season. */
function recompute(restart: boolean) {
  const o = options[active]!;
  settings = { crop, location: locKey, scenario: viewerScenario(), seed: 1, sowDoy: o.sowDoy, rm: o.rm, nRate: o.nRate, seedingRate: o.seedingRate, depthCm: o.depthCm, habit: o.habit };
  setCalendarShift(locationByKey(locKey).calShift ?? 0);
  run = runSeason(settings);
  syncOutputs();
  updateLocation();
  updateResult();
  const cp = run.result.criticalPeriod;
  if (restart) {
    t = 0;
    playing = true;
    firstPlay = false;
  } else {
    t = Math.min(t, run.result.days.length - 1);
  }
  if (!restart && firstPlay) t = cp.days > 0 ? (cp.startDay + cp.endDay) / 2 - 1 : 0;
  $("play").textContent = playing ? "Pause" : "Play season";
  dirty = true;
  const w = $("res-warn");
  w.hidden = run.result.matured || run.result.yieldTHa >= 1.5;
  w.textContent = run.result.frostKilled ? "A killing frost ended this season before maturity." : "This plan did not finish a crop in this season.";
  hot?.snapshot?.(() => ({ crop, locKey, options, active, playKey, prices }));
}

function updateReadouts() {
  const fr = frameAt(run, t);
  const s = fr.state;
  $("r-stage").textContent = stageName(fr);
  $("r-date").textContent = dateLabel(fr.doy);
  $("r-day").textContent = String(fr.i + 1);
  $("r-temp").textContent = `${fmt(fr.tmax, 0)}° / ${fmt(fr.tmin, 0)}°`;
  $("r-rain").textContent = `${fmt(fr.rain)} mm`;
  $("r-rad").textContent = `${fmt(fr.srad)} MJ/m²`;
  $("r-lai").textContent = fmt(s.lai, 2);
  const row = run.result.days[fr.i]!;
  $("r-bio").textContent = `${fmt(row.totalBiomass / 100)} t/ha`;
  $("r-grain").textContent = fr.emerged ? `${fmt(s.storage / 100)} t/ha` : "–";
  $("r-ws").textContent = fr.emerged ? fmt(s.ws, 2) : "–";
  $("r-nni").textContent = fr.emerged ? fmt(s.nni, 2) : "–";
  $("r-vern").textContent = `${Math.round(row.vern * 100)}%`;
  $("r-plants").textContent = run.result.stand ? (fr.emerged ? fmt(run.result.stand.plants, run.result.stand.plants < 20 ? 1 : 0) : "not yet emerged") : "–";
  $("r-kernels").textContent = s.kernels > 0 ? Math.round(s.kernels).toLocaleString("en-US") : "not yet set";
  if (!scrubbing) ($("scrub") as HTMLInputElement).value = String(t);
}

function resizeScene() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(scene.clientWidth * dpr);
  const h = Math.round(scene.clientHeight * dpr);
  if (scene.width !== w || scene.height !== h) {
    scene.width = w;
    scene.height = h;
  }
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && !scrubbing) {
    t += dt * Number(($("speed") as HTMLSelectElement).value);
    dirty = true;
    const end = run.result.days.length - 1;
    if (t >= end) {
      t = end;
      playing = false;
      $("play").textContent = "Replay";
    }
  }
  if (now - lastTheme > 500) {
    const nt = readTheme();
    const changed = !theme || JSON.stringify(nt) !== JSON.stringify(theme);
    if (changed) dirty = true;
    theme = nt;
    if (changed) drawPlots();
    lastTheme = now;
  }
  resizeScene();
  const fr = frameAt(run, t);
  drawScene(sctx, scene.clientWidth, scene.clientHeight, run, fr, run.cfg.art, now / 1000, calm);
  if (dirty) {
    for (const [k, c] of chartEls) drawChart(c, k, run, t, theme);
    updateReadouts();
    dirty = false;
  }
  requestAnimationFrame(frame);
}

function setPlaying(p: boolean) {
  playing = p;
  $("play").textContent = p ? "Pause" : t >= run.result.days.length - 1 ? "Replay" : "Play season";
}

const letter = (i: number) => String.fromCharCode(65 + i);
const planName = (i: number) => `Plan ${letter(i)}`;
const colorVar = (i: number) => `var(--${OPTION_COLORS[i % OPTION_COLORS.length]})`;
let optSeq = 0;
const newOption = (base: Omit<Option, "id" | "name">): Option => ({ ...base, id: `p${++optSeq}`, name: "" });
const defaultPlan = (k: CropKey) => {
  const cfg = CROPS[k];
  return { sowDoy: cfg.sow.value, rm: cfg.defaults.rm, nRate: cfg.defaults.nRate, seedingRate: cfg.defaults.seedingRate, depthCm: cfg.defaults.depthCm, habit: cfg.defaults.habit };
};
/** Start with the default plan and the same plan sown three weeks later, the usual first question. */
function starterPlans(k: CropKey): Option[] {
  const d = defaultPlan(k);
  return [newOption(d), newOption({ ...d, sowDoy: Math.min(CROPS[k].sow.max, d.sowDoy + 20) })];
}

const activeEns = (): Ensemble => (useIn && ensIn ? ensIn : ensBase);
const memo = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T {
  if (memo.has(key)) return memo.get(key) as T;
  if (memo.size > 400) memo.clear();
  const v = f();
  memo.set(key, v);
  return v;
}
const ensId = () => {
  const e = activeEns();
  return `${crop}|${locKey}|${e.source}|${e.years.length}|${e.inSeason?.through ?? ""}|${e.years[0]?.label}`;
};
const planKey = (o: Option) => `${o.habit}|${o.sowDoy}|${o.rm}|${o.nRate}|${o.seedingRate}|${o.depthCm}`;
const priceKey = () => `${prices.grain}|${prices.nitrogen}|${prices.seedPer1000}`;

function renderChips() {
  const box = $("chips");
  box.innerHTML = "";
  options.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", String(i === active));
    b.innerHTML = `<i style="background:${colorVar(i)}"></i>${planName(i)}`;
    b.addEventListener("click", () => selectPlan(i));
    box.appendChild(b);
  });
  ($("addPlan") as HTMLButtonElement).disabled = options.length >= 3;
  ($("delPlan") as HTMLButtonElement).disabled = options.length <= 1;
}

function selectPlan(i: number) {
  active = i;
  renderChips();
  syncOutputs();
  recompute(true);
  scheduleRefresh();
}

const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const labelText = (l: number) => (activeEns().source === "real" ? String(l) : `draw ${l}`);

function renderTable(cfg: (typeof CROPS)[CropKey]) {
  const loc = locationByKey(locKey);
  const soil = soilFor(loc);
  const stress = options.map((o) => stressYield(cfg, loc, soil, o, "hazard"));
  const bestOf = (vals: number[], max = true) => (max ? Math.max(...vals) : Math.min(...vals));
  const med = evals.map((e) => e.yield.median);
  const mean = evals.map((e) => e.net.mean);
  const w20 = evals.map((e) => e.net.worst20);
  const mn = evals.map((e) => e.yield.min);
  const fl = evals.map((e) => e.failures);
  const cls = (v: number, vals: number[], max = true) => (evals.length > 1 && v === bestOf(vals, max) ? ' class="best"' : "");
  const n = evals[0]?.outcomes.length ?? 0;
  const head = `<tr><th>Plan</th><th>Median yield</th><th>Typical range</th><th>Worst year</th><th>Failed years</th><th>Return, average</th><th>Return, worst fifth</th><th>${cfg.scenarios.hazard!.label}</th></tr>`;
  const rows = evals.map((e, i) => {
    const o = e.option;
    const plan = `${dateLabel(o.sowDoy)}, ${cfg.habits ? (o.habit === "winter" ? "winter, " : "spring, ") : ""}${o.nRate} N, ${o.seedingRate} seeds/m²`;
    return `<tr><td><span class="chip" style="padding:2px 8px;border-width:1px"><i style="background:${colorVar(i)}"></i>${planName(i)}</span> <small>${plan}</small></td>` +
      `<td${cls(med[i]!, med)}>${med[i]!.toFixed(1)} <small>t/ha</small></td>` +
      `<td>${e.yield.p10.toFixed(1)} to ${e.yield.p90.toFixed(1)}</td>` +
      `<td${cls(mn[i]!, mn)}>${mn[i]!.toFixed(1)} <small>(${labelText(e.worstYear)})</small></td>` +
      `<td${cls(fl[i]!, fl, false)}>${fl[i]} <small>of ${n}</small></td>` +
      `<td${cls(mean[i]!, mean)}>${money(mean[i]!)}</td>` +
      `<td${cls(w20[i]!, w20)}>${money(w20[i]!)}</td>` +
      `<td${cls(stress[i]!, stress)}>${stress[i]!.toFixed(1)} <small>t/ha</small></td></tr>`;
  });
  $("cmp").innerHTML = `<thead>${head}</thead><tbody>${rows.join("")}</tbody>`;
}

function renderVerdict() {
  const box = $("verdict");
  box.hidden = false;
  if (evals.length < 2) {
    box.innerHTML = "<p>Copy this plan and change one thing, such as the sowing date or the nitrogen rate, to see how the two compare across every year.</p>";
    return;
  }
  const lines: string[] = [];
  const a = evals[0]!;
  for (let i = 1; i < evals.length; i++) {
    const b = evals[i]!;
    const c = compare(a, b);
    const A = planName(0), B = planName(i);
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    let s = Math.abs(c.meanNet) < 5
      ? `${B} and ${A} return about the same on average (${money(c.meanNet)} a hectare apart).`
      : `On average ${c.meanNet > 0 ? B : A} returns ${money(Math.abs(c.meanNet))} a hectare more (${c.meanYield >= 0 ? "+" : ""}${c.meanYield.toFixed(1)} t/ha for ${B}).`;
    s += ` ${B} beats ${A} in ${pct(c.bWins)} of years and loses in ${pct(c.aWins)}.`;
    if (c.everyYear === "b") s += ` ${B} is at least as good as ${A} in every year.`;
    else if (c.everyYear === "a") s += ` ${A} is at least as good as ${B} in every year.`;
    else if (c.distribution) s += ` ${c.distribution === "b" ? B : A} comes out ahead at every level of risk.`;
    else if (c.meanNet * c.worst20Net < 0 && Math.abs(c.worst20Net) > 5) s += ` In the worst fifth of years ${c.worst20Net > 0 ? B : A} does better, so the choice trades average return against bad-year protection.`;
    lines.push(`<p>${s}</p>`);
  }
  box.innerHTML = lines.join("");
}

function populateYears() {
  const cfg = CROPS[crop];
  const e = evals[active];
  const sel = $("scenario") as HTMLSelectElement;
  const real = activeEns().source === "real";
  const med = e ? medianLabel() : 0;
  const yrs = e ? e.outcomes.map((o) => `<option value="${yearScenario(o.label)}">${real ? o.label : `Draw ${o.label}`} · ${o.yieldTHa.toFixed(1)} t/ha${o.frostKilled ? " · frost" : ""}</option>`).join("") : "";
  const stress = Object.entries(cfg.scenarios).filter(([k]) => k !== "typical").map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  sel.innerHTML = `<option value="median">Median year for this plan (${real ? med : `draw ${med}`})</option><optgroup label="${real ? "Real seasons" : "Synthetic seasons"}">${yrs}</optgroup><optgroup label="Stress tests (synthetic)">${stress}</optgroup>`;
  sel.value = playKey;
  if (sel.value !== playKey) sel.value = "median";
}

function drawPlots() {
  if (!theme || evals.length === 0) return;
  drawExceedance($("c-exceed") as HTMLCanvasElement, theme, evals, (e) => e.outcomes.map((o) => o.yieldTHa), "t/ha");
  const sel = isYearScenario(playKey) ? Number(playKey.slice(1)) : playKey === "median" ? medianLabel() : null;
  drawYears($("c-years") as HTMLCanvasElement, theme, evals, sel, "t/ha");
  if (nres) drawNResponse($("c-nresp") as HTMLCanvasElement, theme, nres, options[active]!.nRate, active);
  if (lossRows.length) drawLosses($("c-loss") as HTMLCanvasElement, theme, lossRows);
}

function refreshFast() {
  const cfg = CROPS[crop];
  const loc = locationByKey(locKey);
  const soil = soilFor(loc);
  const ens = activeEns();
  registerEnsemble(crop, locKey, ens);
  evals = options.map((o, i) => {
    const e = cached(`ev|${ensId()}|${priceKey()}|${planKey(o)}`, () => evaluate(cfg, loc, soil, o, ens, prices));
    return { ...e, option: { ...o, name: planName(i) } };
  });
  $("ensNote").textContent = ens.note;
  renderTable(cfg);
  renderVerdict();
  populateYears();
  const sw = options.map((_, i) => `<span><i style="background:${colorVar(i)}"></i>${planName(i)}</span>`).join("");
  $("sw-exceed").innerHTML = sw;
  $("sw-years").innerHTML = sw;
  $("sw-loss").innerHTML = LOSS_PARTS.map((p) => `<span><i style="background:var(--${p.theme});${p.key === "actual" ? "" : "opacity:.75"}"></i>${p.label}</span>`).join("");
  drawPlots();
  recompute(false);
}

function refreshSlow() {
  const cfg = CROPS[crop];
  const loc = locationByKey(locKey);
  const soil = soilFor(loc);
  const ens = activeEns();
  const o = options[active]!;
  nres = cached(`nr|${ensId()}|${priceKey()}|${planKey({ ...o, nRate: 0 })}`, () => nResponse(cfg, loc, soil, o, ens, prices, 20));
  $("nSub").textContent = `${planName(active)}: the best average return is at ${nres.best} kg N/ha, and rates from ${nres.range[0]} to ${nres.range[1]} are within about $1/ac of it. Your plan uses ${o.nRate}.`;
  lossRows = options.map((p, i) => ({ name: planName(i), k: i, l: cached(`ls|${ensId()}|${planKey(p)}`, () => meanLosses(cfg, loc, soil, p, ens)) }));
  drawPlots();
}

let tFast = 0;
let tSlow = 0;
function scheduleRefresh() {
  clearTimeout(tFast);
  clearTimeout(tSlow);
  tFast = window.setTimeout(refreshFast, 40);
  tSlow = window.setTimeout(refreshSlow, 400);
}

/** Load the real weather record for the current place and crop, showing synthetic seasons meanwhile. */
async function loadWeather() {
  const seq = ++weatherSeq;
  const cfg = CROPS[crop];
  const loc = locationByKey(locKey);
  ensBase = syntheticEnsemble(cfg, loc, 30, "Loading the weather record since 1991…");
  ensIn = null;
  $("inSeasonWrap").hidden = true;
  playKey = "median";
  scheduleRefresh();
  const got: LoadedEnsembles = await loadEnsembles(cfg, loc);
  if (seq !== weatherSeq) return;
  ensBase = got.base;
  ensIn = got.inSeason;
  if (!ensIn) useIn = false;
  ($("inSeason") as HTMLInputElement).checked = useIn;
  $("inSeasonWrap").hidden = !ensIn;
  if (ensIn?.inSeason) $("inSeasonText").textContent = `Use this season's weather so far (${ensIn.inSeason.label} season, real weather to ${ensIn.inSeason.through})`;
  scheduleRefresh();
}

async function runOptimize() {
  const btn = $("optimize") as HTMLButtonElement;
  const msg = $("optMsg");
  btn.disabled = true;
  const cfg = CROPS[crop];
  const loc = locationByKey(locKey);
  const soil = soilFor(loc);
  const ens = activeEns();
  const objective = ($("objective") as HTMLSelectElement).value as "mean" | "cautious";
  const from = options[active]!;
  try {
    const m = await optimize(cfg, loc, soil, from, ens, prices, objective, { onProgress: (d, n) => (msg.textContent = `Searching… ${Math.min(99, Math.round((100 * d) / n))}%`) });
    const plan = newOption(m);
    if (options.length < 3) {
      options = [...options, plan];
      active = options.length - 1;
    } else options = options.map((o, i) => (i === active ? plan : o));
    renderChips();
    syncOutputs();
    const before = evaluate(cfg, loc, soil, from, ens, prices);
    const after = evaluate(cfg, loc, soil, plan, ens, prices);
    msg.textContent = `Suggested ${planName(active)}: ${objective === "mean" ? `average return ${money(after.net.mean)} against ${money(before.net.mean)}` : `worst-fifth return ${money(after.net.worst20)} against ${money(before.net.worst20)}`} a hectare. It searched sowing date, maturity, nitrogen, seeding rate and depth on a sample of the years, so check the table.`;
    scheduleRefresh();
  } finally {
    btn.disabled = false;
  }
}

async function runValidation() {
  const out = $("valOut");
  const ref = NASS[crop];
  out.textContent = "Fetching the weather record and running every year…";
  const cfg = CROPS[crop];
  const loc = locationByKey(ref.location);
  const got = await loadEnsembles(cfg, loc);
  if (got.base.source !== "real") {
    out.textContent = `This check needs real weather, which did not load (${got.base.note}).`;
    return;
  }
  const d = defaultPlan(crop);
  const e = evaluate(cfg, loc, soilFor(loc), { ...d, id: "v", name: "default" }, got.base, prices);
  const v = validate(crop, new Map(e.outcomes.map((o) => [o.label, o.yieldTHa])));
  if (!v) {
    out.textContent = "Too few years overlap with the published figures to compare.";
    return;
  }
  const f = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
  out.innerHTML =
    `<p class="sub"><b>${ref.place}, default plan.</b> Correlation of year-to-year departures r = ${v.r.toFixed(2)} over ${v.rows.length} years; typical gap ${Math.round(v.mae * 100)} percentage points. Average yield: model ${v.meanModelled.toFixed(1)} against NASS ${v.meanObserved.toFixed(1)} t/ha dry grain (${f(v.meanModelled / v.meanObserved - 1)}).</p>` +
    `<table class="cmp"><thead><tr><th>Year</th><th>NASS state yield</th><th>Model</th><th>NASS vs its trend</th><th>Model vs its mean</th></tr></thead><tbody>` +
    v.rows.map((r) => `<tr><td>${r.year}</td><td>${r.observed.toFixed(1)}</td><td>${r.modelled.toFixed(1)}</td><td>${f(r.obsAnomaly)}</td><td>${f(r.modAnomaly)}</td></tr>`).join("") +
    `</tbody></table><p class="note2">t/ha dry grain. A state average mixes many soils and managements, so the model is expected to follow the direction of the years, not their size.</p>`;
}

function readPrice(id: string, fallback: number) {
  const v = Number(($(id) as HTMLInputElement).value);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

function setupCrop(k: CropKey) {
  crop = k;
  prices = { ...DEFAULT_PRICES[k] };
  ($("pGrain") as HTMLInputElement).value = String(prices.grain);
  ($("pN") as HTMLInputElement).value = String(prices.nitrogen);
  ($("pSeed") as HTMLInputElement).value = String(prices.seedPer1000);
  options = starterPlans(k);
  active = 0;
  playKey = "median";
  configureCrop();
  renderChips();
  syncOutputs();
}

function init() {
  ($("loc") as HTMLSelectElement).innerHTML = LOCATIONS.map((l) => `<option value="${l.key}">${l.name}, ${l.region}</option>`).join("");
  $("mapBtn").addEventListener("click", () => void openMap());
  $("coordForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = parseCoords(($("coordIn") as HTMLInputElement).value);
    if (!c) {
      $("mapMsg").textContent = "Type latitude and longitude as two numbers, like 42.03, -93.62.";
      return;
    }
    void usePin(c[0], c[1]);
  });
  const hp = location.hash.match(/^#pin=(-?[\d.]+),(-?[\d.]+)$/);
  $("loc").addEventListener("input", () => {
    locKey = ($("loc") as HTMLSelectElement).value;
    void loadWeather();
    recompute(true);
  });
  theme = readTheme();
  setupCrop(crop);
  (window as unknown as { __ready?: boolean }).__ready = true;
  recompute(false);
  if (hp) void usePin(Number(hp[1]), Number(hp[2]));
  else void loadWeather();

  const change = () => {
    const o = options[active]!;
    options[active] = {
      ...o,
      habit: ($("habit") as HTMLSelectElement).value as Option["habit"],
      sowDoy: Number(($("sow") as HTMLInputElement).value),
      rm: Number(($("rm") as HTMLInputElement).value),
      nRate: Number(($("nrate") as HTMLInputElement).value),
      seedingRate: Number(($("pop") as HTMLInputElement).value),
      depthCm: Number(($("depth") as HTMLInputElement).value),
    };
    syncOutputs();
    recompute(true);
    scheduleRefresh();
  };
  for (const id of ["habit", "sow", "rm", "nrate", "pop", "depth"]) $(id).addEventListener("input", change);
  $("scenario").addEventListener("input", () => {
    playKey = ($("scenario") as HTMLSelectElement).value;
    recompute(true);
    drawPlots();
  });
  for (const k of Object.keys(CROPS) as CropKey[]) {
    $(`crop-${k}`).addEventListener("click", () => {
      if (k === crop) return;
      setupCrop(k);
      playing = false;
      firstPlay = true;
      recompute(false);
      void loadWeather();
    });
  }
  $("addPlan").addEventListener("click", () => {
    if (options.length >= 3) return;
    options = [...options, newOption({ ...options[active]! })];
    active = options.length - 1;
    renderChips();
    syncOutputs();
    recompute(true);
    scheduleRefresh();
  });
  $("delPlan").addEventListener("click", () => {
    if (options.length <= 1) return;
    options = options.filter((_, i) => i !== active);
    active = Math.min(active, options.length - 1);
    renderChips();
    syncOutputs();
    recompute(true);
    scheduleRefresh();
  });
  $("optimize").addEventListener("click", () => void runOptimize());
  $("inSeason").addEventListener("change", () => {
    useIn = ($("inSeason") as HTMLInputElement).checked;
    scheduleRefresh();
  });
  for (const [id, key] of [["pGrain", "grain"], ["pN", "nitrogen"], ["pSeed", "seedPer1000"]] as const)
    $(id).addEventListener("input", () => {
      prices = { ...prices, [key]: readPrice(id, prices[key]) };
      scheduleRefresh();
    });
  $("runVal").addEventListener("click", () => void runValidation());
  const yc = $("c-years") as HTMLCanvasElement;
  yc.addEventListener("click", (e) => {
    const first = evals[0];
    if (!first) return;
    const i = yearIndexAt(yc, e.clientX, first.outcomes.length);
    playKey = yearScenario(first.outcomes[i]!.label);
    populateYears();
    recompute(true);
    drawPlots();
    $("scene").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  });
  $("play").addEventListener("click", () => {
    if (firstPlay || t >= run.result.days.length - 1) {
      t = 0;
      firstPlay = false;
      setPlaying(true);
    } else setPlaying(!playing);
    dirty = true;
  });
  $("restart").addEventListener("click", () => {
    t = 0;
    firstPlay = false;
    setPlaying(true);
    dirty = true;
  });

  // scrubbing: the slider and every chart
  const sc = $("scrub") as HTMLInputElement;
  let wasPlaying = false;
  const begin = () => {
    scrubbing = true;
    wasPlaying = playing;
  };
  const end = () => {
    scrubbing = false;
    firstPlay = false;
    if (wasPlaying) setPlaying(true);
  };
  sc.addEventListener("pointerdown", begin);
  sc.addEventListener("input", () => {
    t = Number(sc.value);
    dirty = true;
  });
  sc.addEventListener("pointerup", end);
  sc.addEventListener("change", () => {
    if (scrubbing) end();
  });
  for (const [, c] of chartEls) {
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      begin();
      t = tFromPointer(c, e.clientX, run.result.days.length);
      dirty = true;
    });
    c.addEventListener("pointermove", (e) => {
      if (!scrubbing) return;
      t = tFromPointer(c, e.clientX, run.result.days.length);
      dirty = true;
    });
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
  }
  window.addEventListener("resize", () => {
    dirty = true;
    drawPlots();
  });

  (window as unknown as { __viewer: unknown }).__viewer = {
    setT: (v: number) => {
      t = clamp(v, 0, run.result.days.length - 1);
      dirty = true;
    },
    pause: () => setPlaying(false),
    run: () => run,
  };
  requestAnimationFrame(frame);
}

const start = (d: unknown) => {
  void d;
  init();
};
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
