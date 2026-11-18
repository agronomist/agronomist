import { clamp, mix, type PlantArt, type PlantState } from "./draw-util";

/** A bushy soybean: a short main stem, nodes with three-leaflet leaves, and pod clusters that fill after flowering. */
export const soyArt: PlantArt = {
  layout: { back: [0.06, 0.2, 0.34, 0.5, 0.66, 0.8, 0.94], front: [0.13, 0.32, 0.5, 0.68, 0.87], sizeScale: 0.62 },
  draw(ctx, x, baseY, size, st: PlantState, time, phase, calm) {
    const dead = st.frostKilled;
    const h = size * st.hFrac;
    if (h < 2) return;
    const matureTan = clamp((st.dvs - 1.5) / 0.4, 0, 1);
    const sway = calm ? 0 : Math.sin(time * 1.2 + phase) * (1.5 + 3 * st.hFrac) * (size / 240);
    const green = mix(mix("#4f9a3a", "#a9b04a", clamp(1 - st.ws, 0, 1) * 1.2), "#b8cc7a", clamp(1 - st.nni, 0, 1) * 0.5);
    const stemCol = dead ? "#8c8160" : mix("#6aa34a", "#b9a560", matureTan);
    ctx.strokeStyle = stemCol;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, size * 0.014);
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + sway * 0.2, baseY - h * 0.55, x + sway, baseY - h);
    ctx.stroke();

    const nodes = Math.max(2, Math.round(2 + 6 * st.leafScale));
    const deadShare = clamp(st.deadLeaf / Math.max(1, st.leaf + st.deadLeaf), 0, 1);
    const leafR = Math.max(3, size * (0.035 + 0.05 * st.leafScale));
    for (let k = 0; k < nodes; k++) {
      const u = 0.18 + (0.8 * k) / nodes;
      const nx = x + sway * u;
      const ny = baseY - h * u;
      const side = k % 2 ? 1 : -1;
      const reach = leafR * (2.4 - 1.1 * u);
      const px = nx + side * reach;
      const py = ny - reach * 0.25 + (st.ws < 0.6 ? reach * 0.35 : 0);
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(px, py);
      ctx.lineWidth = Math.max(1, size * 0.006);
      ctx.stroke();
      const senescent = dead || k < deadShare * nodes || matureTan > 0.15 + 0.7 * (k / nodes);
      const col = senescent ? mix(green, dead ? "#8c8160" : "#d2b857", 0.85) : green;
      ctx.fillStyle = col;
      for (const [dx, dy, rot] of [[0, -0.5, 0], [-0.75, 0.1, -0.7], [0.75, 0.1, 0.7]] as const) {
        ctx.beginPath();
        ctx.ellipse(px + dx * leafR * 0.9, py + dy * leafR * 0.9, leafR * 0.55, leafR * 0.85, rot + side * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (st.dvs > 0.95 && st.dvs < 1.35) {
      ctx.fillStyle = dead ? "#a89c78" : "#d9c2ee";
      for (let k = 0; k < 5; k++) {
        const u = 0.45 + 0.1 * k;
        ctx.beginPath();
        ctx.arc(x + sway * u + (k % 2 ? 5 : -5) * (size / 240), baseY - h * u, Math.max(1.5, size * 0.012), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (st.dvs > 1.15) {
      const pod = mix("#7fae4c", "#c9ab6c", clamp(st.earFrac * 1.6 + matureTan, 0, 1));
      ctx.fillStyle = dead ? "#a39668" : pod;
      const n = 4 + Math.round(6 * st.earFrac);
      for (let k = 0; k < n; k++) {
        const u = 0.3 + 0.06 * k;
        const side = k % 2 ? 1 : -1;
        const px = x + sway * u + side * size * 0.03;
        const py = baseY - h * u;
        ctx.beginPath();
        ctx.ellipse(px, py, Math.max(1.5, size * 0.011), Math.max(3, size * (0.02 + 0.03 * st.earFrac)), side * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
