import { describe, expect, it } from "vitest";
import { stateYields, irrShare, type PointRuns } from "../src/ui/state-model";
import { STATE_PROFILES } from "../src/ui/states";
import { NASS_SERIES } from "../src/ui/nass-data";

const m = (v: number) => new Map([[2000, v], [2001, v + 1]]);

describe("stateYields", () => {
  it("is the weighted mean of the free runs in 'points' mode", () => {
    const runs: PointRuns[] = [{ w: 0.25, irr: 0, free: m(8) }, { w: 0.75, irr: 0, free: m(12) }];
    const y = stateYields(runs, { untiledWet: 0, shallowWT: 0 }, "points");
    expect(y.get(2000)).toBeCloseTo(11, 10);
    expect(y.get(2001)).toBeCloseTo(12, 10);
  });
  it("mixes in irrigated and poorly drained shares in 'full' mode", () => {
    const runs: PointRuns[] = [{ w: 1, irr: 0.5, free: m(10), poor: m(8), irrigated: m(14) }];
    // rain-fed half: 0.8*10 + 0.2*8 = 9.6 ; irrigated half: 14
    expect(stateYields(runs, { untiledWet: 0.2, shallowWT: 0 }, "full").get(2000)).toBeCloseTo(0.5 * 9.6 + 0.5 * 14, 10);
    expect(stateYields(runs, { untiledWet: 0.2, shallowWT: 0 }, "points").get(2000)).toBeCloseTo(10, 10);
  });
  it("uses only years every point has", () => {
    const a: PointRuns = { w: 0.5, irr: 0, free: new Map([[2000, 10], [2001, 11]]) };
    const b: PointRuns = { w: 0.5, irr: 0, free: new Map([[2001, 9]]) };
    expect([...stateYields([a, b], { untiledWet: 0, shallowWT: 0 }, "points").keys()]).toEqual([2001]);
  });
});

describe("state profiles", () => {
  it("cover every NASS state, with weights that sum to one", () => {
    for (const s of new Set(NASS_SERIES.map((x) => x.state))) {
      const p = STATE_PROFILES.find((x) => x.state === s);
      expect(p, s).toBeDefined();
      expect(p!.points.reduce((a, q) => a + q.w, 0)).toBeCloseTo(1, 10);
    }
  });
  it("put Nebraska corn near 60% irrigated and Kansas corn near 37%, as published or estimated", () => {
    const share = (st: string) => STATE_PROFILES.find((x) => x.state === st)!.points.reduce((a, q) => a + q.w * irrShare("maize", q.irrCorn), 0);
    expect(share("Nebraska")).toBeGreaterThan(0.5);
    expect(share("Nebraska")).toBeLessThan(0.65);
    expect(share("Kansas")).toBeGreaterThan(0.33);
    expect(share("Kansas")).toBeLessThan(0.42);
    expect(share("Iowa")).toBeLessThan(0.05);
  });
  it("record the tile shares from the 2017 Census", () => {
    const t = (st: string) => STATE_PROFILES.find((x) => x.state === st)!.tile;
    expect([t("Iowa"), t("Indiana"), t("Ohio"), t("Illinois"), t("Minnesota")]).toEqual([0.53, 0.49, 0.49, 0.39, 0.37]);
  });
});
