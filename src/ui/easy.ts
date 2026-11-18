import { dateLabel } from "./charts";
import { CROPS, type CropKey } from "./crops";
import { compare, evaluate, optimize, type Evaluation, type Objective, type Option, type Prices } from "./decision";
import { locationByKey, soilFor } from "./locations";
import type { Management } from "./model-run";
import { buAcToDryTHa } from "./validation";
import type { Ensemble } from "./weather-years";

/** What the simple view needs from the page. */
export interface EasyEnv {
  crop: CropKey;
  locKey: string;
  ens: Ensemble;
  prices: Prices;
  /** Stable text that changes whenever the weather record does. */
  ensId: string;
}
export interface EasyHooks {
  env(): EasyEnv;
  /** Hand the plans to the full lab. `playLabel` is a weather year to play there. */
  openLab(plans: Management[], playLabel?: number): void;
}

const KG_HA_TO_LB_AC = 0.8922;
const PER_HA_TO_PER_AC = 1 / 2.4711;
const SEEDS_M2_TO_K_AC = 4.04686;

/** Yield in bushels per acre from dry t/ha, the units a Midwest grower thinks in. */
const bu = (crop: CropKey, tha: number) => tha / buAcToDryTHa(crop, 1);
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const lbN = (kg: number) => Math.round(kg * KG_HA_TO_LB_AC);

function maturityText(crop: CropKey, rm: number): string {
  return crop === "wheat" ? `class ${rm}` : crop === "soy" ? `MG ${(rm / 10).toFixed(1)}` : `${rm}-day`;
}
function planText(crop: CropKey, m: Management): string {
  const cfg = CROPS[crop];
  const parts = [`sow ${dateLabel(m.sowDoy)}`, maturityText(crop, m.rm)];
  if (cfg.habits) parts.splice(1, 0, m.habit);
  if (cfg.nMax > 0) parts.push(`${lbN(m.nRate)} lb N/ac`);
  return parts.join(" · ");
}

const cropWord = { maize: "corn", soy: "soybeans", wheat: "wheat" } as const;

export interface Easy {
  /** Called whenever the place, crop, weather or prices may have changed. Cheap if nothing did. */
  refresh(): void;
  /** Start over with this crop's default plan. */
  setCrop(k: CropKey): void;
}

export function createEasy(root: HTMLElement, hooks: EasyHooks): Easy {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  let crop: CropKey = hooks.env().crop;
  let today: Management = defaultToday(crop);
  let objective: Objective = "mean";
  let lastKey = "";
  let seq = 0;
  let timer = 0;
  const memo = new Map<string, { rec: Management; evT: Evaluation; evR: Evaluation }>();

  function defaultToday(k: CropKey): Management {
    const cfg = CROPS[k];
    return { sowDoy: cfg.sow.value, rm: cfg.defaults.rm, nRate: cfg.defaults.nRate, seedingRate: cfg.defaults.seedingRate, depthCm: cfg.defaults.depthCm, habit: cfg.defaults.habit, prev: "rotated" };
  }

  function buildControls() {
    const cfg = CROPS[crop];
    const nOn = cfg.nMax > 0;
    const prevOn = crop !== "wheat";
    q("#easyControls").innerHTML = `
      <div class="field"><label for="eSow">Sowing date</label><input id="eSow" type="range" min="${cfg.sow.min}" max="${cfg.sow.max}" step="${cfg.sow.step}"><output id="eSowOut"></output></div>
      <div class="field"><label for="eRm">${cfg.rmLabel}</label><input id="eRm" type="range" min="${cfg.rm.min}" max="${cfg.rm.max}" step="${cfg.rm.step}"><output id="eRmOut"></output></div>
      ${nOn ? `<div class="field"><label for="eN">Nitrogen</label><input id="eN" type="range" min="0" max="${lbN(cfg.nMax)}" step="10"><output id="eNOut"></output></div>` : ""}
      ${prevOn ? `<div class="field"><label for="ePrev">Last year's crop</label><select id="ePrev"><option value="rotated">${crop === "maize" ? "Soybeans" : "Corn"}</option><option value="same">${crop === "maize" ? "Corn again" : "Soybeans again"}</option></select></div>` : ""}`;
    syncControls();
    const on = (id: string, f: (el: HTMLInputElement) => void) => q<HTMLInputElement>(`#${id}`)?.addEventListener("input", (e) => {
      f(e.target as HTMLInputElement);
      syncControls();
      schedule(250);
    });
    on("eSow", (el) => (today = { ...today, sowDoy: Number(el.value) }));
    on("eRm", (el) => (today = { ...today, rm: Number(el.value) }));
    on("eN", (el) => (today = { ...today, nRate: Math.round(Number(el.value) / KG_HA_TO_LB_AC / 5) * 5 }));
    on("ePrev", (el) => (today = { ...today, prev: el.value as "rotated" | "same" }));
  }

  function syncControls() {
    const set = (id: string, v: string) => {
      const el = q<HTMLInputElement>(`#${id}`);
      if (el) el.value = v;
    };
    set("eSow", String(today.sowDoy));
    set("eRm", String(today.rm));
    set("eN", String(lbN(today.nRate)));
    set("ePrev", today.prev ?? "rotated");
    q("#eSowOut").textContent = dateLabel(today.sowDoy);
    q("#eRmOut").textContent = maturityText(crop, today.rm);
    const n = q("#eNOut");
    if (n) n.textContent = `${lbN(today.nRate)} lb N/ac`;
  }

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = window.setTimeout(() => void compute(), ms);
  }

  const asOption = (m: Management, id: string): Option => ({ ...m, id, name: id });

  async function compute() {
    const env = hooks.env();
    if (env.crop !== crop) return;
    const out = q("#easyOut");
    if (/^Loading/.test(env.ens.note)) {
      out.innerHTML = `<p class="easyWait">Loading the weather record for this place…</p>`;
      lastKey = "";
      return;
    }
    const pk = (m: Management) => `${m.prev}|${m.habit}|${m.sowDoy}|${m.rm}|${m.nRate}|${m.seedingRate}|${m.depthCm}`;
    const key = `${env.crop}|${env.locKey}|${env.ensId}|${env.prices.grain}|${env.prices.nitrogen}|${env.prices.seedPer1000}|${objective}|${pk(today)}`;
    if (key === lastKey) return;
    lastKey = key;
    const mine = ++seq;
    const cfg = CROPS[env.crop];
    const loc = locationByKey(env.locKey);
    const soil = soilFor(loc);
    let hit = memo.get(key);
    if (!hit) {
      const evT = evaluate(cfg, loc, soil, asOption(today, "today"), env.ens, env.prices);
      out.innerHTML = renderShell(env, evT, null, null);
      let rec: Management;
      try {
        rec = await optimize(cfg, loc, soil, today, env.ens, env.prices, objective, {
          onProgress: (d, n) => {
            if (mine === seq) q("#easyProg").textContent = `Looking for a better plan… ${Math.min(99, Math.round((100 * d) / n))}%`;
          },
        });
      } catch {
        return;
      }
      if (mine !== seq) return;
      const evR = evaluate(cfg, loc, soil, asOption(rec, "better"), env.ens, env.prices);
      hit = { rec, evT, evR };
      if (memo.size > 40) memo.clear();
      memo.set(key, hit);
    }
    if (mine !== seq) return;
    out.innerHTML = renderShell(env, hit.evT, hit.evR, compare(hit.evT, hit.evR, 5));
    q("#easyLab").onclick = () => hooks.openLab([today, hit!.rec]);
    q("#easyWorst").onclick = () => hooks.openLab([today, hit!.rec], hit!.evT.worstYear);
  }

  function renderShell(env: EasyEnv, a: Evaluation, b: Evaluation | null, cmp: ReturnType<typeof compare> | null): string {
    const c = env.crop;
    const ys = (e: Evaluation) => e.outcomes.map((o) => bu(c, o.yieldTHa));
    const col = (e: Evaluation, label: string, cls: string, m: Management) => `
      <div class="eplan ${cls}">
        <h3>${label}</h3>
        <p class="eplanText">${planText(c, m)}</p>
        <dl>
          <div><dt>Typical year</dt><dd>${Math.round(bu(c, e.yield.median))}<small> bu/ac</small></dd></div>
          <div><dt>1 year in 10 is worse than</dt><dd>${Math.round(bu(c, e.yield.p10))}<small> bu/ac</small></dd></div>
          <div><dt>Average return*</dt><dd>${money(e.net.mean * PER_HA_TO_PER_AC)}<small>/ac</small></dd></div>
        </dl>
      </div>`;
    const years = env.ens.years.length;
    let head: string;
    let rec: Management | null = null;
    let close = false;
    if (b && cmp) {
      rec = b.option;
      const gain = cmp.meanNet * PER_HA_TO_PER_AC;
      const bad = cmp.worst20Net * PER_HA_TO_PER_AC;
      const wins = Math.round(cmp.bWins * years);
      // under $3 an acre is inside the noise of a model like this; say so rather than present a "better" plan
      close = objective === "mean" ? gain < 3 : bad < 3 && gain < 3;
      if (close) head = `<b>Your plan is already close to the best we found</b> for ${cropWord[c]} here. Nothing we tried beat it by more than a few dollars an acre.`;
      else if (objective === "cautious") head = `<b>The safer plan makes about ${money(Math.abs(bad))} an acre ${bad >= 0 ? "more" : "less"} in the worst fifth of years</b> and ${money(Math.abs(gain))} an acre ${gain >= 0 ? "more" : "less"} on average. It beats yours in ${wins} of ${years} years.`;
      else head = `<b>The better plan makes about ${money(gain)} an acre more</b> on average and beats yours in ${wins} of ${years} years.` + (Math.abs(bad) > 10 ? ` In the worst fifth of years it ${bad >= 0 ? "makes" : "loses"} about ${money(Math.abs(bad))} an acre ${bad >= 0 ? "more" : "less"}.` : "");
    } else head = `<span id="easyProg">Looking for a better plan…</span>`;
    const chart = b && !close ? dots(c, ys(a), ys(b)) : "";
    const changes = rec && !close ? changeText(c, a.option, rec) : "";
    return `
      <p class="headline island">${head}</p>
      <div class="eplans${close ? " one" : ""}">${col(a, "Your plan", "mine", a.option)}${b && !close ? col(b, "A better plan", "better", b.option) : close ? "" : `<div class="eplan better wait"><h3>A better plan</h3><p class="eplanText">searching…</p></div>`}</div>
      ${changes}
      ${chart}
      <div class="eseg" role="group" aria-label="What to aim for">
        <button type="button" id="easyAvg" aria-pressed="${objective === "mean"}">Best on average</button>
        <button type="button" id="easySafe" aria-pressed="${objective === "cautious"}">Protect the bad years</button>
      </div>
      <p class="tip">*Return after nitrogen and seed only, at $${env.prices.grain} a tonne. ${env.ens.note}</p>`;
  }

  function changeText(c: CropKey, a: Management, b: Management): string {
    const bits: string[] = [];
    const d = b.sowDoy - a.sowDoy;
    if (d) bits.push(`sow ${Math.abs(d)} days ${d < 0 ? "earlier" : "later"} (${dateLabel(b.sowDoy)})`);
    if (b.rm !== a.rm) bits.push(`use a ${b.rm > a.rm ? "longer" : "shorter"} ${c === "maize" ? "hybrid" : c === "soy" ? "maturity group" : "class"} (${maturityText(c, b.rm)})`);
    if (b.nRate !== a.nRate && CROPS[c].nMax > 0) bits.push(`${b.nRate > a.nRate ? "add" : "cut"} nitrogen to ${lbN(b.nRate)} lb/ac`);
    if (b.seedingRate !== a.seedingRate) bits.push(`seed at ${(b.seedingRate * SEEDS_M2_TO_K_AC).toFixed(1)}k per acre`);
    return bits.length ? `<p class="echange">To get there: ${bits.join("; ")}.</p>` : "";
  }

  /** One dot per weather year on a shared yield axis, so the spread and the overlap are visible. */
  function dots(c: CropKey, a: number[], b: number[]): string {
    const all = [...a, ...b];
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const step = hi - lo > 120 ? 40 : hi - lo > 60 ? 20 : 10;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const X0 = 96, X1 = 624;
    const x = (v: number) => X0 + ((v - lo) / (hi - lo || 1)) * (X1 - X0);
    const med = (v: number[]) => [...v].sort((p, q2) => p - q2)[Math.floor(v.length / 2)]!;
    const row = (v: number[], y: number, color: string, label: string) =>
      `<text x="0" y="${y + 4}" class="dlab">${label}</text>` +
      v.map((d, i) => `<circle cx="${x(d).toFixed(1)}" cy="${y + ((i % 3) - 1) * 5}" r="4.2" fill="${color}" fill-opacity=".55"/>`).join("") +
      `<line x1="${x(med(v)).toFixed(1)}" x2="${x(med(v)).toFixed(1)}" y1="${y - 16}" y2="${y + 16}" stroke="${color}" stroke-width="2.5"/>`;
    let ticks = "";
    for (let v = lo; v <= hi; v += step) ticks += `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="26" y2="96" class="dgrid"/><text x="${x(v).toFixed(1)}" y="112" text-anchor="middle" class="dtick">${v}</text>`;
    return `<svg class="edots" viewBox="0 0 640 124" role="img" aria-label="Yield in every weather year for your plan and the better plan, bushels per acre">
      ${ticks}${row(a, 44, "var(--water)", "Your plan")}${row(b, 82, "var(--gold)", "Better")}
      <text x="${X1}" y="12" text-anchor="end" class="dtick">each dot is one real year · bar = typical · bu/ac</text></svg>`;
  }

  function wireStatic() {
    root.addEventListener("click", (e) => {
      const id = (e.target as HTMLElement).id;
      if (id === "easyAvg" || id === "easySafe") {
        objective = id === "easyAvg" ? "mean" : "cautious";
        lastKey = "";
        schedule(0);
      }
    });
  }

  buildControls();
  wireStatic();
  q<HTMLButtonElement>("#easyLab").onclick = () => hooks.openLab([today]);
  q<HTMLButtonElement>("#easyWorst").onclick = () => hooks.openLab([today]);
  return {
    refresh() {
      schedule(60);
    },
    setCrop(k) {
      crop = k;
      today = defaultToday(k);
      lastKey = "";
      buildControls();
      schedule(60);
    },
  };
}
