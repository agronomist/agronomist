import { describe, expect, it } from "vitest";
import {
  buildSoilParams,
  median,
  omFromSoc,
  parseSoilGrids,
  saxtonRawls,
  soilGridsUrl,
  SoilDataError,
} from "../../src";
import { soilGridsResponse } from "./fixtures";

describe("SoilGrids URL", () => {
  it("queries the REST endpoint for the needed properties, depths and the mean", () => {
    const u = new URL(soilGridsUrl(-31.4, -64.2));
    expect(u.host).toBe("rest.isric.org");
    expect(u.pathname).toBe("/soilgrids/v2.0/properties/query");
    expect(u.searchParams.getAll("property")).toEqual(expect.arrayContaining(["clay", "sand", "soc", "nitrogen", "bdod"]));
    expect(u.searchParams.getAll("depth")).toContain("60-100cm");
    expect(u.searchParams.get("value")).toBe("mean");
  });
});

describe("parseSoilGrids", () => {
  it("applies the conversion factors given in the response", () => {
    const p = parseSoilGrids(soilGridsResponse(), 40, -90);
    const top = p.depths[0]!;
    expect(top.clayPct).toBeCloseTo(25, 6);
    expect(top.sandPct).toBeCloseTo(40, 6);
    expect(top.socGkg).toBeCloseTo(15, 6);
    expect(top.nitrogenGkg).toBeCloseTo(1.5, 6);
    expect(top.bdodKgDm3).toBeCloseTo(1.3, 6);
    expect(p.depths).toHaveLength(5);
    expect(p.depths[4]!.bottomCm).toBe(100);
  });

  it("throws a clear error where SoilGrids has no data (null values)", () => {
    expect(() => parseSoilGrids(soilGridsResponse({ nullDepth: "30-60cm" }), 0, 0)).toThrow(SoilDataError);
    expect(() => parseSoilGrids({}, 0, 0)).toThrow(SoilDataError);
  });
});

describe("Saxton-Rawls pedotransfer", () => {
  const sandy = saxtonRawls(65, 10, 1.5);
  const loam = saxtonRawls(40, 25, 2.5);
  const clay = saxtonRawls(20, 55, 2);

  it("gives texture-plausible water contents (m3/m3)", () => {
    expect(sandy.fc).toBeGreaterThan(0.1);
    expect(sandy.fc).toBeLessThan(0.28);
    expect(sandy.wp).toBeLessThan(0.12);
    expect(loam.fc).toBeGreaterThan(0.22);
    expect(loam.fc).toBeLessThan(0.4);
    expect(clay.fc).toBeGreaterThan(0.33);
    expect(clay.wp).toBeGreaterThan(0.2);
  });

  it("orders by texture: more clay holds more water at wilting point; plant-available water is always positive", () => {
    expect(clay.wp).toBeGreaterThan(loam.wp);
    expect(loam.wp).toBeGreaterThan(sandy.wp);
    for (const s of [sandy, loam, clay]) expect(s.fc - s.wp).toBeGreaterThanOrEqual(0.03);
  });

  it("converts SOC to organic matter with the 1.724 factor", () => {
    expect(omFromSoc(10)).toBeCloseTo(1.724, 6);
  });
});

describe("buildSoilParams", () => {
  const profile = parseSoilGrids(soilGridsResponse(), 40, -90);

  it("makes five layers totalling 1 m with valid water limits", () => {
    const s = buildSoilParams([profile]);
    expect(s.layers).toHaveLength(5);
    expect(s.layers.reduce((a, l) => a + l.thickness, 0)).toBe(1000);
    for (const l of s.layers) expect(l.fieldCapacity).toBeGreaterThan(l.wiltingPoint);
    expect(s.mineralizationRate).toBeDefined();
  });

  it("computes organic N in kg/ha from g/kg, bulk density and thickness", () => {
    const s = buildSoilParams([profile]);
    // 1.5 g/kg, 1.3 kg/dm3, 50 mm -> 1.5/1000 * 1.3 * 50 * 1e4 = 975 kg/ha
    expect(s.layers[0]!.organicN).toBeCloseTo(975, 6);
  });

  it("takes the median across sample points, so one outlier point does not dominate", () => {
    const a = parseSoilGrids(soilGridsResponse({ clay: 250 }), 0, 0);
    const b = parseSoilGrids(soilGridsResponse({ clay: 260 }), 0, 0);
    const outlier = parseSoilGrids(soilGridsResponse({ clay: 700 }), 0, 0);
    const mixed = buildSoilParams([a, b, outlier]);
    const base = buildSoilParams([b]);
    expect(mixed.layers[0]!.wiltingPoint).toBeCloseTo(base.layers[0]!.wiltingPoint, 6);
  });

  it("throws when there are no profiles; median handles even counts", () => {
    expect(() => buildSoilParams([])).toThrow(SoilDataError);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});
