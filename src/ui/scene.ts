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
  ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
  ctx.textBaseline = "middle";
  let zTop = 0;
  soilLayers.forEach((l, k) => {
    const h = (l.thickness / totalMm) * soilH;
    const rel = fr.soilRel[k]!;
    ctx.fillStyle = mix("#cfae78", "#4a3225", rel);
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = `rgba(60,130,190,${0.28 * rel})`;
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = "rgba(20,20,20,0.18)";
    ctx.fillRect(0, y + h - 1, W, 1);
    ctx.fillStyle = rel > 0.45 ? "rgba(255,255,255,0.88)" : "rgba(40,30,20,0.88)";
    ctx.fillText(`${Math.round(zTop / 10)}–${Math.round((zTop + l.thickness) / 10)} cm  ${Math.round(rel * 100)}% available`, 10, y + h / 2);
    zTop += l.thickness;
    y += h;
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
    ctx.strokeStyle = "rgba(240,228,196,0.92)";
    ctx.lineCap = "round";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx, groundY);
    for (let d = 0; d <= depthPx; d += 6) ctx.lineTo(cx + Math.sin(d * 0.08) * 2.5, groundY + d);
    ctx.stroke();
    ctx.lineWidth = 1;
    const spacing = 11;
    for (let k = 0, d = spacing; d < depthPx && k < ROOT_LATERALS.length; k++, d += spacing) {
      const r = ROOT_LATERALS[k]!;
      const maxLen = W * 0.16 * Math.exp((-2.2 * d) / Math.max(soilH, 1)) * r.len + 10;
      const len = Math.min(maxLen, (depthPx - d) * 1.4 + 8);
      ctx.beginPath();
      ctx.moveTo(cx, groundY + d);
      ctx.quadraticCurveTo(cx + r.side * len * 0.55, groundY + d + 4 + r.wob, cx + r.side * len, groundY + d + 12 + r.wob);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(`roots ${(fr.rootDepthMm / 10).toFixed(0)} cm`, cx + 14, groundY + Math.min(depthPx, soilH - 8));
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

  drawBanners(ctx, W, run, fr, time, calm, sunX);
}

/** The two overlay banners; shared by the side view and the 3D view. */
export function drawBanners(ctx: CanvasRenderingContext2D, W: number, run: Run, fr: Frame, time: number, calm: boolean, sunX: number) {
  const st = fr.state;
  if (st.inWindow) {
    const label = `CRITICAL WINDOW: ${run.cfg.grainWord} number is being set`;
    ctx.font = "600 12px IBM Plex Sans, system-ui, sans-serif";
    const w = ctx.measureText(label).width + 24;
    const pulse = calm ? 1 : 0.8 + 0.2 * Math.sin(time * 3);
    const bx = sunX < W * 0.5 ? W - w - 14 : 14; // keep the banner clear of the sun
    ctx.fillStyle = `rgba(214,160,20,${0.92 * pulse})`;
    ctx.beginPath();
    ctx.roundRect(bx, 12, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#1d1a0c";
    ctx.textAlign = "center";
    ctx.fillText(label, bx + w / 2, 26);
    ctx.textAlign = "left";
  }
  if (run.result.frostKilled && fr.i >= run.result.days.length - 1) {
    ctx.font = "600 12px IBM Plex Sans, system-ui, sans-serif";
    const label = "KILLING FROST BEFORE MATURITY";
    const w = ctx.measureText(label).width + 24;
    ctx.fillStyle = "rgba(60,90,140,0.92)";
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, 12, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(label, W / 2, 26);
    ctx.textAlign = "left";
  }
}
