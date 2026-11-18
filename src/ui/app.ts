import { drawChart, dateLabel, setCalendarShift, tFromPointer, type ChartKind, type Theme } from "./charts";
import { clamp } from "./draw-util";
import { LOCATIONS, DEFAULT_LOCATION, climateFacts, availableWaterMm, locationByKey, soilFor } from "./locations";
import { loadPin, PinError } from "./pin";
import { createPinMap, type PinMap } from "./map";
import { CROPS, runSeason, type CropKey, type Management, type Run, type Settings } from "./model-run";
import { drawScene, frameAt, sceneTag, type Frame } from "./scene";
import { createScene3D, type Scene3D } from "./scene3d";
import { loadEnsembles, setHistorySource, syntheticEnsemble, type LoadedEnsembles } from "./ensemble";
import { registerEnsemble, yearScenario, isYearScenario, type Ensemble } from "./weather-years";
import { DEFAULT_PRICES, compare, evaluate, meanLosses, nResponse, optimize, stressYield, type Evaluation, type Losses, type NResponse, type Option, type Prices } from "./decision";
import { YEAR_TYPES, summariseTypes } from "./year-types";
import { LOSS_PARTS, OPTION_COLORS, drawExceedance, drawLosses, drawNResponse, drawYears, yearIndexAt } from "./results";
import { NASS, validate, type ValidationResult } from "./validation";
import { componentCheck, rowOk } from "./component-check";
import { collectAll, lastFailures, runStateCheck, type StateRow } from "./state-check";
import { buildSnapshot } from "./snapshot";
import { tradeoffs } from "./tradeoff";
import { inject } from "@vercel/analytics";
import { createEasy, type Easy } from "./easy";

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
let easy: Easy | null = null;
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
let view3d = true;
let scene3d: Scene3D | null = null;
let size3d = "";
// the WebGL field view: its code is a separate file, fetched the first time the view is chosen
interface GlScene { canvas: HTMLCanvasElement; render(run: Run, fr: Frame, time: number, calm: boolean): void; setSize(w: number, h: number): void }
let viewGl = false;
let glScene: GlScene | null = null;
let glState: "idle" | "loading" | "failed" = "idle";
function glFail(why: string) {
  glState = "failed";
  viewGl = false;
  ($("view") as HTMLSelectElement).value = "3d";
  $("sceneHint").textContent = `The WebGL view is not available here (${why}). Showing the standard 3D view.`;
}
function loadGl() {
  if (glState !== "idle") return;
  glState = "loading";
  const src = document.querySelector('meta[name="three-src"]')?.getAttribute("content") ?? "";
  if (!src || src.startsWith("/*")) return glFail("not in this build");
  const el = document.createElement("script");
  el.src = src;
  el.onload = () => {
    try {
      const api = (globalThis as unknown as { __cropThree?: { create(onDrag: () => void): GlScene } }).__cropThree;
      if (!api) return glFail("did not load");
      glScene = api.create(() => (dirty = true));
      scene.after(glScene.canvas);
      glState = "idle";
    } catch (e) {
      glFail("no WebGL");
    }
  };
  el.onerror = () => glFail("could not download");
  document.head.appendChild(el);
}
let glSize = "";
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
  soy: {
    sow: "Soybeans sown late April to mid May use the whole season. Later sowings flower sooner than they should and lose yield; very early ones risk a frost on seedlings.",
    rm: "Later maturity groups flower later and fill longer. Too late for the place and frost arrives before they finish; too early leaves light unused.",
    n: "Soybeans make their own nitrogen, so there is no nitrogen rate to set.",
    pop: "Soybeans branch and fill gaps, so yield is flat over a wide range of seeding rates. Only very thin stands lose yield.",
    depth: "Soybeans lift their seed leaves out of the soil, so deep seed emerges slowly and loses seedlings. Very shallow seed can dry out.",
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
  const go = $("coordForm").querySelector("button") as HTMLButtonElement;
  go.disabled = true;
  go.textContent = "Loading…";
  ($("coordIn") as HTMLInputElement).value = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  msg.classList.remove("err");
  msg.textContent = `Fetching weather since 1991 and soil layers for ${lat.toFixed(2)}, ${lon.toFixed(2)}. This can take up to 30 seconds.`;
  try {
    const loc = await loadPin(lat, lon);
    if (seq !== pinSeq) return;
    go.disabled = false;
    go.textContent = "Go";
    setPinOption(loc.key, `Your pin, ${loc.region}`);
    locKey = loc.key;
    history.replaceState(null, "", `#pin=${lat.toFixed(3)},${lon.toFixed(3)}`);
    playKey = "median";
    void loadWeather();
    pinMap?.mark(lat, lon);
    msg.textContent = `Pin set at ${loc.region}. Click again to move it. ${loc.blurb.includes("generic loam") ? "No soil data here, so a generic loam is used." : ""}`.trim();
  } catch (e) {
    if (seq !== pinSeq) return;
    go.disabled = false;
    go.textContent = "Go";
    msg.classList.add("err");
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
      $("mapMsg").textContent = "Click anywhere in the US Midwest. The site fetches the daily weather since 1991 and the soil layers for that point.";
    }
    pinMap.show(loc.lat, loc.lon);
  } catch (e) {
    $("mapMsg").textContent = `${e instanceof Error ? e.message : e}. You can still type latitude and longitude below.`;
  }
}

function setMode(m: "easy" | "lab") {
  document.body.classList.toggle("easy", m === "easy");
  $("dockEasy").setAttribute("aria-pressed", String(m === "easy"));
  $("dockLab").setAttribute("aria-pressed", String(m === "lab"));
  $("lede").textContent = m === "easy"
    ? "Pick a place and a crop, set the plan you would normally follow, and see how it does in every real weather year since 1991, next to a better one."
    : "Compare crop plans on every weather year since 1991, not on one guess. See the typical result, the bad years, the money, and where the yield goes, then play any single season to see why.";
  if (m === "lab") {
    window.dispatchEvent(new Event("resize"));
    scheduleRefresh();
  } else easy?.refresh();
}

function openLab(plans: Management[], playLabel?: number) {
  const base = plans.slice(0, 3).map((m) => newOption(m));
  if (base.length) options = base;
  active = 0;
  playKey = playLabel !== undefined ? yearScenario(playLabel) : "median";
  renderChips();
  syncOutputs();
  setMode("lab");
  window.scrollTo({ top: 0 });
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
  soy:
    '<span><i style="background:var(--water)"></i>Water</span><span><i style="background:var(--heat)"></i>Temperature response</span>',
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
  const rmEl = $("rm") as HTMLInputElement;
  rmEl.min = String(cfg.rm.min);
  rmEl.max = String(cfg.rm.max);
  rmEl.step = String(cfg.rm.step);
  const noN = cfg.nMax === 0;
  ($("nrate").closest(".field") as HTMLElement).hidden = noN;
  ($("c-nresp").closest(".card") as HTMLElement).hidden = noN;
  $("habitField").hidden = !cfg.habits;
  $("prevField").hidden = cfg.key === "wheat";
  $("tip-prev").textContent = cfg.key === "maize" ? "Corn after soybeans gets a nitrogen credit and avoids the continuous-corn penalty. Corn after corn needs more nitrogen and yields less." : "Soybeans after corn yield best. Soybeans after soybeans build up disease and lose some yield.";
  $("eyebrow").textContent = `Crop decision lab · ${cfg.label.toLowerCase()}`;
  $("r-kernels-t").textContent = cfg.grainWord === "kernel" ? "Kernels" : cfg.grainWord === "seed" ? "Seeds" : "Grains";
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
  $("rmOut").textContent = crop === "wheat" ? `class ${o.rm}` : crop === "soy" ? `MG ${(o.rm / 10).toFixed(1)}` : `${o.rm} days`;
  $("nOut").textContent = `${o.nRate} kg/ha`;
  $("popOut").textContent = `${o.seedingRate} seeds/m²`;
  $("depthOut").textContent = `${o.depthCm} cm`;
  ($("pop") as HTMLInputElement).value = String(o.seedingRate);
  ($("depth") as HTMLInputElement).value = String(o.depthCm);
  ($("habit") as HTMLSelectElement).value = o.habit;
  ($("prev") as HTMLSelectElement).value = o.prev ?? "rotated";
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
  const fr = frameAt(run, t);
  if (viewGl && !glScene) loadGl();
  const useGl = viewGl && glScene !== null;
  scene.style.display = useGl ? "none" : "";
  if (glScene) glScene.canvas.style.display = useGl ? "block" : "none";
  if (useGl && glScene) {
    const w = glScene.canvas.clientWidth;
    const h = glScene.canvas.clientHeight;
    const key = `${w}x${h}x${window.devicePixelRatio}`;
    if (key !== glSize) {
      glScene.setSize(w, h);
      glSize = key;
    }
    glScene.render(run, fr, now / 1000, calm);
  } else if (view3d) {
    scene3d ??= createScene3D(scene, () => (dirty = true));
    const w = scene.clientWidth;
    const h = scene.clientHeight;
    const key = `${w}x${h}x${window.devicePixelRatio}`;
    if (key !== size3d) {
      scene3d.setSize(w, h);
      size3d = key;
    }
    scene3d.render(run, fr, now / 1000, calm);
  } else {
    scene.style.background = "";
    resizeScene();
    drawScene(sctx, scene.clientWidth, scene.clientHeight, run, fr, run.cfg.art, now / 1000, calm);
  }
  {
    const tag = sceneTag(run, fr);
    const el = $("sceneTag");
    const key = tag ? `${tag.kind}|${tag.text}` : "";
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.hidden = !tag;
      el.className = `scene-tag ${tag?.kind ?? ""}`;
      el.textContent = tag?.text ?? "";
    }
  }
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
const planKey = (o: Option) => `${o.prev ?? "rotated"}|${o.habit}|${o.sowDoy}|${o.rm}|${o.nRate}|${o.seedingRate}|${o.depthCm}`;
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

function renderYearTypes() {
  const t = $("ytypes");
  if (evals.length === 0) { t.innerHTML = ""; return; }
  const rows = evals.map((e) => summariseTypes(e.outcomes));
  const head = `<tr><th>Season type</th>${evals.map((_, i) => `<th><span class="chip" style="padding:2px 8px;border-width:1px"><i style="background:${colorVar(i)}"></i>${planName(i)}</span></th>`).join("")}</tr>`;
  const body = YEAR_TYPES.map((ty, k) => `<tr><td>${ty.label}<br><small>${ty.hint}</small></td>${rows.map((r) => { const x = r[k]!; return `<td>${Math.round(x.share * 100)}% <small>(${x.years})</small>${x.years ? `<br>${x.meanYield.toFixed(1)} <small>t/ha</small>` : ""}</td>`; }).join("")}</tr>`).join("");
  t.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
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
  renderYearTypes();
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
  if (cfg.nMax === 0) nres = null;
  else nres = cached(`nr|${ensId()}|${priceKey()}|${planKey({ ...o, nRate: 0 })}`, () => nResponse(cfg, loc, soil, o, ens, prices, 20));
  if (nres) $("nSub").textContent = `${planName(active)}: the best average return is at ${nres.best} kg N/ha, and rates from ${nres.range[0]} to ${nres.range[1]} are within about $1/ac of it. Your plan uses ${o.nRate}.`;
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
  easy?.refresh();
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

async function runTradeoffs() {
  const btn = $("tradeoff") as HTMLButtonElement;
  const msg = $("optMsg");
  const out = $("tradeOut");
  btn.disabled = true;
  const cfg = CROPS[crop];
  const loc = locationByKey(locKey);
  try {
    const rows = await tradeoffs(cfg, loc, soilFor(loc), options[active]!, activeEns(), prices, { onProgress: (d, n) => (msg.textContent = `Comparing plans… ${Math.min(99, Math.round((100 * d) / n))}%`) });
    msg.textContent = "";
    out.innerHTML =
      `<table class="cmp"><thead><tr><th>Sow</th><th>Maturity</th><th>Nitrogen</th><th>Average return, $/ha</th><th>Bad-year return, $/ha</th><th>Average yield</th><th></th></tr></thead><tbody>` +
      rows
        .map((c, i) => `<tr><td>${dateLabel(c.plan.sowDoy)}</td><td>${c.plan.rm}</td><td>${c.plan.nRate}</td><td>${money(c.meanNet)}</td><td>${money(c.worstNet)}</td><td>${c.meanYield.toFixed(1)} t/ha</td><td><button type="button" data-use="${i}">Use</button></td></tr>`)
        .join("") +
      `</tbody></table><p class="note2">These plans are the efficient ones: none is beaten by another on average return, return in the worst fifth of years and nitrogen all at once. Moving down the table usually gives up average return for steadier years or less nitrogen. Returns count only nitrogen and seed cost, on a sample of the years.</p>`;
    out.querySelectorAll<HTMLButtonElement>("button[data-use]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = rows[Number(b.dataset.use)]!;
        const plan = newOption({ ...options[active]!, sowDoy: c.plan.sowDoy, rm: c.plan.rm, nRate: c.plan.nRate });
        if (options.length < 3) {
          options = [...options, plan];
          active = options.length - 1;
        } else options = options.map((o, i) => (i === active ? plan : o));
        renderChips();
        syncOutputs();
        scheduleRefresh();
      }),
    );
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

async function runValidationAll() {
  const out = $("valAllOut");
  const d = defaultPlan(crop);
  let rows: StateRow[];
  try {
    rows = await runStateCheck(crop, { ...d, prev: "rotated" }, prices, (m) => (out.textContent = `Running ${m} This takes a minute or two the first time: it fetches weather and soil for about thirty points.`));
  } catch (e) {
    out.textContent = `The check stopped: ${e instanceof Error ? e.message : e}`;
    return;
  }
  const f = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "n/a" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`);
  const r2 = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(2));
  const avg = (a: (number | undefined)[]) => {
    const v = a.filter((x): x is number => x !== undefined && !Number.isNaN(x));
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
  };
  const ok = rows.filter((r) => r.preset || r.points);
  const absAvg = (g: (r: StateRow) => number | undefined) => avg(ok.map((r) => (g(r) === undefined ? undefined : Math.abs(g(r)!))));
  const csv = ["state,years,r_one,gap_one,r_points,gap_points,r_full,gap_full,r_timed,gap_timed,swing_timed,note", ...rows.map((r) => [r.state, r.years, r2(r.preset?.r), r.preset?.levelGap.toFixed(3), r2(r.points?.r), r.points?.levelGap.toFixed(3), r2(r.full?.r), r.full?.levelGap.toFixed(3), r2(r.timed?.r), r.timed?.levelGap.toFixed(3), r2(r.timed?.sensitivity), r.note].join(","))].join("\n");
  const cell = (v: ValidationResult | null) => (v ? `r ${v.r.toFixed(2)} · ${f(v.levelGap)}` : "n/a");
  out.innerHTML =
    `<table class="cmp"><thead><tr><th>State</th><th>Years</th><th>One point</th><th>Weighted points</th><th>+ irrigation, drainage, water table</th><th>+ year-by-year sowing</th><th>Swing size</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${r.state}</td><td>${r.years}</td><td>${cell(r.preset)}</td><td>${cell(r.points)}</td><td>${cell(r.full)}</td><td>${cell(r.timed)}</td><td>${r2(r.timed?.sensitivity)}</td></tr>`).join("") +
    `</tbody></table><p class="note2">Each cell is the correlation of year-to-year departures (r) and the model's average level against the NASS trend extended to 2020. Mean absolute level gap: one point ${f(absAvg((r) => r.preset?.levelGap))}, weighted points ${f(absAvg((r) => r.points?.levelGap))}, with irrigation, drainage and water table ${f(absAvg((r) => r.full?.levelGap))}, with year-by-year sowing ${f(absAvg((r) => r.timed?.levelGap))}. Average r: ${r2(avg(ok.map((r) => r.preset?.r)))}, ${r2(avg(ok.map((r) => r.points?.r)))}, ${r2(avg(ok.map((r) => r.full?.r)))}, ${r2(avg(ok.map((r) => r.timed?.r)))}. ${rows.filter((r) => r.note).map((r) => `${r.state}: ${r.note}.`).join(" ")}</p>` +
    `<textarea readonly rows="${rows.length + 2}" style="width:100%;font:12px monospace" onfocus="this.select()">${csv}</textarea>`;
}

async function saveSnapshot() {
  const out = $("snapOut");
  try {
    setHistorySource(($("snapSource") as HTMLSelectElement).value === "openmeteo" ? "openmeteo" : "power");
    const failed = await collectAll((m) => (out.textContent = `Fetching ${m}`));
    if (failed) {
      out.textContent = `${failed} weather record(s) did not load: ${lastFailures.join("; ").slice(0, 400)}. Press the button again: it keeps what it already has and only fetches the rest.`;
      return;
    }
    out.textContent = "Packing…";
    const text = JSON.stringify(await buildSnapshot());
    let blob = new Blob([text], { type: "application/json" });
    let name = "agronomist-snapshot.json";
    if (typeof CompressionStream !== "undefined") {
      blob = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
      name += ".gz";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.textContent = `Download ${name} (${(blob.size / 1e6).toFixed(1)} MB)`;
    out.textContent = "";
    out.appendChild(a);
    a.click();
  } catch (e) {
    out.textContent = `The snapshot stopped: ${e instanceof Error ? e.message : e}`;
  }
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
  easy?.setCrop(k);
}

function init() {
  try {
    inject();
  } catch {
    // analytics must never break the page
  }
  ($("loc") as HTMLSelectElement).innerHTML = LOCATIONS.filter((l) => !l.hidden && !l.synthetic).map((l) => `<option value="${l.key}">${l.name}, ${l.region}</option>`).join("");
  $("mapBtn").addEventListener("click", () => void openMap());
  $("coordForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = parseCoords(($("coordIn") as HTMLInputElement).value);
    if (!c) {
      $("mapMsg").classList.add("err");
      $("mapMsg").textContent = ($("coordIn") as HTMLInputElement).value.trim() ? "Type latitude and longitude as two numbers, like 42.03, -93.62." : "Nothing to go to yet. Click the map to drop a pin, or type latitude and longitude like 42.03, -93.62.";
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
  easy = createEasy($("easy"), { env: () => ({ crop, locKey, ens: activeEns(), prices, ensId: ensId() }), openLab });
  $("backEasy").addEventListener("click", () => setMode("easy"));
  $("dockEasy").addEventListener("click", () => setMode("easy"));
  $("dockLab").addEventListener("click", () => setMode("lab"));
  setupCrop(crop);
  setMode("easy");
  (window as unknown as { __ready?: boolean }).__ready = true;
  recompute(false);
  if (hp) void usePin(Number(hp[1]), Number(hp[2]));
  else void loadWeather();

  const change = () => {
    const o = options[active]!;
    options[active] = {
      ...o,
      habit: ($("habit") as HTMLSelectElement).value as Option["habit"],
      prev: ($("prev") as HTMLSelectElement).value as Option["prev"],
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
  for (const id of ["habit", "prev", "sow", "rm", "nrate", "pop", "depth"]) $(id).addEventListener("input", change);
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
  $("tradeoff").addEventListener("click", () => void runTradeoffs());
  $("view").addEventListener("input", () => {
    const v = ($("view") as HTMLSelectElement).value;
    viewGl = v === "gl";
    view3d = v === "3d" || viewGl; // the standard 3D view draws while the WebGL code is still downloading
    size3d = "";
    glSize = "";
    scene.style.cursor = view3d ? "grab" : "";
    $("sceneHint").textContent = viewGl ? "Drag sideways to turn it. Each soil label shows the water that layer holds." : view3d ? "Drag the scene to turn it." : "Soil layers darken as they hold more water.";
  });
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
  $("runComp").addEventListener("click", () => {
    const rows = componentCheck();
    const f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
    $("compOut").innerHTML = `<table class="cmp"><thead><tr><th>Part</th><th>Model</th><th>Published</th><th>Result</th></tr></thead><tbody>${rows
      .map((r) => `<tr><td>${r.name}<br><span class="tip">${r.source}${r.note ? `. Note: ${r.note}` : ""}</span></td><td>${f(r.model)}</td><td>${f(r.low)} to ${f(r.high)} ${r.unit}</td><td>${rowOk(r) ? "within" : r.model > r.high ? "above" : "below"}</td></tr>`)
      .join("")}</tbody></table>`;
  });
  $("runValAll").addEventListener("click", (e) => {
    const b = e.target as HTMLButtonElement;
    b.disabled = true;
    void runValidationAll().finally(() => (b.disabled = false));
  });
  $("runSnap").addEventListener("click", (e) => {
    const b = e.target as HTMLButtonElement;
    b.disabled = true;
    void saveSnapshot().finally(() => (b.disabled = false));
  });
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
