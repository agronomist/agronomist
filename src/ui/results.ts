import type { Evaluation, Losses, NResponse } from "./decision";
import type { Theme } from "./charts";

/** Colours of options A, B and C, as theme keys, so every chart and chip agree. */
export const OPTION_COLORS: (keyof Theme)[] = ["water", "gold", "leaf"];

function prep(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "10.5px IBM Plex Mono, ui-monospace, monospace";
  ctx.textBaseline = "middle";
  return { ctx, w, h };
}

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * pow;
}

const PAD = { l: 46, r: 14, t: 10, b: 24 };

interface Axes {
  X: (v: number) => number;
  Y: (v: number) => number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function frame(ctx: CanvasRenderingContext2D, th: Theme, w: number, h: number, xr: [number, number], yr: [number, number], xl: (v: number) => string, yl: (v: number) => string, xTicks = 6): Axes {
  const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
  const X = (v: number) => x0 + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (x1 - x0);
  const Y = (v: number) => y0 - ((v - yr[0]) / (yr[1] - yr[0] || 1)) * (y0 - y1);
  const ys = niceStep(yr[1] - yr[0], 4);
  ctx.textAlign = "right";
  for (let v = Math.ceil(yr[0] / ys) * ys; v <= yr[1] + 1e-9; v += ys) {
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Y(v));
    ctx.lineTo(x1, Y(v));
    ctx.stroke();
    ctx.fillStyle = th.muted;
    ctx.fillText(yl(v), x0 - 6, Y(v));
  }
  const xs = niceStep(xr[1] - xr[0], xTicks);
  ctx.textAlign = "center";
  for (let v = Math.ceil(xr[0] / xs) * xs; v <= xr[1] + 1e-9; v += xs) {
    ctx.fillStyle = th.muted;
    ctx.fillText(xl(v), X(v), h - 9);
  }
  return { X, Y, x0, x1, y0, y1 };
}

const color = (th: Theme, i: number) => th[OPTION_COLORS[i % OPTION_COLORS.length]!];

/** "Chance of at least this much": for every plan, the share of years that reached each value. */
export function drawExceedance(c: HTMLCanvasElement, th: Theme, evals: Evaluation[], pick: (e: Evaluation) => number[], unit: string, digits = 1) {
  const { ctx, w, h } = prep(c);
  const all = evals.flatMap(pick);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.05 || 1;
  lo -= pad;
  hi += pad;
  const a = frame(ctx, th, w, h, [lo, hi], [0, 1], (v) => v.toFixed(digits), (v) => `${Math.round(v * 100)}%`);
  evals.forEach((e, k) => {
    const v = [...pick(e)].sort((p, q) => p - q);
    const n = v.length;
    ctx.strokeStyle = color(th, k);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.X(lo), a.Y(1));
    v.forEach((x, i) => {
      ctx.lineTo(a.X(x), a.Y((n - i) / n));
      ctx.lineTo(a.X(x), a.Y((n - i - 1) / n));
    });
    ctx.lineTo(a.X(hi), a.Y(0));
    ctx.stroke();
  });
  ctx.fillStyle = th.muted;
  ctx.textAlign = "right";
  ctx.fillText(unit, w - PAD.r, PAD.t + 4);
}

/** Result of each real year for every plan; returns where each year sits so a click can pick one. */
export function drawYears(c: HTMLCanvasElement, th: Theme, evals: Evaluation[], selected: number | null, unit: string) {
  const { ctx, w, h } = prep(c);
  const labels = evals[0]!.outcomes.map((o) => o.label);
  const n = labels.length;
  const vals = evals.flatMap((e) => e.outcomes.map((o) => o.yieldTHa));
  const hi = Math.max(...vals) * 1.08;
  const real = labels[0]! > 1000;
  const a = frame(ctx, th, w, h, [0, n - 1], [0, hi], (v) => (real ? String(labels[Math.min(n - 1, Math.max(0, Math.round(v)))]) : String(Math.round(v) + 1)), (v) => v.toFixed(0), Math.max(3, Math.min(8, Math.floor((w - PAD.l - PAD.r) / 60))));
  const si = selected === null ? -1 : labels.indexOf(selected);
  if (si >= 0) {
    ctx.fillStyle = th.gold;
    ctx.globalAlpha = 0.18;
    const bw = (a.x1 - a.x0) / Math.max(1, n - 1);
    ctx.fillRect(a.X(si) - bw / 2, a.y1, bw, a.y0 - a.y1);
    ctx.globalAlpha = 1;
  }
  evals.forEach((e, k) => {
    ctx.strokeStyle = color(th, k);
    ctx.fillStyle = color(th, k);
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    e.outcomes.forEach((o, i) => (i ? ctx.lineTo(a.X(i), a.Y(o.yieldTHa)) : ctx.moveTo(a.X(i), a.Y(o.yieldTHa))));
    ctx.stroke();
    ctx.globalAlpha = 1;
    e.outcomes.forEach((o, i) => {
      ctx.beginPath();
      ctx.arc(a.X(i), a.Y(o.yieldTHa), o.frostKilled ? 3.6 : 2.2, 0, 7);
      ctx.fill();
    });
  });
  ctx.fillStyle = th.muted;
  ctx.textAlign = "right";
  ctx.fillText(unit, w - PAD.r, PAD.t + 4);
}

/** Index of the year under a pointer on the year-by-year chart. */
export function yearIndexAt(c: HTMLCanvasElement, clientX: number, n: number): number {
  const r = c.getBoundingClientRect();
  const x0 = PAD.l, x1 = r.width - PAD.r;
  return Math.min(n - 1, Math.max(0, Math.round(((clientX - r.left - x0) / (x1 - x0)) * (n - 1))));
}

/** Mean return and mean yield against nitrogen rate for one plan, with the profitable range shaded. */
export function drawNResponse(c: HTMLCanvasElement, th: Theme, r: NResponse, current: number, k: number) {
  const { ctx, w, h } = prep(c);
  const xs = r.points.map((p) => p.n);
  const net = r.points.map((p) => p.netMean);
  const p10 = r.points.map((p) => p.netP10);
  const lo = Math.min(...p10, ...net), hi = Math.max(...net);
  const pad = (hi - lo) * 0.08 || 10;
  const a = frame(ctx, th, w, h, [xs[0]!, xs[xs.length - 1]!], [lo - pad, hi + pad], (v) => String(Math.round(v)), (v) => `$${Math.round(v)}`);
  ctx.fillStyle = th.leaf;
  ctx.globalAlpha = 0.16;
  ctx.fillRect(a.X(r.range[0]), a.y1, Math.max(3, a.X(r.range[1]) - a.X(r.range[0])), a.y0 - a.y1);
  ctx.globalAlpha = 1;
  const line = (ys: number[], dash: number[], width: number) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = color(th, k);
    ctx.lineWidth = width;
    ctx.beginPath();
    xs.forEach((x, i) => (i ? ctx.lineTo(a.X(x), a.Y(ys[i]!)) : ctx.moveTo(a.X(x), a.Y(ys[i]!))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(p10, [4, 4], 1.4);
  line(net, [], 2.2);
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.X(current), a.y1);
  ctx.lineTo(a.X(current), a.y0);
  ctx.stroke();
  ctx.fillStyle = th.ink;
  ctx.textAlign = "left";
  ctx.fillText("plan", Math.min(a.X(current) + 4, w - 40), a.y1 + 6);
  ctx.fillStyle = th.muted;
  ctx.textAlign = "right";
  ctx.fillText("kg N/ha", w - PAD.r, h - 9);
}

export const LOSS_PARTS: { key: keyof Losses; label: string; theme: keyof Theme }[] = [
  { key: "actual", label: "Yield", theme: "leaf" },
  { key: "nitrogen", label: "Nitrogen shortfall", theme: "gold" },
  { key: "heat", label: "Heat at flowering", theme: "heat" },
  { key: "water", label: "Water shortage", theme: "water" },
  { key: "frost", label: "Frost", theme: "ink" },
];

/** Stacked bars: what each plan yields and where the rest of the potential goes. */
export function drawLosses(c: HTMLCanvasElement, th: Theme, rows: { name: string; k: number; l: Losses }[]) {
  const { ctx, w, h } = prep(c);
  const left = 70, right = w - 70;
  const max = Math.max(...rows.map((r) => r.l.potential), 1) * 1.02;
  const bh = Math.min(30, (h - 24) / rows.length - 10);
  rows.forEach((r, i) => {
    const y = 12 + i * (bh + 10);
    ctx.fillStyle = th.ink;
    ctx.textAlign = "left";
    ctx.fillText(r.name, 4, y + bh / 2);
    let x = left;
    for (const part of LOSS_PARTS) {
      const v = Math.max(0, r.l[part.key]);
      const wpx = (v / max) * (right - left);
      ctx.fillStyle = th[part.theme];
      if (part.key !== "actual") ctx.globalAlpha = 0.75;
      ctx.fillRect(x, y, wpx, bh);
      ctx.globalAlpha = 1;
      x += wpx;
    }
    ctx.fillStyle = th.muted;
    ctx.textAlign = "left";
    ctx.fillText(`${r.l.actual.toFixed(1)} of ${r.l.potential.toFixed(1)}`, right + 6, y + bh / 2);
  });
}
