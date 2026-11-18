import { describe, expect, it } from "vitest";
import { CROPS, findBest, runSeason, type Settings } from "../src/ui/model-run";

const wheatBase: Settings = { crop: "wheat", location: "generic", scenario: "typical", sowDoy: 290, rm: 110, nRate: 140, seedingRate: 350, depthCm: 4, habit: "winter", seed: 4 };
const maizeBase: Settings = { crop: "maize", location: "generic", scenario: "typical", sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter", seed: 4 };

describe("crop configs in the viewer", () => {
  it("both crops run a full season to maturity in a typical year", () => {
    for (const s of [maizeBase, wheatBase]) {
      const r = runSeason(s);
      expect(r.result.matured).toBe(true);
      expect(r.result.yieldTHa).toBeGreaterThan(3);
      expect(r.result.criticalPeriod.completed).toBe(true);
      expect(r.winStartDvs).toBeGreaterThan(0);
      expect(r.winStartDvs).toBeLessThan(1);
    }
  });

  it("the best choice is at least as good as the default and is reproducible", () => {
    for (const s of [maizeBase, wheatBase]) {
      const b1 = findBest(s.crop, s.scenario, s.seed, s.location);
      const b2 = findBest(s.crop, s.scenario, s.seed, s.location);
      expect(b2).toEqual(b1);
      expect(b1.yieldTHa).toBeGreaterThanOrEqual(runSeason(s).result.yieldTHa - 1e-9);
      const again = runSeason({ ...s, sowDoy: b1.sowDoy, rm: b1.rm, nRate: b1.nRate, seedingRate: b1.seedingRate, depthCm: b1.depthCm, habit: b1.habit });
      expect(again.result.yieldTHa).toBeCloseTo(b1.yieldTHa, 9);
    }
  });

  it("an early-May freeze kills early-sown winter wheat and the best choice avoids it", () => {
    const early = runSeason({ ...wheatBase, scenario: "freeze", sowDoy: 275, rm: 95 });
    expect(early.result.frostKilled).toBe(true);
    const best = findBest("wheat", "freeze", 4, "generic");
    const r = runSeason({ ...wheatBase, scenario: "freeze", sowDoy: best.sowDoy, rm: best.rm, nRate: best.nRate, habit: best.habit });
    expect(r.result.frostKilled).toBe(false);
    expect(best.yieldTHa).toBeGreaterThan(4);
  });

  it("the wheat search only offers habit-appropriate sowing dates", () => {
    const g = CROPS.wheat.grid;
    expect(Math.max(...g.sow("winter"))).toBeLessThanOrEqual(380);
    expect(Math.min(...g.sow("spring"))).toBeGreaterThanOrEqual(380);
  });

  it("the second wheat fertilizer dose lands at spring green-up for autumn sowings", () => {
    const f = CROPS.wheat.fertilizerFor(100, 290);
    expect(f[0]).toEqual({ day: 0, kgN: 30 });
    expect(f[1]!.kgN).toBeCloseTo(70, 9);
    expect(f[1]!.day).toBeGreaterThan(100);
    expect(f[1]!.day).toBeLessThan(200);
    expect(CROPS.wheat.fertilizerFor(100, 440)[1]!.day).toBeLessThanOrEqual(40);
    expect(CROPS.wheat.fertilizerFor(0, 290)).toEqual([]);
  });
});

describe("field locations", () => {
  const at = (location: string, s: Settings) => runSeason({ ...s, location });

  it("sandy soil holds less water and yields less in a dry year than silt loam", () => {
    const dry = { ...maizeBase, scenario: "dry" };
    expect(at("nebraska", dry).soil.layers[0]!.fieldCapacity).toBeLessThan(at("iowa", dry).soil.layers[0]!.fieldCapacity);
    expect(findBest("maize", "dry", 4, "nebraska").yieldTHa).toBeLessThan(findBest("maize", "dry", 4, "iowa").yieldTHa);
  });

  it("maize does not finish on the Saskatchewan prairies, and wheat does", () => {
    expect(findBest("maize", "typical", 4, "saskatchewan").yieldTHa).toBeLessThan(2.5);
    expect(findBest("wheat", "typical", 4, "saskatchewan").yieldTHa).toBeGreaterThan(3);
  });

  it("latitude reaches the model: a higher latitude has longer summer days", () => {
    const a = at("po", maizeBase).result.days.find((d) => d.doy === 172)!;
    const b = at("kansas", maizeBase).result.days.find((d) => d.doy === 172)!;
    expect(a.daylength).toBeGreaterThan(b.daylength);
  });

  it("scenarios scale the location's climate instead of replacing it", () => {
    const wetPo = at("po", { ...maizeBase, scenario: "wet" }).weather.reduce((s, w) => s + w.rain, 0);
    const dryPo = at("po", { ...maizeBase, scenario: "dry" }).weather.reduce((s, w) => s + w.rain, 0);
    expect(wetPo).toBeGreaterThan(dryPo * 2);
  });
});

describe("seeding rate and sowing depth", () => {
  const yieldAt = (s: Settings, seedingRate: number, depthCm: number) => runSeason({ ...s, seedingRate, depthCm });

  it("maize yield rises from a thin stand to a plateau, then falls when badly overcrowded", () => {
    const y = (p: number) => yieldAt({ ...maizeBase, location: "iowa" }, p, 5).result.yieldTHa;
    expect(y(6)).toBeGreaterThan(y(3));
    expect(y(8)).toBeGreaterThan(y(5));
    expect(y(8) - y(6)).toBeLessThan(y(6) - y(3));
    expect(y(16)).toBeLessThan(y(8) * 0.8);
  });

  it("a dry year on sandy ground favours a lower maize seeding rate than a wet year on deep soil", () => {
    const bestPop = (s: Settings) => {
      let best = { p: 0, y: -1 };
      for (const p of CROPS.maize.grid.pop) {
        const y = yieldAt(s, p, 5).result.yieldTHa;
        if (y > best.y + 1e-9) best = { p, y };
      }
      return best.p;
    };
    const dryPoor = bestPop({ ...maizeBase, location: "nebraska", scenario: "dry" });
    const wetDeep = bestPop({ ...maizeBase, location: "iowa", scenario: "wet", sowDoy: 100 });
    expect(dryPoor).toBeLessThanOrEqual(wetDeep);
  });

  it("deeper seed emerges later and, in a cool spring, loses plants", () => {
    const shallow = yieldAt({ ...maizeBase, location: "iowa", sowDoy: 100 }, 8, 3).result.stand!;
    const deep = yieldAt({ ...maizeBase, location: "iowa", sowDoy: 100 }, 8, 10).result.stand!;
    expect(deep.emergenceDay).toBeGreaterThan(shallow.emergenceDay);
    expect(deep.plants).toBeLessThan(shallow.plants);
  });

  it("wheat compensates for stand density: yield is flat across a wide range but thin stands lose", () => {
    const y = (p: number) => yieldAt({ ...wheatBase, location: "po" }, p, 4).result.yieldTHa;
    expect(Math.abs(y(500) - y(250)) / y(250)).toBeLessThan(0.1);
    expect(y(100)).toBeLessThan(y(250) * 0.97);
  });

  it("the best choice includes a seeding rate and depth inside the slider ranges, and reproduces its yield", () => {
    for (const s of [maizeBase, wheatBase]) {
      const cfg = CROPS[s.crop];
      const b = findBest(s.crop, s.scenario, s.seed, s.location);
      expect(b.seedingRate).toBeGreaterThanOrEqual(cfg.pop.min);
      expect(b.seedingRate).toBeLessThanOrEqual(cfg.pop.max);
      expect(b.depthCm).toBeGreaterThanOrEqual(cfg.depth.min);
      expect(b.depthCm).toBeLessThanOrEqual(cfg.depth.max);
      const r = runSeason({ ...s, sowDoy: b.sowDoy, rm: b.rm, nRate: b.nRate, seedingRate: b.seedingRate, depthCm: b.depthCm, habit: b.habit });
      expect(r.result.yieldTHa).toBeCloseTo(b.yieldTHa, 9);
    }
  });
});
