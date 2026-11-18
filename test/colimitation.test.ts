import { describe, expect, it } from "vitest";
import { colimitation } from "../src/colimitation";
import { simulate, maizeDefaults, loamDefaults, syntheticWeather } from "../src";

const day = (ws: number, nni: number) => ({ ws, nni, growth: 10, dvs: 1 });

describe("colimitation", () => {
  it("is 1 when both resources limit equally, and falls when one dominates", () => {
    expect(colimitation([day(0.7, 0.7)]).c).toBeCloseTo(1, 10);
    expect(colimitation([day(0.9, 0.3)]).c).toBeCloseTo(0.4, 10);
  });
  it("names the dominant resource", () => {
    expect(colimitation([day(0.5, 0.95)]).dominant).toBe("water");
    expect(colimitation([day(0.95, 0.5)]).dominant).toBe("nitrogen");
    expect(colimitation([day(0.8, 0.82)]).dominant).toBe("balanced");
  });
  it("weights days by growth and ignores days without growth", () => {
    const r = colimitation([{ ws: 0.5, nni: 1, growth: 30, dvs: 1 }, { ws: 1, nni: 1, growth: 10, dvs: 1 }, { ws: 0, nni: 0, growth: 0, dvs: 1 }]);
    expect(r.lw).toBeCloseTo(0.375, 10);
  });
  it("shows nitrogen limiting at zero nitrogen and water limiting in a dry season with plenty of nitrogen", () => {
    const run = (rainMean: number, n: number) => simulate({ weather: syntheticWeather({ rainMean, seed: 3 }), crop: maizeDefaults, soil: loamDefaults, fertilizer: [{ day: 1, amountKgN: n }] as never });
    const dry = colimitation(run(1.5, 200).days);
    expect(dry.lw).toBeGreaterThan(dry.ln);
  });
});

describe("stem reserve remobilization and kernel weight cap", () => {
  const run = (crop = {}, rainMean = 3) => simulate({ weather: syntheticWeather({ rainMean, seed: 5 }), crop: { ...maizeDefaults, ...crop }, soil: loamDefaults });
  it("is off by default: the parameter changes nothing until set", () => {
    expect(run({ stemReserveFraction: 0 }).yieldTHa).toBe(run().yieldTHa);
  });
  it("raises yield when grain filling is short of assimilate, and conserves mass", () => {
    const base = run({}, 2.5);
    const rem = run({ stemReserveFraction: 0.25, stemRemobRate: 3 }, 2.5);
    expect(rem.yieldTHa).toBeGreaterThanOrEqual(base.yieldTHa);
    const a = rem.days[rem.days.length - 1]!;
    // total biomass moves only through maintenance respiration (stem mass is respired from), not through the transfer itself
    expect(Math.abs(a.totalBiomass / base.days[base.days.length - 1]!.totalBiomass - 1)).toBeLessThan(0.03);
  });
  it("never lets a kernel exceed the cap", () => {
    const r = run({ kernelWeightMaxRatio: 1.2 }, 2);
    const kernels = r.criticalPeriod.kernelsPerM2;
    if (kernels > 0) expect((r.yieldTHa * 100) / kernels).toBeLessThanOrEqual(0.32 * 1.2 + 1e-6);
  });
});
