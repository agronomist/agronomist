import Zdog from "zdog";
import { clamp, mix, seeded } from "./draw-util";
import { type Frame } from "./scene";
import { type Run } from "./model-run";

/**
 * A pseudo-3D field built with Zdog: flat-shaded shapes with round strokes, drag to turn.
 * The scene is rebuilt every frame from the model state, so there is nothing to keep in sync.
 */
const TAU = Math.PI * 2;
const BLOCK = { w: 360, d: 220, h: 170 };
const COLS = [-135, -45, 45, 135];
const ROWS = [-72, 0, 72];
const R = seeded(23);
const DROPS = Array.from({ length: 70 }, () => ({ x: (R() - 0.5) * 440, z: (R() - 0.5) * 300, o: R() * 300 }));
const CLOUDS = Array.from({ length: 4 }, () => ({ x: (R() - 0.5) * 420, y: -250 - R() * 60, z: -170 - R() * 80, s: 0.8 + R() * 0.8, v: 4 + R() * 6 }));

export interface Scene3D {
  illo: any;
  render(run: Run, fr: Frame, time: number, calm: boolean): void;
  setSize(w: number, h: number): void;
}

const bez = (p0: number, p1: number, p2: number, p3: number, u: number) => {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
};

export function createScene3D(canvas: HTMLCanvasElement, onDrag: () => void): Scene3D {
  const illo = new Zdog.Illustration({
    element: canvas,
    dragRotate: true,
    onDragMove: onDrag,
    rotate: { x: -TAU / 12, y: -TAU / 15 },
    zoom: 1,
  });
  // Zdog pins the canvas CSS size on hi-DPI screens; the page lays the canvas out itself
  const unpin = () => {
    canvas.style.width = "";
    canvas.style.height = "";
  };
  unpin();
  let world = new Zdog.Anchor({ addTo: illo });

  function leaf(addTo: any, len: number, wid: number, droop: number, color: string, rotY: number, at: { x: number; y: number }) {
    const a = new Zdog.Anchor({ addTo, translate: at, rotate: { y: rotY } });
    new Zdog.Shape({
      addTo: a,
      closed: true,
      fill: true,
      stroke: 1.5,
      color,
      path: [
        { x: 0, y: 0 },
        { bezier: [{ x: len * 0.35, y: -len * 0.3 * wid }, { x: len * 0.75, y: -len * (0.25 - droop * 0.4) * wid }, { x: len, y: len * droop * 0.55 }] },
        { bezier: [{ x: len * 0.7, y: len * 0.02 }, { x: len * 0.35, y: len * 0.04 }, { x: 0, y: 0 }] },
      ],
    });
  }

  function maize(a: any, fr: Frame, time: number, phase: number, calm: boolean, dead: boolean) {
    const st = fr.state;
    const h = 165 * st.hFrac;
    if (h < 3) return;
    const sway = calm ? 0 : Math.sin(time * 1.1 + phase) * (2 + 8 * st.hFrac);
    const matureTan = clamp((st.dvs - 1.5) / 0.45, 0, 1);
    const stemCol = dead ? "#8c8160" : mix("#5f9440", "#b5a263", matureTan);
    const sx = (u: number) => bez(0, sway * 0.1, sway * 0.5, sway, u);
    const sy = (u: number) => -h * u;
    new Zdog.Shape({ addTo: a, stroke: 3 + 4 * st.hFrac, color: stemCol, path: [{ x: 0, y: 0 }, { bezier: [{ x: sway * 0.1, y: -h * 0.33 }, { x: sway * 0.5, y: -h * 0.66 }, { x: sway, y: -h }] }] });
    const n = Math.round(3 + 8 * st.leafScale);
    const deadShare = clamp(st.deadLeaf / Math.max(1, st.leaf + st.deadLeaf), 0, 1);
    const greenBase = mix("#4f9a3a", "#a9b04a", clamp(1 - st.ws, 0, 1) * 1.2);
    const green = mix(greenBase, "#b8cc7a", clamp(1 - st.nni, 0, 1) * 0.9);
    for (let k = 0; k < n; k++) {
      const u = 0.1 + (0.82 * k) / n;
      const senescent = dead || k < deadShare * n || matureTan > 0.2 + 0.7 * (k / n);
      const col = senescent ? mix(green, dead ? "#8c8160" : "#c3b273", 0.85) : green;
      const len = (26 + 52 * st.hFrac) * st.leafScale * (1 - 0.42 * u) + 6;
      leaf(a, len, 1, 0.5 + 0.9 * (1 - u) * (1 - st.ws * 0.3) + (senescent ? 0.5 : 0), col, k * 2.4 + (calm ? 0 : Math.sin(time * 0.9 + k + phase) * 0.12), { x: sx(u), y: sy(u) });
    }
    if (st.dvs > 0.75 && st.dvs < 1.9) {
      const col = dead ? "#8c8160" : "#d9c58a";
      for (let k = 0; k < 5; k++) new Zdog.Shape({ addTo: a, stroke: 1.4, color: col, path: [{ x: sway, y: -h }, { x: sway + Math.cos(k * 1.26) * 16, y: -h - 10 + Math.abs(Math.sin(k)) * 4, z: Math.sin(k * 1.26) * 16 }] });
    }
    if (st.dvs > 0.95) {
      const e = st.earFrac;
      const col = mix("#79a64a", "#e3b53b", clamp(e * 2.2, 0, 1));
      new Zdog.Cylinder({ addTo: a, diameter: 8 + 12 * e, length: 18 + 38 * e, stroke: 1.5, color: dead ? "#9c8f66" : col, backface: mix(col, "#7a5a1c", 0.35), translate: { x: sx(0.5) + 9, y: sy(0.5) }, rotate: { x: TAU / 4, z: -0.5 } });
    }
  }

  function wheat(a: any, fr: Frame, time: number, phase: number, calm: boolean, dead: boolean) {
    const st = fr.state;
    const h = 110 * st.hFrac;
    if (h < 2) return;
    const matureTan = clamp((st.dvs - 1.4) / 0.5, 0, 1);
    const stemCol = dead ? "#8c8160" : mix("#74a845", "#cdb868", matureTan);
    const greenBase = mix("#5ea23f", "#b0b552", clamp(1 - st.ws, 0, 1) * 1.2);
    const green = mix(greenBase, "#bfd283", clamp(1 - st.nni, 0, 1) * 0.9);
    const till = [{ x: -7, z: 3 }, { x: 0, z: 0 }, { x: 7, z: -3 }, { x: 3, z: 8 }];
    till.forEach((t, k) => {
      const hh = h * (0.88 + 0.12 * ((k * 5) % 3) / 2);
      const sway = calm ? 0 : Math.sin(time * 1.3 + phase + k) * (1.5 + 5 * st.hFrac);
      const tb = new Zdog.Anchor({ addTo: a, translate: { x: t.x, z: t.z } });
      new Zdog.Shape({ addTo: tb, stroke: 2.2, color: stemCol, path: [{ x: 0, y: 0 }, { bezier: [{ x: 0, y: -hh * 0.4 }, { x: sway * 0.6, y: -hh * 0.75 }, { x: sway, y: -hh }] }] });
      const nl = Math.round(2 + 3 * st.leafScale);
      for (let j = 0; j < nl; j++) {
        const u = 0.08 + (0.5 * j) / nl;
        const sen = dead || matureTan > 0.15 + 0.6 * (j / nl);
        const col = sen ? mix(green, dead ? "#8c8160" : "#cdb868", 0.85) : green;
        leaf(tb, (22 + 38 * st.hFrac) * st.leafScale * (1 - 0.3 * u) + 6, 0.5, 0.45 + 0.4 * (1 - u), col, k * 1.7 + j * 2.5, { x: bez(0, 0, sway * 0.6, sway, u), y: -hh * u });
      }
      if (st.dvs > 0.9) {
        const len = 6 + 24 * clamp(0.25 + st.earFrac * 0.75, 0, 1);
        const col = dead ? "#a39668" : mix("#7fae4c", "#e0be5a", clamp(st.earFrac * 2.2, 0, 1));
        new Zdog.Shape({ addTo: tb, stroke: 6, color: col, path: [{ x: sway, y: -hh }, { x: sway, y: -hh - len }] });
        const awn = dead ? "#a39668" : mix("#a5c46c", "#e9d58c", clamp(st.earFrac * 2, 0, 1));
        for (let j = 0; j < 4; j++) new Zdog.Shape({ addTo: tb, stroke: 0.9, color: awn, path: [{ x: sway, y: -hh - len * 0.6 }, { x: sway + Math.cos(j * 1.57) * 5, y: -hh - len - 14, z: Math.sin(j * 1.57) * 5 }] });
      }
    });
  }

  function soy(a: any, fr: Frame, time: number, phase: number, calm: boolean, dead: boolean) {
    const st = fr.state;
    const h = 95 * st.hFrac;
    if (h < 2) return;
    const sway = calm ? 0 : Math.sin(time * 1.2 + phase) * (1 + 3 * st.hFrac);
    const matureTan = clamp((st.dvs - 1.5) / 0.4, 0, 1);
    const stemCol = dead ? "#8c8160" : mix("#6aa34a", "#b9a560", matureTan);
    const greenBase = mix("#4f9a3a", "#a9b04a", clamp(1 - st.ws, 0, 1) * 1.2);
    const green = mix(greenBase, "#b8cc7a", clamp(1 - st.nni, 0, 1) * 0.5);
    new Zdog.Shape({ addTo: a, stroke: 3.5, color: stemCol, path: [{ x: 0, y: 0 }, { bezier: [{ x: 0, y: -h * 0.35 }, { x: sway * 0.5, y: -h * 0.7 }, { x: sway, y: -h }] }] });
    const nodes = Math.round(2 + 6 * st.leafScale);
    const deadShare = clamp(st.deadLeaf / Math.max(1, st.leaf + st.deadLeaf), 0, 1);
    const r = 7 + 9 * st.leafScale;
    for (let k = 0; k < nodes; k++) {
      const u = 0.15 + (0.8 * k) / nodes;
      const nx = sway * u;
      const ny = -h * u;
      const ang = k * 2.4;
      const reach = r * (2.2 - 0.9 * u);
      const senescent = dead || k < deadShare * nodes || matureTan > 0.15 + 0.7 * (k / nodes);
      const col = senescent ? mix(green, dead ? "#8c8160" : "#d2b857", 0.85) : green;
      const petiole = new Zdog.Anchor({ addTo: a, translate: { x: nx, y: ny }, rotate: { y: ang } });
      new Zdog.Shape({ addTo: petiole, stroke: 1.5, color: stemCol, path: [{ x: 0, y: 0 }, { x: reach, y: -reach * 0.25 + (st.ws < 0.6 ? reach * 0.3 : 0) }] });
      const tip = { x: reach, y: -reach * 0.25 + (st.ws < 0.6 ? reach * 0.3 : 0) };
      for (const [dx, dz] of [[0.2, 0], [-0.1, 0.7], [-0.1, -0.7]] as const) new Zdog.Ellipse({ addTo: petiole, diameter: r * 1.1, quarters: 4, stroke: 1, fill: true, color: col, translate: { x: tip.x + dx * r, y: tip.y, z: dz * r }, rotate: { x: TAU / 4 } });
    }
    if (st.dvs > 0.95 && st.dvs < 1.35) for (let k = 0; k < 4; k++) new Zdog.Shape({ addTo: a, stroke: 3.5, color: dead ? "#a89c78" : "#d9c2ee", translate: { x: sway * 0.6 + (k % 2 ? 6 : -6), y: -h * (0.5 + 0.1 * k), z: k % 2 ? 3 : -3 } });
    if (st.dvs > 1.15) {
      const pod = dead ? "#a39668" : mix("#7fae4c", "#c9ab6c", clamp(st.earFrac * 1.6 + matureTan, 0, 1));
      const n = 4 + Math.round(6 * st.earFrac);
      for (let k = 0; k < n; k++) {
        const u = 0.3 + 0.06 * k;
        const x = sway * u + (k % 2 ? 7 : -7);
        const y = -h * u;
        new Zdog.Shape({ addTo: a, stroke: 3 + 2 * st.earFrac, color: pod, path: [{ x, y, z: (k % 3) * 3 - 3 }, { x: x + (k % 2 ? 2 : -2), y: y + 6 + 8 * st.earFrac, z: (k % 3) * 3 - 3 }] });
      }
    }
  }

  function render(run: Run, fr: Frame, time: number, calm: boolean) {
    illo.removeChild(world);
    world = new Zdog.Anchor({ addTo: illo, translate: { y: 0 } });
    const st = fr.state;
    const frost = fr.tmin <= 0;
    const snow = fr.tmax <= 1;
    const clarity = clamp((fr.srad - 6) / 18, 0, 1);
    const hot = clamp((fr.tmax - 33) / 8, 0, 1);
    let top = mix("#8d9fb0", "#3f86d3", clarity);
    let bot = mix("#cbd5dc", "#bde2f5", clarity);
    bot = mix(bot, "#f3c685", hot * 0.8);
    top = mix(top, "#6f9bc4", hot * 0.4);
    if (frost) {
      top = mix(top, "#b9c8d9", 0.5);
      bot = mix(bot, "#e8f0f7", 0.6);
    }
    canvas.style.background = `linear-gradient(${top}, ${bot} 75%)`;

    // soil block: one box per layer, darker where the layer holds more water
    const layers = run.soil.layers;
    const total = layers.reduce((s, l) => s + l.thickness, 0);
    let y = 0;
    layers.forEach((l, k) => {
      const h = (l.thickness / total) * BLOCK.h;
      const rel = fr.soilRel[k]!;
      const c = mix("#cfae78", "#4a3225", rel);
      const side = mix(c, "#000000", 0.12);
      const field = snow ? "#eef3f6" : frost ? "#a9b79a" : "#8aa850";
      new Zdog.Box({
        addTo: world,
        width: BLOCK.w,
        depth: BLOCK.d,
        height: h,
        translate: { y: y + h / 2 },
        stroke: 1,
        color: c,
        frontFace: c,
        leftFace: side,
        rightFace: side,
        rearFace: side,
        topFace: k === 0 ? field : false,
        bottomFace: k === layers.length - 1 ? side : false,
      });
      y += h;
    });
    // furrows
    for (const z of ROWS) new Zdog.Shape({ addTo: world, stroke: 3, color: snow ? "#dfe7ec" : "#6f8a40", path: [{ x: -BLOCK.w / 2 + 12, y: -0.5, z }, { x: BLOCK.w / 2 - 12, y: -0.5, z }] });

    // sun, clouds, weather
    const sunX = -230 + 460 * fr.progress;
    const elev = 0.5 + 0.5 * Math.cos((TAU * (fr.doy - 172)) / 365);
    const sunY = -150 - 130 * elev;
    new Zdog.Shape({ addTo: world, stroke: 110, color: `rgba(255,236,160,${0.12 + 0.18 * clarity})`, translate: { x: sunX, y: sunY, z: -220 } });
    new Zdog.Shape({ addTo: world, stroke: 40 + 22 * clarity, color: `rgba(255,243,190,${0.55 + 0.45 * clarity})`, translate: { x: sunX, y: sunY, z: -220 } });
    const cover = 1 - clarity;
    for (const c of CLOUDS) {
      const x = ((c.x + (calm ? 0 : time * c.v) + 300) % 640) - 300;
      for (let k = 0; k < 3; k++) new Zdog.Shape({ addTo: world, stroke: (34 + 16 * (k === 1 ? 1 : 0)) * c.s, color: `rgba(255,255,255,${0.35 + 0.55 * cover})`, translate: { x: x + (k - 1) * 30 * c.s, y: c.y + (k === 1 ? -10 : 0), z: c.z } });
    }

    // plants
    if (fr.emerged) {
      const dead = st.frostKilled;
      ROWS.forEach((z, ri) =>
        COLS.forEach((x, ci) => {
          const a = new Zdog.Anchor({ addTo: world, translate: { x, z }, rotate: { y: (ri * 4 + ci) * 0.7 } });
          const phase = ri * 1.7 + ci * 2.3;
          if (run.cfg.key === "wheat") wheat(a, fr, time, phase, calm, dead);
          else if (run.cfg.key === "soy") soy(a, fr, time, phase, calm, dead);
          else maize(a, fr, time, phase, calm, dead);
        }),
      );
      // roots on the front face, under one plant
      const depth = (fr.rootDepthMm / total) * BLOCK.h;
      const rx = 45;
      const rz = BLOCK.d / 2 + 1;
      new Zdog.Shape({ addTo: world, stroke: 4.5, color: "rgba(244,234,205,0.95)", path: [{ x: rx, y: 0, z: rz }, { x: rx + 2, y: depth * 0.5, z: rz }, { x: rx, y: depth, z: rz }] });
      for (let k = 0, d = 14; d < depth; k++, d += 13) {
        const side = k % 2 ? -1 : 1;
        const len = Math.min(80 * Math.exp((-1.6 * d) / BLOCK.h) + 12, (depth - d) * 1.3 + 8);
        new Zdog.Shape({ addTo: world, stroke: 2.4, color: "rgba(244,234,205,0.9)", path: [{ x: rx, y: d, z: rz }, { bezier: [{ x: rx + side * len * 0.5, y: d + 3, z: rz }, { x: rx + side * len * 0.8, y: d + 8, z: rz }, { x: rx + side * len, y: d + 13, z: rz }] }] });
      }
    } else {
      new Zdog.Shape({ addTo: world, stroke: 7, color: "#e0c46a", translate: { x: 45, y: 6, z: 0 } });
    }

    // rain and snow
    if (fr.rain > 0.2) {
      const n = Math.min(DROPS.length, Math.round(fr.rain * 6 + 12));
      for (let k = 0; k < n; k++) {
        const d = DROPS[k]!;
        const yy = -300 + ((calm ? d.o : time * (snow ? 60 : 340) + d.o) % 300);
        if (snow) new Zdog.Shape({ addTo: world, stroke: 3, color: "rgba(255,255,255,0.95)", translate: { x: d.x + Math.sin(time + k) * 4, y: yy, z: d.z } });
        else new Zdog.Shape({ addTo: world, stroke: 1.6, color: "rgba(120,170,235,0.85)", path: [{ x: d.x, y: yy, z: d.z }, { x: d.x - 2, y: yy + 13, z: d.z }] });
      }
    }
    // critical window: a gold halo over the field
    if (st.inWindow) new Zdog.Shape({ addTo: world, stroke: 150 + (calm ? 0 : 14 * Math.sin(time * 3)), color: "rgba(214,160,20,0.12)", translate: { y: -110 } });

    illo.updateRenderGraph();
  }

  return {
    illo,
    render,
    setSize(w, h) {
      illo.setSize(w, h);
      unpin();
      illo.zoom = Math.min(w / 700, h / 500);
    },
  };
}
