import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { clamp, mix, seeded } from "./draw-util";
import type { Frame } from "./scene";
import type { Run } from "./model-run";

/**
 * The field in WebGL (Three.js): real lighting and shadows, instanced plants, a soil block with a labelled cut face.
 * It is a separate bundle that the page loads only when this view is chosen, so the main app does not grow.
 * Same inputs as the Zdog view: the scene is placed from the model state every frame.
 */
const BLOCK = { w: 360, d: 220, h: 170 };
const COLS = [-144, -72, 0, 72, 144];
const ROWS = [-80, -27, 27, 80];
const R = seeded(31);
const JIT = Array.from({ length: COLS.length * ROWS.length }, () => ({ x: (R() - 0.5) * 16, z: (R() - 0.5) * 12, yaw: R() * 6.28 }));
const RR = seeded(7);
const LATERALS = Array.from({ length: 40 }, () => ({ side: RR() < 0.5 ? -1 : 1, len: 0.4 + 0.6 * RR(), wob: RR() * 6 }));
const DROPS = Array.from({ length: 140 }, () => ({ x: (R() - 0.5) * 460, z: (R() - 0.5) * 320, o: R() * 300 }));
const CLOUDS = Array.from({ length: 4 }, () => ({ x: (R() - 0.5) * 520, y: 150 + R() * 70, z: -170 - R() * 90, s: 0.9 + R() * 0.8, v: 4 + R() * 6 }));

export interface SceneThree {
  canvas: HTMLCanvasElement;
  render(run: Run, fr: Frame, time: number, calm: boolean): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

/** One leaf: a ribbon along +x that rises, then arches over; width follows a pointed profile. Scaled per instance. */
function leafGeometry(): BufferGeometry {
  const seg = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const y = 0.28 * u - 0.6 * u * u;
    const hw = 0.5 * Math.sin(Math.PI * Math.pow(Math.min(1, u * 1.02), 0.62)) * (0.35 + 0.65 * (1 - u * 0.3));
    pos.push(u, y, -hw, u, y, hw);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const pill = (text: string, rel: number) => {
  const c = document.createElement("canvas");
  c.width = 288;
  c.height = 48;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(24,20,16,0.72)";
  g.beginPath();
  g.roundRect(2, 2, 284, 44, 22);
  g.fill();
  g.fillStyle = rel < 0.35 ? "#f0b35a" : "#8fd0f6";
  g.beginPath();
  g.roundRect(14, 14, 20, 20, 10);
  g.fill();
  g.font = "600 24px system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText(text, 44, 25);
  return c;
};

export function createSceneThree(onDrag: () => void): SceneThree {
  const canvas = document.createElement("canvas");
  canvas.id = "scene3gl";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Animated 3D field with a soil block. Plant growth, rain, sun and soil water follow the simulation.");
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1.6, 50, 4000);
  let az = -0.45;
  const EL = 0.5;
  let dist = 880;

  const hemi = new HemisphereLight(0xcfe6ff, 0x6b5a44, 0.9);
  const amb = new AmbientLight(0xffffff, 0.15);
  const sun = new DirectionalLight(0xfff1d0, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -300;
  sc.right = 300;
  sc.top = 300;
  sc.bottom = -300;
  sc.near = 50;
  sc.far = 1200;
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 3;
  scene.add(hemi, amb, sun, sun.target);
  const fill = new DirectionalLight(0xdfeaff, 0.5);
  fill.position.set(-260, 200, 320);
  scene.add(fill);

  // ---- soil block ----
  const layerMeshes: Mesh[] = [];
  const labels: Sprite[] = [];
  const labelKey: string[] = [];
  let layerSig = "";
  const soilGroup = new Group();
  scene.add(soilGroup);
  const topTex = (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "rgba(0,0,0,0.16)";
    for (const z of ROWS) g.fillRect(0, (z / BLOCK.d + 0.5) * 256 - 3, 256, 6);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const topMat = new MeshStandardMaterial({ map: topTex, color: 0x8aa850, roughness: 1 });
  const top = new Mesh(new PlaneGeometry(BLOCK.w, BLOCK.d), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.2;
  top.receiveShadow = true;
  scene.add(top);

  // soft contact shadow under the block, so it sits on something
  const blob = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    gr.addColorStop(0, "rgba(20,30,40,0.38)");
    gr.addColorStop(1, "rgba(20,30,40,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  })();
  const shadow = new Mesh(new PlaneGeometry(620, 470), new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -BLOCK.h - 3;
  scene.add(shadow);

  function buildLayers(run: Run) {
    for (const m of layerMeshes) {
      soilGroup.remove(m);
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
    for (const s of labels) {
      soilGroup.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    layerMeshes.length = 0;
    labels.length = 0;
    labelKey.length = 0;
    const layers = run.soil.layers;
    const total = layers.reduce((s, l) => s + l.thickness, 0);
    let y = 0;
    for (const l of layers) {
      const h = (l.thickness / total) * BLOCK.h;
      const m = new Mesh(new BoxGeometry(BLOCK.w, h, BLOCK.d), new MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.95 }));
      m.position.y = -(y + h / 2);
      m.receiveShadow = true;
      m.castShadow = true;
      soilGroup.add(m);
      layerMeshes.push(m);
      const sp = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }));
      sp.renderOrder = 20;
      sp.scale.set(150, 25, 1);
      soilGroup.add(sp);
      labels.push(sp);
      labelKey.push("");
      y += h;
    }
    // label positions: the layer's middle, spread apart so thin top layers stay readable
    let prev = 4;
    let acc = 0;
    layers.forEach((l, k) => {
      const mid = acc + ((l.thickness / total) * BLOCK.h) / 2;
      const yy = Math.max(mid, prev + 26);
      prev = yy;
      acc += (l.thickness / total) * BLOCK.h;
      labels[k]!.position.set(-BLOCK.w / 2 + 88, -Math.min(yy, BLOCK.h - 12), BLOCK.d / 2 + 3);
    });
  }

  // ---- plants (instanced) ----
  const NP = COLS.length * ROWS.length;
  const stemGeo = new CylinderGeometry(0.55, 1, 1, 6, 1);
  stemGeo.translate(0, 0.5, 0);
  const mk = (geo: BufferGeometry, mat: MeshStandardMaterial, n: number) => {
    const m = new InstancedMesh(geo, mat, n);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  };
  const stems = mk(stemGeo, new MeshStandardMaterial({ roughness: 0.8 }), NP * 12 + 400);
  const leaves = mk(leafGeometry(), new MeshStandardMaterial({ roughness: 0.65, side: DoubleSide }), 700);
  const earGeo = new SphereGeometry(0.5, 10, 8);
  const ears = mk(earGeo, new MeshStandardMaterial({ roughness: 0.7 }), NP * 4 + 120);
  const coneGeo = new ConeGeometry(0.5, 1, 4);
  coneGeo.translate(0, 0.5, 0);
  const tassels = mk(coneGeo, new MeshStandardMaterial({ roughness: 0.8 }), NP * 6);
  const seed = new Mesh(new SphereGeometry(4, 8, 6), new MeshStandardMaterial({ color: 0xe0c46a }));
  seed.position.set(72, -6, 27);
  scene.add(seed);

  // roots on the cut face
  const rootMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 260);
  rootMesh.frustumCulled = false;
  rootMesh.count = 0;
  rootMesh.renderOrder = 10;
  scene.add(rootMesh);

  // weather
  const rainPos = new Float32Array(DROPS.length * 6);
  const rainGeo = new BufferGeometry();
  rainGeo.setAttribute("position", new BufferAttribute(rainPos, 3));
  const rain = new LineSegments(rainGeo, new LineBasicMaterial({ color: 0x78aaeb, transparent: true, opacity: 0.75 }));
  rain.frustumCulled = false;
  scene.add(rain);
  const snowPos = new Float32Array(DROPS.length * 3);
  const snowGeo = new BufferGeometry();
  snowGeo.setAttribute("position", new BufferAttribute(snowPos, 3));
  const snow = new Points(snowGeo, new PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: true }));
  snow.frustumCulled = false;
  scene.add(snow);

  // sky bodies
  const sunBall = new Mesh(new SphereGeometry(34, 20, 14), new MeshBasicMaterial({ color: 0xfff3be, transparent: true }));
  const sunGlow = new Mesh(new SphereGeometry(58, 20, 14), new MeshBasicMaterial({ color: 0xfff0b0, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  scene.add(sunBall, sunGlow);
  const clouds = CLOUDS.map((c) => {
    const g = new Group();
    const m = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    for (let k = 0; k < 4; k++) {
      const s = new Mesh(new SphereGeometry(26 + 12 * (k === 1 || k === 2 ? 1 : 0), 12, 8), m);
      s.position.set((k - 1.5) * 34, k === 1 || k === 2 ? 8 : 0, (k % 2) * 8);
      s.scale.set(1.2, 0.7, 0.8);
      g.add(s);
    }
    g.scale.setScalar(c.s);
    scene.add(g);
    return { g, m, c };
  });

  // ---- reusable math objects ----
  const P = new Matrix4();
  const Lm = new Matrix4();
  const Tm = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const v = new Vector3();
  const sv = new Vector3();
  const col = new Color();

  const placeStem = (mesh: InstancedMesh, i: number, parent: Matrix4, r: number, h: number, color: string) => {
    sv.set(r, h, r);
    Lm.compose(v.set(0, 0, 0), q.identity(), sv);
    Tm.multiplyMatrices(parent, Lm);
    mesh.setMatrixAt(i, Tm);
    mesh.setColorAt(i, col.set(color));
  };
  const placeLeaf = (i: number, parent: Matrix4, y: number, yaw: number, pitch: number, len: number, wid: number, color: string, lx = 0) => {
    e.set(0, yaw, pitch, "YZX");
    q.setFromEuler(e);
    Lm.compose(v.set(lx, y, 0), q, sv.set(len, len, len * wid));
    Tm.multiplyMatrices(parent, Lm);
    leaves.setMatrixAt(i, Tm);
    leaves.setColorAt(i, col.set(color));
  };
  const parentOf = (x: number, z: number, yaw: number, tz: number, tx: number) => {
    e.set(tx, yaw, tz, "YZX");
    q.setFromEuler(e);
    return P.compose(v.set(x, 0, z), q, sv.set(1, 1, 1)).clone();
  };

  function placePlants(run: Run, fr: Frame, time: number, calm: boolean) {
    const st = fr.state;
    const key = run.cfg.key;
    const dead = st.frostKilled;
    let ns = 0;
    let nl = 0;
    let ne = 0;
    let nt = 0;
    const greenOf = (bTop: string, mn: number) => mix(mix(bTop, "#a9b04a", clamp(1 - st.ws, 0, 1) * 1.2), "#b8cc7a", clamp(1 - st.nni, 0, 1) * mn);
    let idx = 0;
    for (let ri = 0; ri < ROWS.length; ri++)
      for (let ci = 0; ci < COLS.length; ci++, idx++) {
        const j = JIT[idx]!;
        const x = COLS[ci]! + j.x;
        const z = ROWS[ri]! + j.z;
        const phase = ri * 1.7 + ci * 2.3;
        if (key === "wheat") {
          const h = 110 * st.hFrac;
          if (h < 2) continue;
          const matureTan = clamp((st.dvs - 1.4) / 0.5, 0, 1);
          const stemCol = dead ? "#8c8160" : mix("#74a845", "#cdb868", matureTan);
          const green = greenOf("#5ea23f", 0.9);
          for (let k = 0; k < 4; k++) {
            const tx = Math.cos(k * 1.7 + idx) * 7;
            const tz = Math.sin(k * 1.7 + idx) * 7;
            const hh = h * (0.88 + 0.12 * ((k * 5) % 3) / 2);
            const lean = calm ? 0 : Math.sin(time * 1.3 + phase + k) * (0.015 + 0.04 * st.hFrac);
            const Pm = parentOf(x + tx, z + tz, j.yaw, lean, lean * 0.6);
            placeStem(stems, ns++, Pm, 1.2, hh, stemCol);
            const n = Math.round(2 + 3 * st.leafScale);
            for (let l = 0; l < n; l++) {
              const u = 0.08 + (0.5 * l) / n;
              const sen = dead || matureTan > 0.15 + 0.6 * (l / n);
              const len = (22 + 38 * st.hFrac) * st.leafScale * (1 - 0.3 * u) + 6;
              placeLeaf(nl++, Pm, hh * u, k * 1.7 + l * 2.5, 0.75 - 0.5 * (1 - u) - (sen ? 0.15 : 0), len, 0.13, sen ? mix(green, dead ? "#8c8160" : "#cdb868", 0.85) : green);
            }
            if (st.dvs > 0.9) {
              const len = 6 + 24 * clamp(0.25 + st.earFrac * 0.75, 0, 1);
              sv.set(5, len, 5);
              Lm.compose(v.set(0, hh + len * 0.4, 0), q.identity(), sv);
              Tm.multiplyMatrices(Pm, Lm);
              ears.setMatrixAt(ne, Tm);
              ears.setColorAt(ne++, col.set(dead ? "#a39668" : mix("#7fae4c", "#e0be5a", clamp(st.earFrac * 2.2, 0, 1))));
            }
          }
        } else if (key === "soy") {
          const h = 95 * st.hFrac;
          if (h < 2) continue;
          const matureTan = clamp((st.dvs - 1.5) / 0.4, 0, 1);
          const stemCol = dead ? "#8c8160" : mix("#6aa34a", "#b9a560", matureTan);
          const green = greenOf("#4f9a3a", 0.5);
          const lean = calm ? 0 : Math.sin(time * 1.2 + phase) * (0.01 + 0.03 * st.hFrac);
          const Pm = parentOf(x, z, j.yaw, lean, lean * 0.5);
          placeStem(stems, ns++, Pm, 1.9, h, stemCol);
          const nodes = Math.round(2 + 6 * st.leafScale);
          const deadShare = clamp(st.deadLeaf / Math.max(1, st.leaf + st.deadLeaf), 0, 1);
          const r = 7 + 9 * st.leafScale;
          for (let k = 0; k < nodes; k++) {
            const u = 0.15 + (0.8 * k) / nodes;
            const ang = k * 2.4;
            const reach = r * (2.2 - 0.9 * u);
            const sen = dead || k < deadShare * nodes || matureTan > 0.15 + 0.7 * (k / nodes);
            const c = sen ? mix(green, dead ? "#8c8160" : "#d2b857", 0.85) : green;
            const droop = st.ws < 0.6 ? 0.3 : 0;
            // petiole: a short stem leaving the node
            e.set(0, ang, -Math.PI / 2 + 0.3 - droop, "YZX");
            q.setFromEuler(e);
            Lm.compose(v.set(0, h * u, 0), q, sv.set(0.9, reach, 0.9));
            Tm.multiplyMatrices(Pm, Lm);
            stems.setMatrixAt(ns, Tm);
            stems.setColorAt(ns++, col.set(stemCol));
            // three leaflets at its tip
            const tipX = reach * Math.cos(0.3 - droop);
            const tipY = h * u + reach * Math.sin(0.3 - droop);
            for (let m = -1; m <= 1; m++) {
              e.set(0, ang + m * 0.7, 0.15 - droop, "YZX");
              q.setFromEuler(e);
              // rotate the leaflet about the petiole's tip: the tip sits at (tipX, tipY) in the plant's frame turned by `ang`
              const cx = tipX * Math.cos(ang);
              const cz = -tipX * Math.sin(ang);
              Lm.compose(v.set(cx, tipY, cz), q, sv.set(r * 1.5, r * 1.5, r * 1.5 * 0.9));
              Tm.multiplyMatrices(Pm, Lm);
              leaves.setMatrixAt(nl, Tm);
              leaves.setColorAt(nl++, col.set(c));
            }
          }
          if (st.dvs > 1.15) {
            const pod = dead ? "#a39668" : mix("#7fae4c", "#c9ab6c", clamp(st.earFrac * 1.6 + matureTan, 0, 1));
            const n = 4 + Math.round(6 * st.earFrac);
            for (let k = 0; k < n; k++) {
              const u = 0.3 + 0.06 * k;
              sv.set(3 + 2 * st.earFrac, 10 + 8 * st.earFrac, 3 + 2 * st.earFrac);
              Lm.compose(v.set(k % 2 ? 7 : -7, h * u, (k % 3) * 3 - 3), q.identity(), sv);
              Tm.multiplyMatrices(Pm, Lm);
              ears.setMatrixAt(ne, Tm);
              ears.setColorAt(ne++, col.set(pod));
            }
          }
        } else {
          const h = 165 * st.hFrac;
          if (h < 3) continue;
          const matureTan = clamp((st.dvs - 1.5) / 0.45, 0, 1);
          const stemCol = dead ? "#8c8160" : mix("#5f9440", "#b5a263", matureTan);
          const lean = calm ? 0 : Math.sin(time * 1.1 + phase) * (0.015 + 0.04 * st.hFrac);
          const Pm = parentOf(x, z, j.yaw, lean, lean * 0.5);
          placeStem(stems, ns++, Pm, (3 + 3.5 * st.hFrac) * 0.85, h, stemCol);
          const n = Math.round(3 + 8 * st.leafScale);
          const deadShare = clamp(st.deadLeaf / Math.max(1, st.leaf + st.deadLeaf), 0, 1);
          const green = greenOf("#4f9a3a", 0.9);
          for (let k = 0; k < n; k++) {
            const u = 0.1 + (0.82 * k) / n;
            const sen = dead || k < deadShare * n || matureTan > 0.2 + 0.7 * (k / n);
            const c = sen ? mix(green, dead ? "#8c8160" : "#c3b273", 0.85) : green;
            const len = (26 + 52 * st.hFrac) * st.leafScale * (1 - 0.42 * u) + 6;
            const yaw = k * 2.4 + (calm ? 0 : Math.sin(time * 0.9 + k + phase) * 0.1);
            const pitch = 1.05 - 0.75 * (1 - u) * (1 - st.ws * 0.3) - (sen ? 0.3 : 0);
            placeLeaf(nl++, Pm, h * u, yaw, pitch, len * 1.25, 0.2, c);
          }
          if (st.dvs > 0.75 && st.dvs < 1.9) {
            for (let k = 0; k < 5; k++) {
              e.set(0, k * 1.26, 0.7, "YZX");
              q.setFromEuler(e);
              Lm.compose(v.set(0, h, 0), q, sv.set(1.6, 18, 1.6));
              Tm.multiplyMatrices(Pm, Lm);
              tassels.setMatrixAt(nt, Tm);
              tassels.setColorAt(nt++, col.set(dead ? "#8c8160" : "#d9c58a"));
            }
          }
          if (st.dvs > 0.95) {
            const f = st.earFrac;
            e.set(0, 0, -0.35, "YZX");
            q.setFromEuler(e);
            Lm.compose(v.set(7, h * 0.5, 0), q, sv.set(8 + 12 * f, 18 + 38 * f, 8 + 12 * f));
            Tm.multiplyMatrices(Pm, Lm);
            ears.setMatrixAt(ne, Tm);
            ears.setColorAt(ne++, col.set(dead ? "#9c8f66" : mix("#79a64a", "#e3b53b", clamp(f * 2.2, 0, 1))));
          }
        }
      }
    for (const [m, n] of [[stems, ns], [leaves, nl], [ears, ne], [tassels, nt]] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  function placeRoots(run: Run, fr: Frame) {
    const layers = run.soil.layers;
    const total = layers.reduce((s, l) => s + l.thickness, 0);
    const depth = (fr.rootDepthMm / total) * BLOCK.h;
    const rx = 72;
    const rz = BLOCK.d / 2 + 0.6;
    let n = 0;
    const relAt = (d: number) => {
      let acc = 0;
      for (let k = 0; k < layers.length; k++) {
        acc += (layers[k]!.thickness / total) * BLOCK.h;
        if (d <= acc) return fr.soilRel[k]!;
      }
      return fr.soilRel[layers.length - 1]!;
    };
    const seg = (x0: number, y0: number, x1: number, y1: number, w: number, d: number) => {
      if (n >= 260) return;
      const dx = x1 - x0;
      const dy = y1 - y0;
      e.set(0, 0, Math.atan2(dy, dx), "YZX");
      q.setFromEuler(e);
      Lm.compose(v.set((x0 + x1) / 2, (y0 + y1) / 2, rz), q, sv.set(Math.hypot(dx, dy) + w * 0.6, w, 0.6));
      rootMesh.setMatrixAt(n, Lm);
      rootMesh.setColorAt(n++, col.set(mix("#f1d9a0", "#e6f6ff", relAt(d))));
    };
    if (fr.emerged) {
      const step = 6;
      let px = rx;
      let py = 0;
      for (let d = step; d <= depth + 0.01; d += step) {
        const x = rx + Math.sin(d * 0.07) * 2;
        seg(px, py, x, -d, 4 - 2.6 * (d / Math.max(depth, 1)), d);
        px = x;
        py = -d;
      }
      for (let k = 0, d = 12; d < depth && k < LATERALS.length; k++, d += 12) {
        const r = LATERALS[k]!;
        const len = Math.min(95 * Math.exp((-1.8 * d) / BLOCK.h) * r.len + 10, (depth - d) * 1.4 + 8);
        let lx = rx + Math.sin(d * 0.07) * 2;
        let ly = -d;
        for (let i = 1; i <= 6; i++) {
          const u = i / 6;
          const nx = rx + r.side * len * u;
          const ny = -d - ((4 + r.wob) * 2 * u * (1 - 0.5 * u) + 8 * u * u);
          seg(lx, ly, nx, ny, 1.9 - 1.3 * u, d);
          lx = nx;
          ly = ny;
        }
      }
    }
    rootMesh.count = n;
    rootMesh.instanceMatrix.needsUpdate = true;
    if (rootMesh.instanceColor) rootMesh.instanceColor.needsUpdate = true;
  }

  // ---- drag to turn (horizontal only, so vertical swipes still scroll the page) ----
  let dragX: number | null = null;
  canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", (ev) => {
    dragX = ev.clientX;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (dragX === null) return;
    az = clamp(az + (ev.clientX - dragX) * 0.008, -1.1, 1.1);
    dragX = ev.clientX;
    onDrag();
  });
  const end = () => (dragX = null);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  let sig = "";
  function render(run: Run, fr: Frame, time: number, calm: boolean) {
    const s = `${run.soil.layers.length}:${run.soil.layers.map((l) => l.thickness).join(",")}`;
    if (s !== sig) {
      sig = s;
      layerSig = s;
      buildLayers(run);
    }
    void layerSig;
    const st = fr.state;
    const frost = fr.tmin <= 0;
    const snowy = fr.tmax <= 1;
    const clarity = clamp((fr.srad - 6) / 18, 0, 1);
    const hot = clamp((fr.tmax - 33) / 8, 0, 1);
    let skyTop = mix("#8d9fb0", "#3f86d3", clarity);
    let skyBot = mix("#cbd5dc", "#bde2f5", clarity);
    skyBot = mix(skyBot, "#f3c685", hot * 0.8);
    skyTop = mix(skyTop, "#6f9bc4", hot * 0.4);
    if (frost) {
      skyTop = mix(skyTop, "#b9c8d9", 0.5);
      skyBot = mix(skyBot, "#e8f0f7", 0.6);
    }
    canvas.style.background = `linear-gradient(${skyTop}, ${skyBot} 75%)`;

    // light follows the season and the day of the run
    const elev = 0.5 + 0.5 * Math.cos((2 * Math.PI * (fr.doy - 172)) / 365);
    const sunX = -230 + 460 * fr.progress;
    sun.position.set(sunX * 0.9, 240 + 160 * elev, 200);
    sun.target.position.set(0, 0, 0);
    sun.intensity = 0.6 + 2 * clarity;
    sun.color.set(mix("#fff1d0", "#ffd9a0", hot));
    hemi.intensity = 0.7 + 0.5 * (1 - clarity * 0.4);
    hemi.color.set(frost ? "#dfe9f4" : "#cfe6ff");
    sunBall.position.set(sunX, 40 + 90 * elev, -230);
    sunGlow.position.copy(sunBall.position);
    (sunBall.material as MeshBasicMaterial).opacity = 0.45 + 0.55 * clarity;
    (sunGlow.material as MeshBasicMaterial).opacity = 0.12 + 0.2 * clarity;
    const cover = 1 - clarity;
    for (const k of clouds) {
      const x = (((k.c.x + (calm ? 0 : time * k.c.v) + 330) % 660) - 330);
      k.g.position.set(x, k.c.y, k.c.z);
      k.m.opacity = 0.35 + 0.55 * cover;
    }

    // soil
    fr.soilRel.forEach((rel, k) => {
      const m = layerMeshes[k];
      if (!m) return;
      const mat = m.material as MeshStandardMaterial;
      mat.color.set(mix("#cfae78", "#4a3225", rel));
      mat.roughness = 0.95 - 0.25 * rel;
      const l = run.soil.layers[k]!;
      const lo = run.soil.layers.slice(0, k).reduce((a, b) => a + b.thickness, 0);
      const key = `${Math.round(rel * 20)}`;
      if (labelKey[k] !== key) {
        labelKey[k] = key;
        const sp = labels[k]!;
        sp.material.map?.dispose();
        const tx = new CanvasTexture(pill(`${Math.round(lo / 10)}–${Math.round((lo + l.thickness) / 10)} cm  ${Math.round(rel * 100)}%`, rel));
        tx.colorSpace = SRGBColorSpace;
        sp.material.map = tx;
        sp.material.needsUpdate = true;
      }
    });
    topMat.color.set(snowy ? "#eef3f6" : frost ? "#a9b79a" : "#8aa850");

    // plants, roots, seed
    seed.visible = !fr.emerged;
    if (fr.emerged) {
      placePlants(run, fr, time, calm);
      for (const m of [stems, leaves, ears, tassels]) m.visible = true;
    } else for (const m of [stems, leaves, ears, tassels]) m.visible = false;
    placeRoots(run, fr);

    // rain and snow
    const falling = fr.rain > 0.2;
    rain.visible = falling && !snowy;
    snow.visible = falling && snowy;
    if (falling) {
      const n = Math.min(DROPS.length, Math.round(fr.rain * 8 + 16));
      for (let k = 0; k < n; k++) {
        const d = DROPS[k]!;
        const yy = 300 - ((calm ? d.o : time * (snowy ? 60 : 340) + d.o) % 300);
        if (snowy) {
          snowPos.set([d.x + Math.sin(time + k) * 4, yy, d.z], k * 3);
        } else rainPos.set([d.x, yy, d.z, d.x - 2, yy - 13, d.z], k * 6);
      }
      rainGeo.setDrawRange(0, n * 2);
      snowGeo.setDrawRange(0, n);
      rainGeo.attributes.position!.needsUpdate = true;
      snowGeo.attributes.position!.needsUpdate = true;
    }
    void st;

    camera.position.set(Math.sin(az) * Math.cos(EL) * dist, Math.sin(EL) * dist - 10, Math.cos(az) * Math.cos(EL) * dist);
    camera.lookAt(0, 8, 0);
    renderer.render(scene, camera);
  }

  return {
    canvas,
    render,
    setSize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      dist = Math.max(880, 520 / (2 * Math.tan(Math.PI / 12) * camera.aspect));
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.dispose();
    },
  };
}

(globalThis as unknown as { __cropThree?: { create: typeof createSceneThree } }).__cropThree = { create: createSceneThree };
