import { clamp, lerp, mix, seeded, type PlantArt, type PlantState } from "./draw-util";
import { type Run } from "./model-run";

export interface Frame {
  i: number;
  state: PlantState;
  doy: number;
  tmax: number;
  tmin: number;
  srad: number;
  rain: number;
  soilRel: number[]; // relative available water per layer, 0-1
  rootDepthMm: number;
  emerged: boolean;
  /** 0-1 position within the season */
  progress: number;
}

/** Interpolated model state at fractional day t. */
export function frameAt(run: Run, t: number): Frame {
  const rows = run.result.days;
  const i = Math.min(rows.length - 1, Math.max(0, Math.floor(t)));
  const j = Math.min(rows.length - 1, i + 1);
  const f = clamp(t - i, 0, 1);
  const a = rows[i]!;
  const b = rows[j]!;
  const smooth = a.dvs >= 0 && b.dvs >= 0;
  const L = (x: number, y: number) => (smooth ? lerp(x, y, f) : x);
  const w = run.weather[i]!;
  const dvs = L(a.dvs, b.dvs);
  const stem = L(a.stem, b.stem);
  const lai = L(a.lai, b.lai);
  const storage = L(a.storage, b.storage);
  const emerged = a.dvs >= 0;
  const soilLayers = run.soil.layers;
  const soilRel = soilLayers.map((l, k) => {
    const wp = l.wiltingPoint * l.thickness;
    const fc = l.fieldCapacity * l.thickness;
    const v = lerp(a.soilWaterLayers[k]!, b.soilWaterLayers[k]!, f);
    return clamp((v - wp) / (fc - wp), 0, 1);
  });
  const frostEnd = run.result.frostKilled && i >= rows.length - 1;
  return {
    i,
    doy: w.doy,
    tmax: w.tmax,
    tmin: w.tmin,
    srad: w.srad,
    rain: w.rain,
    soilRel,
    emerged,
    progress: rows.length > 1 ? clamp(t / (rows.length - 1), 0, 1) : 0,
    rootDepthMm: emerged ? run.crop.rootDepthInitial + (run.crop.rootDepthMax - run.crop.rootDepthInitial) * clamp(dvs, 0, 1) : 0,
    state: {
      dvs,
      lai,
      leaf: L(a.leaf, b.leaf),
      stem,
      storage,
      deadLeaf: L(a.deadLeaf, b.deadLeaf),
      ws: L(a.ws, b.ws),
      nni: L(a.nni, b.nni),
      inWindow: a.inWindow,
      kernels: a.kernels,
      frostKilled: frostEnd,
      hFrac: emerged ? Math.pow(clamp(stem / run.maxStem, 0, 1), 0.55) : 0,
      leafScale: clamp(0.25 + 0.75 * Math.sqrt(lai / Math.max(run.peakLai, 0.1)), 0, 1),
      earFrac: clamp(storage / run.maxStorage, 0, 1),
      winStartDvs: run.winStartDvs,
    },
  };
}

const rootRand = seeded(7);
/** "rgb(r,g,b)" from mix() to "r,g,b" */
function rgbOf(c: string): string {
  return c.replace(/^rgb\(|\)$/g, "");
}
const ROOT_LATERALS = Array.from({ length: 40 }, () => ({ side: rootRand() < 0.5 ? -1 : 1, len: 0.4 + 0.6 * rootRand(), wob: rootRand() * 6 }));
const cloudRand = seeded(11);
const CLOUDS = Array.from({ length: 5 }, () => ({ x: cloudRand(), y: 0.08 + 0.3 * cloudRand(), s: 0.7 + 0.8 * cloudRand(), v: 0.004 + 0.006 * cloudRand() }));

export function drawScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  run: Run,
  fr: Frame,
  art: PlantArt,
  time: number,
  calm: boolean,
) {
  const skyH = H * 0.56;
  const groundY = skyH;
  const st = fr.state;

  // ---- Sky: clearer and bluer with more radiation, warmer when hot, paler in frost ----
  const clarity = clamp((fr.srad - 6) / 18, 0, 1);
  let top = mix("#8d9fb0", "#3f86d3", clarity);
  let bot = mix("#cbd5dc", "#bde2f5", clarity);
  const hot = clamp((fr.tmax - 33) / 8, 0, 1);
  bot = mix(bot, "#f3c685", hot * 0.8);
  top = mix(top, "#6f9bc4", hot * 0.4);
  const frost = fr.tmin <= 0;
  const snow = fr.tmax <= 1;
  if (frost) {
    top = mix(top, "#b9c8d9", 0.5);
    bot = mix(bot, "#e8f0f7", 0.6);
  }
  const sky = ctx.createLinearGradient(0, 0, 0, skyH);
  sky.addColorStop(0, top);
  sky.addColorStop(1, bot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, skyH);

  // sun: size and glow follow radiation
  const sunX = W * (0.12 + 0.76 * fr.progress);
  const elevation = 0.5 + 0.5 * Math.cos((2 * Math.PI * (fr.doy - 172)) / 365); // 1 at the June solstice
  const sunY = skyH * (0.6 - 0.42 * elevation);
  const sr = 14 + 18 * clarity;
  const glow = ctx.createRadialGradient(sunX, sunY, sr * 0.4, sunX, sunY, sr * 4.2);
  glow.addColorStop(0, `rgba(255,236,160,${0.15 + 0.6 * clarity})`);
  glow.addColorStop(1, "rgba(255,236,160,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - sr * 4.2, sunY - sr * 4.2, sr * 8.4, sr * 8.4);
  ctx.beginPath();
  ctx.arc(sunX, sunY, sr, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,243,190,${0.45 + 0.55 * clarity})`;
  ctx.fill();

  // clouds: more cover on low-radiation days
  const cover = 1 - clarity;
  for (const c of CLOUDS) {
    const x = ((c.x + (calm ? 0 : time * c.v)) % 1.3) * W - W * 0.15;
    const y = c.y * skyH;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * cover})`;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(x + k * 22 * c.s, y + (k % 2) * 4, 30 * c.s, 12 * c.s * (0.5 + cover * 0.7), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // distant hills
  ctx.fillStyle = snow ? "#dfe7ec" : mix("#6f8f5d", "#9aa38a", frost ? 0.5 : 0);
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  for (let x = 0; x <= W; x += 12) ctx.lineTo(x, groundY - 18 - 10 * Math.sin(x * 0.011) - 6 * Math.sin(x * 0.027 + 1));
  ctx.lineTo(W, groundY);
  ctx.fill();

  // ---- Field strip ----
  const fieldTop = groundY - 6;
  ctx.fillStyle = snow ? "#eef3f6" : frost ? "#a9b79a" : "#8aa850";
  ctx.fillRect(0, fieldTop, W, 8);

  // ---- Soil section ----
  const soilH = H - groundY;
  const soilLayers = run.soil.layers;
  const totalMm = soilLayers.reduce((s, l) => s + l.thickness, 0);
  let y = groundY;
  let zTop = 0;
  const marks: { mid: number; text: string; rel: number }[] = [];
  soilLayers.forEach((l, k) => {
    const h = (l.thickness / totalMm) * soilH;
    const rel = fr.soilRel[k]!;
    ctx.fillStyle = mix("#cfae78", "#4a3225", rel);
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = `rgba(60,130,190,${0.28 * rel})`;
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = "rgba(20,20,20,0.18)";
    ctx.fillRect(0, y + h - 1, W, 1);
    marks.push({ mid: y + h / 2, text: `${Math.round(zTop / 10)}–${Math.round((zTop + l.thickness) / 10)} cm`, rel });
    zTop += l.thickness;
    y += h;
  });
  // one small label per layer in the left margin, spread apart so thin top layers stay readable; a fill bar shows available water
  ctx.font = "600 10.5px IBM Plex Sans, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const gap = 15;
  let ly = groundY + 10;
  const ys = marks.map((m) => {
    ly = Math.max(ly, m.mid);
    const out = ly;
    ly += gap;
    return out;
  });
  const over = ys[ys.length - 1]! - (H - 9);
  if (over > 0) for (let k = ys.length - 1, shift = over; k >= 0 && shift > 0; k--) {
    const room = k === 0 ? shift : Math.max(0, ys[k]! - (ys[k - 1]! + gap));
    const d = Math.min(shift, room);
    ys[k] = ys[k]! - d;
    shift -= d;
  }
  marks.forEach((m, k) => {
    const yy = ys[k]!;
    const tw = ctx.measureText(m.text).width;
    const w = tw + 58;
    ctx.fillStyle = "rgba(24,20,16,0.55)";
    ctx.beginPath();
    ctx.roundRect(6, yy - 7, w, 14, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(m.text, 12, yy);
    const bx = 12 + tw + 8;
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(bx, yy - 2.5, 28, 5);
    ctx.fillStyle = m.rel < 0.35 ? "#e3a64a" : "#7fc4f0";
    ctx.fillRect(bx, yy - 2.5, 28 * m.rel, 5);
  });

  // ---- Plants: back row, then front row ----
  const lay = art.layout;
  const size = H * 0.5 * (lay?.sizeScale ?? 1);
  const back = lay?.back ?? [0.1, 0.34, 0.66, 0.9];
  back.forEach((fx, k) => {
    const s = 0.62 * (0.94 + 0.1 * ((k * 37) % 7) / 7) * (lay ? 1.2 : 1);
    ctx.save();
    ctx.globalAlpha = 0.85;
    if (fr.emerged) art.draw(ctx, W * fx, groundY - 4, size * s, st, time, k * 1.7, calm);
    ctx.restore();
  });
  const front = lay?.front ?? [0.22, 0.5, 0.78];
  front.forEach((fx, k) => {
    if (fr.emerged) art.draw(ctx, W * fx, groundY + 2, size * (k === 1 ? 1 : 0.9), st, time, k * 2.3 + 0.5, calm);
  });

  // seed before emergence
  const cx = W * 0.5;
  if (!fr.emerged) {
    ctx.fillStyle = "#e0c46a";
    ctx.beginPath();
    ctx.ellipse(cx, groundY + soilH * 0.05, 5, 3, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Roots of the centre plant ----
  if (fr.emerged) {
    const depthPx = (fr.rootDepthMm / totalMm) * soilH;
    // colour follows the water in the layer the root is in: warm cream where it is dry, cool white where it can drink
    const layerAt = (px: number) => {
      let acc = 0;
      for (let k = 0; k < soilLayers.length; k++) {
        acc += (soilLayers[k]!.thickness / totalMm) * soilH;
        if (px <= acc) return fr.soilRel[k]!;
      }
      return fr.soilRel[soilLayers.length - 1]!;
    };
    const rootCol = (px: number, a: number) => `rgba(${rgbOf(mix("#f1d9a0", "#e6f6ff", layerAt(px)))},${a})`;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const stroke = (pts: [number, number][], w0: number, w1: number, depthOf: (i: number) => number) => {
      for (let i = 1; i < pts.length; i++) {
        const u = i / (pts.length - 1);
        const w = w0 + (w1 - w0) * u;
        ctx.strokeStyle = "rgba(25,15,8,0.45)"; // thin dark edge so the root reads against any soil colour
        ctx.lineWidth = w + 1.6;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
        ctx.lineTo(pts[i]![0], pts[i]![1]);
        ctx.stroke();
        ctx.strokeStyle = rootCol(depthOf(i), 0.95);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1]![0], pts[i - 1]![1]);
        ctx.lineTo(pts[i]![0], pts[i]![1]);
        ctx.stroke();
      }
    };
    const main: [number, number][] = [];
    for (let d = 0; d <= depthPx; d += 4) main.push([cx + Math.sin(d * 0.07) * 2, groundY + d]);
    if (main.length < 2) main.push([cx, groundY + 2]);
    stroke(main, 4, 1.2, (i) => i * 4);
    const spacing = 11;
    for (let k = 0, d = spacing; d < depthPx && k < ROOT_LATERALS.length; k++, d += spacing) {
      const r = ROOT_LATERALS[k]!;
      const maxLen = W * 0.16 * Math.exp((-2.2 * d) / Math.max(soilH, 1)) * r.len + 10;
      const len = Math.min(maxLen, (depthPx - d) * 1.4 + 8);
      const x0 = cx + Math.sin(d * 0.07) * 2;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        pts.push([x0 + r.side * len * u, groundY + d + (4 + r.wob) * 2 * u * (1 - 0.5 * u) + 8 * u * u]);
      }
      stroke(pts, 1.8, 0.5, () => d);
    }
    // depth marker: a small pill, kept inside the soil
    const label = `roots ${(fr.rootDepthMm / 10).toFixed(0)} cm`;
    ctx.font = "600 10.5px IBM Plex Sans, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const ty = Math.min(groundY + depthPx, H - 10);
    const tx = Math.min(cx + 12, W - tw - 16);
    ctx.fillStyle = "rgba(24,20,16,0.6)";
    ctx.beginPath();
    ctx.roundRect(tx, ty - 7, tw + 12, 14, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(label, tx + 6, ty);
  }

  // ---- Weather overlays ----
  if (fr.rain > 0.2 && snow) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    const flakes = Math.min(120, Math.round(fr.rain * 10 + 20));
    for (let k = 0; k < flakes; k++) {
      const x = (k * 97.3 + (calm ? 0 : time * 20 + Math.sin(time + k) * 6)) % W;
      const yy = (k * 53.7 + (calm ? 0 : time * 70)) % groundY;
      ctx.fillRect(x, yy, 2.2, 2.2);
    }
  } else if (fr.rain > 0.2) {
    const drops = Math.min(170, Math.round(fr.rain * 14 + 20));
    ctx.strokeStyle = "rgba(190,220,250,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < drops; k++) {
      const x = (k * 97.3 + (calm ? 0 : time * 60)) % W;
      const yy = (k * 53.7 + (calm ? 0 : time * 380)) % groundY;
      ctx.moveTo(x, yy);
      ctx.lineTo(x - 3, yy + 10);
    }
    ctx.stroke();
    // water entering the soil
    ctx.fillStyle = "rgba(120,180,230,0.5)";
    for (let k = 0; k < 14; k++) {
      const x = (k * 71.9 + 20) % W;
      const yy = groundY + ((time * 25 + k * 13) % (soilH * 0.35));
      if (!calm || k < 5) ctx.fillRect(x, yy, 1.5, 5);
    }
  }
  if (fr.tmax > 33) {
    const a = clamp((fr.tmax - 33) / 10, 0, 1) * 0.22;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    for (let k = 0; k < 7; k++) {
      const yy = groundY - 8 - k * 14;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const yv = yy + Math.sin(x * 0.06 + (calm ? 0 : time * 2.2) + k) * 2.2;
        if (x === 0) ctx.moveTo(x, yv);
        else ctx.lineTo(x, yv);
      }
      ctx.lineTo(W, yy + 3);
      ctx.lineTo(0, yy + 3);
      ctx.fill();
    }
  }
  if (frost) {
    ctx.fillStyle = "rgba(210,230,255,0.16)";
    ctx.fillRect(0, 0, W, groundY);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let k = 0; k < 40; k++) {
      const x = (k * 131.7) % W;
      const yy = groundY - ((k * 37.9) % (skyH * 0.45));
      ctx.fillRect(x, yy, 2, 2);
    }
  }

}

/** The status chip under the scene (critical window or killing frost), or null. It lives outside the canvas so it never covers the plants. */
export function sceneTag(run: Run, fr: Frame): { text: string; kind: "window" | "frost" } | null {
  if (run.result.frostKilled && fr.i >= run.result.days.length - 1) return { text: "Killing frost before maturity", kind: "frost" };
  if (fr.state.inWindow) return { text: `Critical window: ${run.cfg.grainWord} number is being set`, kind: "window" };
  return null;
}
