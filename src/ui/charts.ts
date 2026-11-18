import { clamp } from "./draw-util";
import type { Run } from "./model-run";

export type ChartKind = "weather" | "light" | "biomass" | "stress";

export interface Theme {
  ink: string;
  muted: string;
  line: string;
  gold: string;
  leaf: string;
  water: string;
  heat: string;
  soil: string;
  paper: string;
}

const PAD = { l: 44, r: 44, t: 10, b: 22 };

/**
 * Southern-hemisphere locations run on the model's northern calendar moved by this many days, so every
 * date shown to the player is the model date minus the shift. Set when the location changes.
 */
let calShift = 0;
export const setCalendarShift = (days: number) => {
  calShift = days;
};
export const dateLabel = (doy: number) =>
  new Date(Date.UTC(2021, 0, doy - calShift)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * pow;
}

export function drawChart(
  c: HTMLCanvasElement,
  kind: ChartKind,
  run: Run,
  t: number,
  th: Theme,
) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = c.clientWidth;
  const cssH = c.clientHeight;
  if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const rows = run.result.days;
  const n = rows.length;
  const x0 = PAD.l;
  const x1 = cssW - PAD.r;
  const y0 = cssH - PAD.b;
  const y1 = PAD.t;
  const X = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, n - 1);

  ctx.font = "10.5px IBM Plex Mono, ui-monospace, monospace";
  ctx.textBaseline = "middle";

  const axisY = (min: number, max: number, unit = "", side: "l" | "r" = "l", color = th.muted) => {
    const step = niceStep(max - min, 4);
    ctx.textAlign = side === "l" ? "right" : "left";
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
      const y = y0 - ((v - min) / (max - min)) * (y0 - y1);
      if (side === "l") {
        ctx.strokeStyle = th.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.fillText(`${Math.round(v * 100) / 100}${unit}`, side === "l" ? x0 - 6 : x1 + 6, y);
    }
  };
  // x axis: a date every ~20 days
  ctx.textAlign = "center";
  ctx.fillStyle = th.muted;
  const pxPerDay = (x1 - x0) / Math.max(1, n - 1);
  const labelStep = Math.max(20, Math.ceil(66 / pxPerDay / 10) * 10);
  for (let i = 0; i < n; i += labelStep) {
    ctx.fillText(dateLabel(run.weather[i]!.doy), clamp(X(i), x0 + 14, x1 - 14), cssH - 8);
  }

  // critical window band
  const cp = run.result.criticalPeriod;
  if (cp.days > 0) {
    ctx.fillStyle = th.gold;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(X(cp.startDay - 1), y1, X(cp.endDay - 1) - X(cp.startDay - 1), y0 - y1);
    ctx.globalAlpha = 1;
  }

  const line = (vals: number[], min: number, max: number, color: string, w = 1.8) => {
    ctx.beginPath();
    vals.forEach((v, i) => {
      const y = y0 - ((clamp(v, min, max) - min) / (max - min)) * (y0 - y1);
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineJoin = "round";
    ctx.stroke();
  };
  const Y = (v: number, min: number, max: number) => y0 - ((v - min) / (max - min)) * (y0 - y1);
  const dashed = (y: number, color: string, label: string) => {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(label, x0 + 4, y - 7);
  };

  if (kind === "weather") {
    const tmaxs = rows.map((_, i) => run.weather[i]!.tmax);
    const tmins = rows.map((_, i) => run.weather[i]!.tmin);
    const min = Math.min(-5, Math.floor(Math.min(...tmins) / 5) * 5);
    const max = Math.max(40, Math.ceil(Math.max(...tmaxs) / 5) * 5);
    axisY(min, max, "°");
    // rain bars in the lower band, own scale on the right
    const rainTop = y0 - (y0 - y1) * 0.3;
    ctx.fillStyle = th.water;
    ctx.globalAlpha = 0.65;
    rows.forEach((_, i) => {
      const r = run.weather[i]!.rain;
      if (r <= 0) return;
      const h = ((rainTop === 0 ? 0 : Math.min(r, run.maxRain)) / run.maxRain) * (y0 - rainTop);
      ctx.fillRect(X(i) - 0.8, y0 - h, 1.6, h);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.water;
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(run.maxRain)} mm`, x1 + 6, rainTop);
    ctx.fillText("0 mm", x1 + 6, y0 - 2);
    dashed(Y(run.crop.heatThreshold, min, max), th.heat, `${run.crop.heatThreshold}°: heat damages ${run.cfg.grainWord} set`);
    const hardy = run.crop.frostHardyTemp;
    if (hardy !== undefined && hardy !== run.crop.frostKillTemp && hardy >= min) dashed(Y(hardy, min, max), th.water, `${hardy}°: hardened-crop limit before booting`);
    dashed(Y(run.crop.frostKillTemp, min, max), th.water, `${run.crop.frostKillTemp}°: ${run.cfg.frostLabel}`);
    line(tmaxs, min, max, th.heat);
    line(tmins, min, max, th.water);
  } else if (kind === "light") {
    const sr = rows.map((_, i) => run.weather[i]!.srad);
    const max = Math.max(30, Math.ceil(Math.max(...sr) / 5) * 5);
    axisY(0, max, "");
    ctx.beginPath();
    ctx.moveTo(X(0), y0);
    sr.forEach((v, i) => ctx.lineTo(X(i), Y(v, 0, max)));
    ctx.lineTo(X(n - 1), y0);
    ctx.fillStyle = th.gold;
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;
    const absorbed = rows.map((r, i) => sr[i]! * r.fi);
    ctx.beginPath();
    ctx.moveTo(X(0), y0);
    absorbed.forEach((v, i) => ctx.lineTo(X(i), Y(v, 0, max)));
    ctx.lineTo(X(n - 1), y0);
    ctx.fillStyle = th.leaf;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
    line(sr, 0, max, th.gold, 1.2);
  } else if (kind === "biomass") {
    const max = Math.ceil((run.maxTotal * 1.05) / 200) * 200;
    axisY(0, max, "");
    const layers: { key: "root" | "stem" | "leaf" | "deadLeaf" | "storage"; color: string }[] = [
      { key: "root", color: th.soil },
      { key: "stem", color: "#8fb36a" },
      { key: "leaf", color: th.leaf },
      { key: "deadLeaf", color: "#b9a468" },
      { key: "storage", color: th.gold },
    ];
    const cum = rows.map(() => 0);
    for (const L of layers) {
      const lower = cum.slice();
      rows.forEach((r, i) => (cum[i] = cum[i]! + r[L.key]));
      ctx.beginPath();
      rows.forEach((_, i) => (i === 0 ? ctx.moveTo(X(i), Y(cum[i]!, 0, max)) : ctx.lineTo(X(i), Y(cum[i]!, 0, max))));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(lower[i]!, 0, max));
      ctx.closePath();
      ctx.fillStyle = L.color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const laiMax = Math.max(1, Math.ceil(run.peakLai * 1.15));
    line(rows.map((r) => r.lai), 0, laiMax, th.ink, 1.6);
    // right axis: leaf area index
    const step = niceStep(laiMax, 4);
    ctx.textAlign = "left";
    ctx.fillStyle = th.ink;
    for (let v = 0; v <= laiMax + 1e-9; v += step) ctx.fillText(`${v}`, x1 + 6, Y(v, 0, laiMax));
  } else {
    axisY(0, 1, "");
    dashed(Y(0.7, 0, 1), th.muted, "below 0.7 = stress");
    line(rows.map((r) => (r.dvs >= 0 ? r.ws : NaN)).map((v) => (Number.isNaN(v) ? 1 : v)), 0, 1, th.water);
    line(rows.map((r) => r.nni), 0, 1, th.leaf);
    line(rows.map((r) => (r.dvs >= 0 ? r.tempFactor : 1)), 0, 1, th.heat, 1.1);
    if ((run.crop.vernRequired ?? 0) > 0) {
      ctx.setLineDash([5, 3]);
      line(rows.map((r) => r.vern), 0, 1, th.ink, 1.4);
      ctx.setLineDash([]);
    }
  }

  // frost marker
  if (run.result.frostKilled) {
    const xf = X(n - 1);
    ctx.strokeStyle = th.water;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xf, y1);
    ctx.lineTo(xf, y0);
    ctx.stroke();
  }

  // cursor
  const xc = X(clamp(t, 0, n - 1));
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xc, y1);
  ctx.lineTo(xc, y0);
  ctx.stroke();
  ctx.fillStyle = th.ink;
  ctx.beginPath();
  ctx.arc(xc, y0, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Convert a pointer x position over a chart canvas into a fractional day index. */
export function tFromPointer(c: HTMLCanvasElement, clientX: number, n: number): number {
  const rect = c.getBoundingClientRect();
  const x = clientX - rect.left;
  return clamp(((x - PAD.l) / Math.max(1, rect.width - PAD.l - PAD.r)) * (n - 1), 0, n - 1);
}
