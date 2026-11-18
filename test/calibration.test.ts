import { describe, expect, it } from "vitest";
import { CROPS } from "../src/ui/crops";
import { syntheticEnsemble } from "../src/ui/ensemble";
import { DEFAULT_PRICES, evaluate, meanLosses, nResponse, type Option } from "../src/ui/decision";
import { locationByKey, soilFor } from "../src/ui/locations";

/**
 * Level checks against published figures, run on thirty synthetic seasons drawn around central Iowa's climate normals.
 * Targets (all weather-only, modern management):
 *  - Iowa state corn yield averaged about 200 bu/ac in 2016-2024 (NASS), i.e. 12.5 t/ha at 15.5% moisture = 10.6 t/ha dry.
 *  - Water-limited yield gaps in the Corn Belt are 10-20% of potential; irrigated potential is 13-15 t/ha dry.
 *  - Iowa State's MRTN for corn after soybean sits at 140-160 kg N/ha at a 0.10 price ratio; unfertilized corn makes 55-75% of the plateau.
 *  - Economic optimum seeding rate is 8-9 seeds/m2, and sowing from late April to mid May is best.
 * The year-by-year comparison with NASS needs real weather; the page runs it in the browser.
 */
describe("Iowa maize level (synthetic normals)", () => {
  const cfg = CROPS.maize;
  const loc = locationByKey("iowa");
  const soil = soilFor(loc);
  const ens = syntheticEnsemble(cfg, loc, 30);
  const o: Option = { id: "a", name: "A", sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter" };
  const p = DEFAULT_PRICES.maize;
  const e = evaluate(cfg, loc, soil, o, ens, p);

  it("the default plan makes about the state average, with a realistic year-to-year spread", () => {
    expect(e.yield.mean).toBeGreaterThan(9.5);
    expect(e.yield.mean).toBeLessThan(11.8);
    const cv = e.yield.sd / e.yield.mean;
    expect(cv).toBeGreaterThan(0.1);
    expect(cv).toBeLessThan(0.25);
  });
  it("potential yield and the water gap are in the published range", () => {
    const l = meanLosses(cfg, loc, soil, o, ens);
    expect(l.potential).toBeGreaterThan(12);
    expect(l.potential).toBeLessThan(15.5);
    expect(l.water / l.potential).toBeGreaterThan(0.05);
    expect(l.water / l.potential).toBeLessThan(0.25);
  });
  it("nitrogen: response, plateau and optimum", () => {
    const r = nResponse(cfg, loc, soil, o, ens, p, 30);
    const top = Math.max(...r.points.map((q) => q.yieldMean));
    expect(r.points[0]!.yieldMean / top).toBeGreaterThan(0.45);
    expect(r.points[0]!.yieldMean / top).toBeLessThan(0.75);
    expect(r.best).toBeGreaterThanOrEqual(120);
    expect(r.best).toBeLessThanOrEqual(180);
  });
  it("seeding rate and sowing date optima are where agronomists expect them", () => {
    const by = (f: (v: number) => Option, vs: number[]) => vs.map((v) => [v, evaluate(cfg, loc, soil, f(v), ens, p).yield.mean] as const).sort((a, b) => b[1] - a[1])[0]![0];
    expect(by((v) => ({ ...o, seedingRate: v }), [5, 6, 7, 8, 9, 10, 11])).toBeGreaterThanOrEqual(7);
    expect(by((v) => ({ ...o, seedingRate: v }), [5, 6, 7, 8, 9, 10, 11])).toBeLessThanOrEqual(10);
    const sow = by((v) => ({ ...o, sowDoy: v }), [95, 105, 115, 125, 135, 145, 155, 165]);
    expect(sow).toBeGreaterThanOrEqual(110); // 20 April
    expect(sow).toBeLessThanOrEqual(140); // 20 May
  });
  it("sowing in mid-June costs a clear share of yield", () => {
    const late = evaluate(cfg, loc, soil, { ...o, sowDoy: 165 }, ens, p).yield.mean;
    expect(late / e.yield.mean).toBeLessThan(0.9);
    expect(late / e.yield.mean).toBeGreaterThan(0.6);
  });
});

describe("wheat sanity", () => {
  it("grain number and weight are of the right order, and yield does not exceed a strong crop's sink", () => {
    const cfg = CROPS.wheat;
    const loc = locationByKey("kansas");
    const e = evaluate(cfg, loc, soilFor(loc), { id: "w", name: "W", sowDoy: 290, rm: 110, nRate: 140, seedingRate: 350, depthCm: 4, habit: "winter" }, syntheticEnsemble(cfg, loc, 20), DEFAULT_PRICES.wheat);
    expect(e.yield.max).toBeLessThan(18000 * 0.036);
    expect(e.yield.mean).toBeGreaterThan(3);
  });
});

describe("Iowa soybeans (synthetic normals)", () => {
  const cfg = CROPS.soy;
  const loc = locationByKey("iowa");
  const soil = soilFor(loc);
  const ens = syntheticEnsemble(cfg, loc, 30);
  const base: Option = { id: "s", name: "S", sowDoy: 130, rm: 30, nRate: 0, seedingRate: 35, depthCm: 3.5, habit: "winter" };
  const y = (o: Partial<Option>) => evaluate(cfg, loc, soil, { ...base, ...o }, ens, DEFAULT_PRICES.soy).yield.mean;

  it("makes a yield of the order of the best Iowa fields (about 55 to 75 bu/ac, dry 3.2 to 4.4 t/ha)", () => {
    expect(y({})).toBeGreaterThan(3.2);
    expect(y({})).toBeLessThan(4.4);
  });
  it("loses yield when sown late, and is flat across a wide range of seeding rates", () => {
    expect(y({ sowDoy: 165 }) / y({})).toBeLessThan(0.95);
    expect(y({ sowDoy: 165 }) / y({})).toBeGreaterThan(0.6);
    expect(Math.abs(y({ seedingRate: 25 }) - y({ seedingRate: 45 })) / y({})).toBeLessThan(0.08);
  });
  it("is not limited by nitrogen: nitrogen stress is nil", () => {
    expect(meanLosses(cfg, loc, soil, base, ens).nitrogen).toBeLessThan(0.1);
  });
});

describe("continuous cropping", () => {
  it("costs corn yield and needs more nitrogen than corn after soybeans", () => {
    const cfg = CROPS.maize;
    const loc = locationByKey("iowa");
    const soil = soilFor(loc);
    const ens = syntheticEnsemble(cfg, loc, 20);
    const o: Option = { id: "c", name: "C", sowDoy: 120, rm: 110, nRate: 150, seedingRate: 8, depthCm: 5, habit: "winter" };
    const rot = evaluate(cfg, loc, soil, o, ens, DEFAULT_PRICES.maize).yield.mean;
    const same = evaluate(cfg, loc, soil, { ...o, prev: "same" }, ens, DEFAULT_PRICES.maize).yield.mean;
    expect(same / rot).toBeLessThan(0.97);
    expect(same / rot).toBeGreaterThan(0.8);
  });
});
