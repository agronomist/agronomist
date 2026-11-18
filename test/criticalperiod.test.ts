import { describe, expect, it } from "vitest";
import {
  analyzeTimings,
  bestTiming,
  hybrid,
  loamWithN,
  maizeDefaults,
  seasonalWeather,
  simulate,
  windowConditions,
  type SeasonalOptions,
  type WeatherDay,
} from "../src";

const fert = [{ day: 0, kgN: 80 }, { day: 40, kgN: 100 }];
const sim = (weather: WeatherDay[], crop = maizeDefaults) =>
  simulate({ weather, crop, soil: loamWithN, latitude: 40, fertilizer: fert });
const season = (o: SeasonalOptions = {}) => seasonalWeather({ seed: 4, ...o });
/** Weather starting at a given day of year (sowing day). */
const sowAt = (doy: number, o: SeasonalOptions = {}) => season({ startDoy: doy, days: 280 - (doy - 90), ...o });

describe("critical window and kernel number", () => {
  const r = sim(sowAt(120));
  const cp = r.criticalPeriod;

  it("brackets silking, lasts about a month, and is reported as completed", () => {
    const silk = r.days.find((d) => d.dvs >= 1)!;
    expect(cp.completed).toBe(true);
    expect(cp.startDay).toBeLessThan(silk.day);
    expect(cp.endDay).toBeGreaterThan(silk.day);
    expect(cp.days).toBeGreaterThan(18);
    expect(cp.days).toBeLessThan(40);
    expect(r.days.filter((d) => d.inWindow).length).toBe(cp.days);
  });

  it("fixes kernel number when the window closes, and it stays constant afterwards", () => {
    // kernel number is fixed at the end of the window's last day, so that day's row already shows it
    const after = r.days.filter((d) => d.day >= cp.endDay);
    expect(after.every((d) => d.kernels === after[0]!.kernels)).toBe(true);
    expect(after[0]!.kernels).toBeCloseTo(cp.kernelsPerM2, 6);
    expect(r.days.filter((d) => d.day < cp.endDay).every((d) => d.kernels === 0)).toBe(true);
    expect(cp.kernelsPerM2).toBeGreaterThan(500);
    expect(cp.kernelsPerM2).toBeLessThanOrEqual(maizeDefaults.kernelMax);
  });

  it("caps grain filling at kernels x potential weight (sink limitation)", () => {
    const closeDay = r.days.find((d) => d.kernels > 0)!;
    const final = r.days[r.days.length - 1]!;
    const cap = closeDay.storage + cp.kernelsPerM2 * maizeDefaults.potentialKernelWeight;
    expect(final.storage).toBeLessThanOrEqual(cap + 1e-6);
  });

  it("keeps the biomass balance exact even when the sink cap diverts assimilate to stem", () => {
    const tiny = { ...maizeDefaults, potentialKernelWeight: 0.05 }; // sink is the bottleneck
    const r2 = sim(sowAt(120), tiny);
    const last = r2.days[r2.days.length - 1]!;
    expect(last.totalBiomass).toBeCloseTo(maizeDefaults.initialBiomass + r2.cumulativeGrowth, 6);
    expect(r2.yieldTHa).toBeLessThan(r.yieldTHa);
  });
});

describe("where the window falls matters", () => {
  const base = sim(sowAt(120));
  const { startDoy, endDoy } = base.criticalPeriod;
  const len = endDoy - startDoy + 1;

  it("drought inside the window cuts kernel number and yield more than the same drought right after it", () => {
    const inside = sim(sowAt(120, { drySpell: { startDoy, endDoy } }));
    const after = sim(sowAt(120, { drySpell: { startDoy: endDoy + 1, endDoy: endDoy + len } }));
    expect(inside.criticalPeriod.kernelsPerM2).toBeLessThan(base.criticalPeriod.kernelsPerM2);
    expect(inside.criticalPeriod.meanWs).toBeLessThan(after.criticalPeriod.meanWs);
    expect(inside.yieldTHa).toBeLessThan(after.yieldTHa);
  });

  it("heat inside the window damages kernel set; the same heat during late grain filling does not", () => {
    const hot = sim(sowAt(120, { heatWave: { startDoy, endDoy: startDoy + 12, addC: 10 } }));
    const late = sim(sowAt(120, { heatWave: { startDoy: endDoy + 30, endDoy: endDoy + 42, addC: 10 } }));
    expect(hot.criticalPeriod.hotDays).toBeGreaterThan(0);
    expect(hot.criticalPeriod.heatSetFactor).toBeLessThan(1);
    // heat after the window closes changes nothing about the window itself
    expect(late.criticalPeriod.hotDays).toBe(base.criticalPeriod.hotDays);
    expect(late.criticalPeriod.heatSetFactor).toBeCloseTo(base.criticalPeriod.heatSetFactor, 10);
    expect(hot.yieldTHa).toBeLessThan(late.yieldTHa);
  });

  it("severe stress across the whole window gives near-barren plants", () => {
    const barren = sim(sowAt(120, { drySpell: { startDoy: startDoy - 15, endDoy: endDoy + 5 }, heatWave: { startDoy, endDoy, addC: 9 } }));
    expect(barren.yieldTHa).toBeLessThan(base.yieldTHa * 0.35);
  });
});

describe("frost", () => {
  it("kills a long hybrid sown late, but not an early-sown short one", () => {
    const late = sim(sowAt(180), hybrid(maizeDefaults, 125));
    const early = sim(sowAt(95), hybrid(maizeDefaults, 95));
    expect(late.frostKilled).toBe(true);
    expect(late.matured).toBe(false);
    expect(early.frostKilled).toBe(false);
    expect(early.matured).toBe(true);
  });

  it("is harmless to seedlings and after black layer, but ends the crop around silking", () => {
    const w = sowAt(120);
    const base = sim(w);
    const idx = (pred: (d: (typeof base.days)[number]) => boolean) => base.days.findIndex(pred);
    const frostOn = (i: number) => w.map((d, k) => (k === i ? { ...d, tmin: -6 } : d));

    const seedling = sim(frostOn(idx((d) => d.dvs >= 0 && d.dvs < 0.1)));
    expect(seedling.frostKilled).toBe(false);

    const late = sim(frostOn(idx((d) => d.dvs >= 1.92)));
    expect(late.frostKilled).toBe(false);
    expect(late.matured).toBe(true);
    expect(late.yieldTHa).toBeGreaterThan(base.yieldTHa * 0.9);

    const atSilking = sim(frostOn(idx((d) => d.dvs >= 1)));
    expect(atSilking.frostKilled).toBe(true);
    expect(atSilking.yieldTHa).toBeLessThan(base.yieldTHa * 0.5);
  });
});

describe("hybrids", () => {
  it("rm 110 is the base; longer hybrids need more thermal time and have higher potential", () => {
    expect(hybrid(maizeDefaults, 110)).toEqual(maizeDefaults);
    const long = hybrid(maizeDefaults, 125);
    expect(long.ttSilking).toBeGreaterThan(maizeDefaults.ttSilking);
    expect(long.ttMaturity).toBeGreaterThan(maizeDefaults.ttMaturity);
    expect(long.kernelMax).toBeGreaterThan(maizeDefaults.kernelMax);
  });
});

describe("timing analysis", () => {
  const offsets = [0, 15, 30, 45, 60, 75, 90];
  const rms = [95, 110, 125];
  const run = (o: SeasonalOptions) =>
    analyzeTimings({
      weather: season(o),
      crop: maizeDefaults,
      soil: loamWithN,
      latitude: 40,
      fertilizer: fert,
      sowingOffsets: offsets,
      rms,
    });
  const hazard: SeasonalOptions = {
    heatWave: { startDoy: 185, endDoy: 215, addC: 9 },
    drySpell: { startDoy: 175, endDoy: 225 },
  };
  const calm = run({});
  const hit = run(hazard);

  it("longest hybrid is not always best: it wins sown early but is frost-killed sown late", () => {
    const y = (rows: typeof calm, off: number, rm: number) => rows.find((r) => r.sowingOffset === off && r.rm === rm)!;
    // some longer hybrid beats the shortest one when sown early (the very longest may already be limited by the season)
    const longer = calm.filter((r) => r.sowingOffset === 0 && r.rm > 95).map((r) => r.yieldTHa);
    expect(Math.max(...longer)).toBeGreaterThan(y(calm, 0, 95).yieldTHa);
    expect(y(calm, 90, 125).frostKilled).toBe(true);
    expect(y(calm, 90, 125).yieldTHa).toBeLessThan(y(calm, 90, 95).yieldTHa);
  });

  it("with a July heat and dry spell, the best choice puts the window outside the hazard", () => {
    const best = bestTiming(hit);
    const worst = hit.reduce((a, b) => (b.yieldTHa < a.yieldTHa ? b : a));
    expect(best.yieldTHa).toBeGreaterThan(worst.yieldTHa * 3);
    expect(best.window.hotDays).toBeLessThan(worst.window.hotDays);
    expect(best.window.meanWs).toBeGreaterThan(worst.window.meanWs);
    expect(best.conditions.score).toBeGreaterThan(worst.conditions.score);
  });

  it("window-condition score tracks yield across all choices, except where frost, not the window, limits it", () => {
    const rows = hit.filter((r) => !r.frostKilled && r.matured);
    const xs = rows.map((r) => r.conditions.score);
    const ys = rows.map((r) => r.yieldTHa);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs);
    const my = mean(ys);
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
    const r = cov / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
    expect(r).toBeGreaterThan(0.6);
  });

  it("a hazard makes the choice of sowing date matter far more than in a calm year", () => {
    const spread = (rows: typeof calm) => {
      const per = offsets.map((off) => Math.max(...rows.filter((r) => r.sowingOffset === off).map((r) => r.yieldTHa)));
      return Math.max(...per) - Math.min(...per.slice(0, 5));
    };
    expect(spread(hit)).toBeGreaterThan(spread(calm));
  });
});

describe("windowConditions", () => {
  it("returns components in [0,1], zeros if the window was never entered, and falls under drought", () => {
    const good = sim(sowAt(120)).criticalPeriod;
    const dry = sim(sowAt(120, { drySpell: { startDoy: good.startDoy, endDoy: good.endDoy } })).criticalPeriod;
    const cg = windowConditions(good, maizeDefaults);
    const cd = windowConditions(dry, maizeDefaults);
    for (const v of Object.values(cg)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(cd.water).toBeLessThan(cg.water);
    expect(cd.score).toBeLessThan(cg.score);
    expect(windowConditions({ ...good, days: 0 }, maizeDefaults).score).toBe(0);
  });
});

describe("seasonal weather generator", () => {
  it("is deterministic, has autumn frost and no summer frost", () => {
    const a = season();
    expect(a).toEqual(season());
    expect(a.some((d) => d.doy > 280 && d.tmin <= -2)).toBe(true);
    expect(a.some((d) => d.doy > 150 && d.doy < 260 && d.tmin <= 0)).toBe(false);
  });
  it("hazards change only their own days", () => {
    const base = season();
    const hw = season({ heatWave: { startDoy: 185, endDoy: 190, addC: 9 } });
    const ds = season({ drySpell: { startDoy: 175, endDoy: 225 } });
    base.forEach((d, i) => {
      if (d.doy >= 185 && d.doy <= 190) expect(hw[i]!.tmax).toBeCloseTo(d.tmax + 9, 9);
      else expect(hw[i]).toEqual(d);
      expect(ds[i]!.tmax).toBe(d.tmax);
      if (d.doy < 175 || d.doy > 225) expect(ds[i]!.rain).toBe(d.rain);
      else expect(ds[i]!.rain).toBe(0);
    });
  });
});

describe("canopy cap and rooting", () => {
  it("never exceeds the maximum leaf area index and still conserves biomass", () => {
    const r = sim(sowAt(120));
    expect(Math.max(...r.days.map((d) => d.lai))).toBeLessThanOrEqual(maizeDefaults.laiMax + 1e-9);
    const last = r.days[r.days.length - 1]!;
    expect(last.totalBiomass).toBeCloseTo(maizeDefaults.initialBiomass + r.cumulativeGrowth, 6);
    // with a very low cap the surplus must show up in the stem, not vanish
    const capped = sim(sowAt(120), { ...maizeDefaults, laiMax: 2 });
    expect(Math.max(...capped.days.map((d) => d.lai))).toBeLessThanOrEqual(2 + 1e-9);
    const lc = capped.days[capped.days.length - 1]!;
    expect(lc.totalBiomass).toBeCloseTo(maizeDefaults.initialBiomass + capped.cumulativeGrowth, 6);
    expect(lc.stem).toBeGreaterThan(last.stem * 0.9);
  });

  it("seedlings are not water-stressed to zero by a thin starting root zone", () => {
    const r = sim(sowAt(120));
    const early = r.days.filter((d) => d.dvs >= 0 && d.dvs < 0.3);
    expect(Math.min(...early.map((d) => d.ws))).toBeGreaterThan(0.3);
  });
});
