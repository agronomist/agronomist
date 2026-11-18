export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Accepts "#rrggbb" or "rgb(r,g,b)" so results of mix() can be mixed again. */
export function hexToRgb(h: string): [number, number, number] {
  if (h.startsWith("rgb")) {
    const m = h.match(/\d+(\.\d+)?/g)!.map(Number);
    return [m[0]!, m[1]!, m[2]!];
  }
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(lerp(r1, r2, k))},${Math.round(lerp(g1, g2, k))},${Math.round(lerp(b1, b2, k))})`;
}

/** Small deterministic PRNG for stable root and cloud layouts. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a plant drawing needs. Crop-specific art implements PlantArt using only this state. */
export interface PlantState {
  dvs: number;
  lai: number;
  leaf: number;
  stem: number;
  storage: number;
  deadLeaf: number;
  ws: number; // 1 = no water stress
  nni: number; // 1 = no N stress
  inWindow: boolean;
  kernels: number;
  frostKilled: boolean;
  hFrac: number; // 0-1 plant height fraction
  leafScale: number; // 0-1 canopy size
  earFrac: number; // 0-1 grain/ear fill
  winStartDvs: number;
}
export interface PlantArt {
  /** Optional plant placement (fractions of scene width) and size relative to the default */
  layout?: { back: number[]; front: number[]; sizeScale: number };
  /** Draw one plant standing at (x, baseY). `size` is the maximum plant height in px. */
  draw(ctx: CanvasRenderingContext2D, x: number, baseY: number, size: number, st: PlantState, time: number, phase: number, calm: boolean): void;
}
