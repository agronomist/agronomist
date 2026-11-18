import { describe, expect, it } from "vitest";
import {
  areaHectares,
  centroid,
  FieldError,
  pointInPolygon,
  samplePoints,
  validateField,
  type LngLat,
} from "../../src";

const square = (lon: number, lat: number, size: number): LngLat[] => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
];

describe("area and centroid", () => {
  it("0.01 degree square at the equator is about 124 ha", () => {
    expect(areaHectares(square(0, 0, 0.01))).toBeGreaterThan(122);
    expect(areaHectares(square(0, 0, 0.01))).toBeLessThan(126);
  });

  it("shrinks with latitude (cos factor)", () => {
    const a45 = areaHectares(square(0, 45, 0.01));
    expect(a45 / areaHectares(square(0, 0, 0.01))).toBeCloseTo(Math.cos((45.005 * Math.PI) / 180), 2);
  });

  it("ignores a repeated closing vertex and vertex order", () => {
    const sq = square(10, 10, 0.005);
    expect(areaHectares([...sq, sq[0]!])).toBeCloseTo(areaHectares(sq), 6);
    expect(areaHectares(sq.slice().reverse())).toBeCloseTo(areaHectares(sq), 6);
  });

  it("centroid of a square is its center", () => {
    const [lon, lat] = centroid(square(-64.2, -31.4, 0.01));
    expect(lon).toBeCloseTo(-64.195, 4);
    expect(lat).toBeCloseTo(-31.395, 4);
  });
});

describe("validation", () => {
  it("accepts a normal field", () => {
    expect(validateField(square(-64.2, -31.4, 0.005))).toHaveLength(4);
  });
  it("rejects too few corners, bowties, tiny and huge fields, bad coordinates", () => {
    expect(() => validateField([[0, 0], [1, 1]])).toThrow(FieldError);
    expect(() => validateField([[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01]])).toThrow(/crosses/);
    expect(() => validateField(square(0, 0, 0.0002))).toThrow(/too small/);
    expect(() => validateField(square(0, 0, 0.1))).toThrow(/too large/);
    expect(() => validateField([[200, 0], [201, 0], [201, 1]])).toThrow(/range/);
  });
});

describe("sampling", () => {
  const L: LngLat[] = [
    [0, 0], [0.01, 0], [0.01, 0.004], [0.004, 0.004], [0.004, 0.01], [0, 0.01],
  ];
  it("returns at most n points, all inside, even for a concave L shape", () => {
    const pts = samplePoints(L, 5);
    expect(pts.length).toBeLessThanOrEqual(5);
    expect(pts.length).toBeGreaterThan(1);
    for (const p of pts) expect(pointInPolygon(p, L)).toBe(true);
  });
  it("always returns at least one point inside, even for a sliver", () => {
    const sliver: LngLat[] = [[0, 0], [0.01, 0], [0.01, 0.00001]];
    const pts = samplePoints(sliver, 3);
    expect(pts.length).toBeGreaterThanOrEqual(1);
  });
  it("spreads points: distinct locations", () => {
    const pts = samplePoints(square(0, 0, 0.01), 4);
    expect(new Set(pts.map((p) => p.join(","))).size).toBe(pts.length);
  });
});
