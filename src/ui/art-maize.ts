import { clamp, lerp, mix, type PlantArt, type PlantState } from "./draw-util";

export type Pt = { x: number; y: number };
export const quad = (p0: Pt, p1: Pt, p2: Pt, s: number): Pt => ({
  x: (1 - s) * (1 - s) * p0.x + 2 * (1 - s) * s * p1.x + s * s * p2.x,
  y: (1 - s) * (1 - s) * p0.y + 2 * (1 - s) * s * p1.y + s * s * p2.y,
});

export function blade(ctx: CanvasRenderingContext2D, p0: Pt, p1: Pt, p2: Pt, width: number, fill: string, rib: string) {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const steps = 10;
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    const b = quad(p0, p1, p2, s);
    const tx = 2 * (1 - s) * (p1.x - p0.x) + 2 * s * (p2.x - p1.x);
    const ty = 2 * (1 - s) * (p1.y - p0.y) + 2 * s * (p2.y - p1.y);
    const m = Math.hypot(tx, ty) || 1;
    const nx = -ty / m;
    const ny = tx / m;
    const w = width * Math.sin(Math.PI * Math.pow(s, 0.75)) * (1 - 0.25 * s);
    left.push({ x: b.x + nx * w, y: b.y + ny * w });
    right.push({ x: b.x - nx * w, y: b.y - ny * w });
  }
  ctx.beginPath();
  ctx.moveTo(left[0]!.x, left[0]!.y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k]!.x, right[k]!.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.strokeStyle = rib;
  ctx.lineWidth = Math.max(0.6, width * 0.18);
  ctx.stroke();
}

export const maizeArt: PlantArt = {
  draw(ctx, x, baseY, size, st: PlantState, time, phase, calm) {
    const h = size * st.hFrac;
    const sway = calm ? 0 : Math.sin(time * 1.1 + phase) * (2 + 5 * st.hFrac) * (size / 240);
    const base: Pt = { x, y: baseY };
    const top: Pt = { x: x + sway, y: baseY - h };
    const ctrl: Pt = { x: x + sway * 0.25, y: baseY - h * 0.55 };
    const stemAt = (u: number) => quad(base, ctrl, top, u);

    const dead = st.frostKilled;
    const matureTan = clamp((st.dvs - 1.5) / 0.45, 0, 1);
    const stemCol = dead ? "#8c8160" : mix("#5f9440", "#b5a263", matureTan);

    // stem
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, top.x, top.y);
    ctx.strokeStyle = stemCol;
    ctx.lineWidth = Math.max(1.5, size * 0.016 * (0.5 + st.hFrac));
    ctx.lineCap = "round";
    ctx.stroke();

    // leaves, lower (older) to upper
    const n = Math.max(2, Math.round(3 + 11 * st.hFrac));
    const deadFrac = st.deadLeaf / (st.leaf + st.deadLeaf + 1e-9);
    const droop = clamp(1 - st.ws, 0, 1) * 1.1 + (dead ? 0.8 : 0);
    const lenMax = size * 0.36 * st.leafScale;
    for (let i = 0; i < n; i++) {
      const u = 0.07 + 0.86 * (n === 1 ? 0 : i / (n - 1));
      const node = stemAt(u);
      const side = i % 2 === 0 ? 1 : -1;
      const shape = 0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.76 * (i / n)));
      const len = Math.max(size * 0.05, lenMax * shape);
      const lift = 0.55 * (1 - droop * 0.75);
      const p1: Pt = { x: node.x + side * len * 0.55, y: node.y - len * lift };
      const sw = calm ? 0 : Math.sin(time * 1.6 + phase + i) * len * 0.035;
      const p2: Pt = { x: node.x + side * len * 0.98 + sw, y: node.y + len * (0.1 + droop * 0.38) - len * 0.12 };
      // colour: N stress pales the canopy; older leaves senesce first; frost kills
      const green = mix("#cdc455", "#3d8a37", st.nni);
      const sen = clamp((deadFrac * 2.0 - i / n) / 0.3, 0, 1);
      let col = mix(green, "#a3843f", sen);
      if (dead) col = mix(col, "#8a8263", 0.85);
      blade(ctx, node, p1, p2, Math.max(1.2, len * 0.085), col, mix(col, "#ffffff", 0.25));
    }

    // ear
    if (st.dvs >= 0.72) {
      const growth = clamp((st.dvs - 0.72) / 0.3, 0, 1);
      const node = stemAt(0.56);
      const eLen = size * (0.05 + 0.2 * Math.max(growth * 0.45, st.earFrac));
      const eW = eLen * 0.3;
      const husk = dead ? "#8a8263" : mix("#6aa24a", "#cdb985", matureTan);
      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.rotate(-0.35 + (calm ? 0 : Math.sin(time + phase) * 0.03));
      ctx.beginPath();
      ctx.ellipse(eW * 0.6, -eLen * 0.5, eW, eLen * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = husk;
      ctx.fill();
      if (st.dvs >= 1.25) {
        ctx.beginPath();
        ctx.ellipse(eW * 0.6, -eLen * 0.93, eW * 0.55, eLen * 0.12 * clamp(st.earFrac * 1.5, 0.2, 1), 0, 0, Math.PI * 2);
        ctx.fillStyle = mix("#e3b835", "#c98d12", st.earFrac);
        ctx.fill();
      }
      if (st.dvs >= 0.98 && st.dvs <= 1.3) {
        ctx.strokeStyle = "#c7706d";
        ctx.lineWidth = Math.max(0.8, size * 0.004);
        for (let k = -2; k <= 2; k++) {
          ctx.beginPath();
          ctx.moveTo(eW * 0.6, -eLen * 0.98);
          ctx.quadraticCurveTo(eW * 0.6 + k * 2, -eLen * 1.08, eW * 0.6 + k * 4, -eLen * 1.16 - (calm ? 0 : Math.sin(time * 2 + k) * 1.2));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // tassel
    if (st.dvs >= 0.88) {
      const tg = clamp((st.dvs - 0.88) / 0.14, 0, 1);
      const spikes = 7;
      ctx.strokeStyle = dead ? "#8a8263" : mix("#d9c868", "#b99a52", matureTan);
      ctx.lineWidth = Math.max(0.8, size * 0.004);
      for (let k = 0; k < spikes; k++) {
        const a = -Math.PI / 2 + ((k - (spikes - 1) / 2) / spikes) * 1.5;
        const l = size * 0.085 * tg * (0.75 + 0.25 * Math.cos((k - 3) * 0.5));
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.quadraticCurveTo(top.x + Math.cos(a) * l * 0.6, top.y + Math.sin(a) * l * 0.6, top.x + Math.cos(a) * l + (calm ? 0 : Math.sin(time + k) * 1.5), top.y + Math.sin(a) * l * 0.95 + l * 0.25);
        ctx.stroke();
      }
    }

    // critical window: a pulsing gold halo and drifting pollen around the upper plant
    if (st.inWindow && !dead) {
      const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3);
      const g = ctx.createRadialGradient(top.x, top.y + h * 0.18, 2, top.x, top.y + h * 0.18, size * 0.32);
      g.addColorStop(0, `rgba(255,214,90,${0.38 + 0.2 * pulse})`);
      g.addColorStop(1, "rgba(255,214,90,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(top.x, top.y + h * 0.18, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(244,214,80,0.9)";
      for (let k = 0; k < 10; k++) {
        const f = (time * 0.35 + k * 0.173 + phase) % 1;
        const px = top.x + Math.sin(k * 7.3 + time) * size * 0.07 * (0.4 + f);
        const py = top.y + size * 0.02 + f * h * 0.45;
        ctx.globalAlpha = (1 - f) * 0.9;
        ctx.fillRect(px, py, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
    void lerp;
  },
};
