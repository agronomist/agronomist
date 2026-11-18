/** Geometry for a user-drawn field. Coordinates are [lon, lat] in degrees (WGS84). */
export type LngLat = readonly [number, number];

export class FieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldError";
  }
}

const R = 6371008.8; // mean Earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;

/** Remove the closing vertex if the ring repeats its first point. */
export function openRing(ring: readonly LngLat[]): LngLat[] {
  const r = ring.slice();
  const a = r[0];
  const b = r[r.length - 1];
  if (r.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) r.pop();
  return r;
}

/** Project to local planar meters (equirectangular around a reference latitude). Fine for field-scale polygons. */
function project(ring: readonly LngLat[], refLat: number): [number, number][] {
  const k = Math.cos(rad(refLat));
  return ring.map(([lon, lat]) => [rad(lon) * R * k, rad(lat) * R]);
}

function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function areaHectares(ring: readonly LngLat[]): number {
  const r = openRing(ring);
  const refLat = r.reduce((s, p) => s + p[1], 0) / r.length;
  return Math.abs(signedArea(project(r, refLat))) / 10000;
}

export function centroid(ring: readonly LngLat[]): LngLat {
  const r = openRing(ring);
  const refLat = r.reduce((s, p) => s + p[1], 0) / r.length;
  const pts = project(r, refLat);
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-9) throw new FieldError("Degenerate polygon");
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  cx /= 6 * A;
  cy /= 6 * A;
  const k = Math.cos(rad(refLat));
  return [(cx / (R * k) / Math.PI) * 180, (cy / R / Math.PI) * 180];
}

export function pointInPolygon(pt: LngLat, ring: readonly LngLat[]): boolean {
  const r = openRing(ring);
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o = (p: LngLat, q: LngLat, r: LngLat) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export interface FieldLimits {
  minHa: number;
  maxHa: number;
}
export const DEFAULT_LIMITS: FieldLimits = { minHa: 0.1, maxHa: 500 };

/** Validate a drawn ring; returns the open ring. Throws FieldError with a user-presentable message. */
export function validateField(ring: readonly LngLat[], limits: FieldLimits = DEFAULT_LIMITS): LngLat[] {
  const r = openRing(ring);
  if (r.length < 3) throw new FieldError("Draw at least 3 corners.");
  for (const [lon, lat] of r) {
    if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) throw new FieldError("Coordinates out of range.");
  }
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === r.length - 1);
      if (adjacent) continue;
      if (segmentsIntersect(r[i]!, r[(i + 1) % r.length]!, r[j]!, r[(j + 1) % r.length]!)) {
        throw new FieldError("The boundary crosses itself.");
      }
    }
  }
  const ha = areaHectares(r);
  if (ha < limits.minHa) throw new FieldError(`Field is too small (${ha.toFixed(2)} ha).`);
  if (ha > limits.maxHa) throw new FieldError(`Field is too large (${ha.toFixed(0)} ha; max ${limits.maxHa}).`);
  return r;
}

/**
 * Up to n well-spread sample points inside the polygon (always includes at least one).
 * Uses a regular grid over the bounding box, then keeps the points inside, thinned evenly.
 */
export function samplePoints(ring: readonly LngLat[], n: number): LngLat[] {
  const r = openRing(ring);
  const lons = r.map((p) => p[0]);
  const lats = r.map((p) => p[1]);
  const [x0, x1] = [Math.min(...lons), Math.max(...lons)];
  const [y0, y1] = [Math.min(...lats), Math.max(...lats)];
  const steps = 24;
  const inside: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const p: LngLat = [x0 + ((i + 0.5) / steps) * (x1 - x0), y0 + ((j + 0.5) / steps) * (y1 - y0)];
      if (pointInPolygon(p, r)) inside.push(p);
    }
  }
  if (inside.length === 0) {
    const c = centroid(r);
    return [pointInPolygon(c, r) ? c : r[0]!];
  }
  if (inside.length <= n) return inside;
  const out: LngLat[] = [];
  for (let k = 0; k < n; k++) out.push(inside[Math.floor(((k + 0.5) / n) * inside.length)]!);
  return out;
}
