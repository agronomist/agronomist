import { clamp, mix, type PlantArt, type PlantState } from "./draw-util";
import { blade, quad, type Pt } from "./art-maize";

/** A clump of tillers: narrow arching leaves, a flag leaf, and a spike with awns that turns from green to gold. */
export const wheatArt: PlantArt = {
  layout: { back: [0.05, 0.16, 0.27, 0.38, 0.5, 0.62, 0.73, 0.84, 0.95], front: [0.1, 0.27, 0.5, 0.73, 0.9], sizeScale: 0.85 },
  draw(ctx, x, baseY, size, st: PlantState, time, phase, calm) {
    const dead = st.frostKilled;
    const matureTan = clamp((st.dvs - 1.45) / 0.5, 0, 1);
    const green = mix("#d3cc62", "#4a9a3c", st.nni);
    const deadFrac = st.deadLeaf / (st.leaf + st.deadLeaf + 1e-9);
    const droop = clamp(1 - st.ws, 0, 1) * 1.0 + (dead ? 0.8 : 0);
    const nT = Math.max(2, Math.round(2 + 6 * st.leafScale));
    const h = size * st.hFrac;
    const vegLen = size * (0.05 + 0.17 * st.leafScale);
    const stemCol = dead ? "#8c8160" : mix("#6aa34a", "#cdb467", matureTan);
    let canopyTop = baseY;

    for (let k = 0; k < nT; k++) {
      const off = (k - (nT - 1) / 2) * size * 0.03;
      const hk = h * (0.84 + 0.16 * (((k * 37) % 5) / 5));
      const sway = calm ? 0 : Math.sin(time * 1.3 + phase + k * 0.7) * (1.5 + 4 * st.hFrac) * (size / 240);
      const base: Pt = { x: x + off, y: baseY };
      const top: Pt = { x: x + off * 1.5 + sway, y: baseY - hk };
      const ctrl: Pt = { x: x + off * 1.25 + sway * 0.2, y: baseY - hk * 0.55 };
      const culmAt = (u: number) => quad(base, ctrl, top, u);
      canopyTop = Math.min(canopyTop, top.y);

      const tall = hk > size * 0.07;
      if (tall) {
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, top.x, top.y);
        ctx.strokeStyle = stemCol;
        ctx.lineWidth = Math.max(1, size * 0.008);
        ctx.lineCap = "round";
        ctx.stroke();
      }

      // leaves along the culm (basal leaves long, upper ones shorter and more upright)
      const us = tall ? [0.03, 0.12, 0.26] : [0.02, 0.02, 0.02];
      us.forEach((u, j) => {
        const node = tall ? culmAt(u) : base;
        const side = (k + j) % 2 === 0 ? 1 : -1;
        const len = Math.max(size * 0.04, vegLen * (1 - 0.14 * j) * (tall ? 1 : 0.9 + 0.1 * j));
        const sw = calm ? 0 : Math.sin(time * 1.7 + phase + k + j) * len * 0.04;
        const p1: Pt = { x: node.x + side * len * (0.12 + droop * 0.2), y: node.y - len * 0.75 };
        const p2: Pt = { x: node.x + side * len * (0.4 + droop * 0.35) + sw, y: node.y - len * (0.95 - droop * 0.75) };
        const sen = clamp((deadFrac * 2.2 - j / 3) / 0.3, 0, 1);
        let col = mix(mix(green, "#a3843f", sen), "#c6ab58", matureTan * 0.85);
        if (dead) col = mix(col, "#8a8263", 0.85);
        blade(ctx, node, p1, p2, Math.max(0.8, len * 0.03), col, mix(col, "#ffffff", 0.22));
      });

      // flag leaf
      if (st.dvs >= 0.5 && tall) {
        const node = culmAt(0.7);
        const side = k % 2 === 0 ? -1 : 1;
        const len = size * 0.1 * (0.6 + 0.4 * st.leafScale);
        const p1: Pt = { x: node.x + side * len * 0.2, y: node.y - len * 0.55 };
        const p2: Pt = { x: node.x + side * len * 0.6, y: node.y - len * (0.75 - droop * 0.6) };
        let col = mix(mix(green, "#a3843f", clamp(deadFrac * 1.4, 0, 1)), "#c6ab58", matureTan * 0.9);
        if (dead) col = mix(col, "#8a8263", 0.85);
        blade(ctx, node, p1, p2, Math.max(0.8, len * 0.04), col, mix(col, "#ffffff", 0.22));
      }

      // spike: spikelets alternate along a rachis; awns appear as it ripens
      if (st.dvs >= 0.8 && tall) {
        const g = clamp((st.dvs - 0.8) / 0.25, 0, 1);
        const sLen = size * (0.08 + 0.15 * Math.max(g * 0.5, st.earFrac));
        const n = 9;
        const col = dead ? "#a39a78" : mix("#7fb04e", "#d8b24a", clamp(matureTan * 1.1 + st.earFrac * 0.2, 0, 1));
        const awn = dead ? "#a39a78" : mix("#9ec06a", "#cdb26a", matureTan);
        ctx.lineCap = "round";
        for (let s = 0; s < n; s++) {
          const sy = top.y - ((s + 0.5) / n) * sLen;
          const side = s % 2 === 0 ? 1 : -1;
          const sx = top.x + side * size * 0.006;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(side * 0.35);
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(1.8, size * 0.012), Math.max(2.4, (sLen / n) * 0.85), 0, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.restore();
          if (st.dvs >= 0.9) {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + side * size * 0.03 + (calm ? 0 : Math.sin(time * 1.5 + s + k) * 0.6), sy - sLen * 0.7);
            ctx.strokeStyle = awn;
            ctx.lineWidth = Math.max(0.6, size * 0.003);
            ctx.stroke();
          }
          if (st.inWindow && !dead && st.dvs >= 0.97 && s % 2 === 0) {
            ctx.fillStyle = "rgba(244,214,80,0.95)";
            ctx.fillRect(sx + side * size * 0.01, sy + 1, 1.5, 2.5);
          }
        }
      }
    }

    // critical window: pulsing gold halo and drifting pollen over the heads
    if (st.inWindow && !dead) {
      const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3);
      const cy = canopyTop + h * 0.08;
      const g = ctx.createRadialGradient(x, cy, 2, x, cy, size * 0.3);
      g.addColorStop(0, `rgba(255,214,90,${0.34 + 0.2 * pulse})`);
      g.addColorStop(1, "rgba(255,214,90,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, cy, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(244,214,80,0.9)";
      for (let q = 0; q < 8; q++) {
        const f = (time * 0.35 + q * 0.19 + phase) % 1;
        const px = x + Math.sin(q * 6.1 + time) * size * 0.08 * (0.4 + f);
        const py = canopyTop + f * h * 0.4;
        ctx.globalAlpha = (1 - f) * 0.9;
        ctx.fillRect(px, py, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }
  },
};
