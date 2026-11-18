import { describe, expect, it } from "vitest";
import { buildHistory, fetchHistory, parseOpenMeteo, realDay, seasonDays, seasonLabel, seasonalWeather, sourceOf, type SeasonSpec } from "../src";
import { CROPS } from "../src/ui/crops";
import { inSeasonEnsemble, loadEnsembles, realEnsemble, syntheticEnsemble, dateOfIndex } from "../src/ui/ensemble";
import { compare, evaluate, lossesFor, meanLosses, nResponse, optimize, percentile, stats, DEFAULT_PRICES, netReturn, type Option } from "../src/ui/decision";
import { locationByKey, soilFor, LOCATIONS } from "../src/ui/locations";
import { simulateOption } from "../src/ui/model-run";

const iowa = { tmeanAnnual: 9.5, tmeanAmp: 14.5, sradMean: 14.5, sradAmp: 8, rainMean: 2.6 };

/** Daily record in the Open-Meteo shape, one synthetic year after another (leap days included), ending on `endIso`. */
function record(first: number, endIso: string, opts = iowa, nullTail = 0) {
  const time: string[] = [], tmax: (number | null)[] = [], tmin: (number | null)[] = [], rad: (number | null)[] = [], rain: number[] = [];
  const end = Date.parse(endIso);
  for (let y = first; Date.UTC(y, 0, 1) <= end; y++) {
    const w = seasonalWeather({ startDoy: 1, days: 365, seed: y, ...opts });
    const n = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
    for (let i = 0; i < n; i++) {
      const t = Date.UTC(y, 0, 1 + i);
      if (t > end) break;
      const d = w[Math.min(i, 364)]!;
      time.push(new Date(t).toISOString().slice(0, 10));
      tmax.push(d.tmax); tmin.push(d.tmin); rad.push(d.srad); rain.push(Math.round(d.rain * 10) / 10);
    }
  }
  for (let k = 0; k < nullTail; k++) {
    const i = time.length - 1 - k;
    tmax[i] = null; tmin[i] = null; rad[i] = null;
  }
  return { daily_units: { shortwave_radiation_sum: "MJ/m²" }, daily: { time, temperature_2m_max: tmax, temperature_2m_min: tmin, shortwave_radiation_sum: rad, precipitation_sum: rain, et0_fao_evapotranspiration: rad.map((r) => (r === null ? null : r * 0.17)) } };
}
/** A fetch that serves any requested date range out of one long record. */
function serve(json: ReturnType<typeof record>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const q = new URL(url).searchParams;
    const s = q.get("start_date")!, e = q.get("end_date")!;
    const t = json.daily.time;
    const a = t.findIndex((x) => x >= s);
    let b = t.length - 1;
    while (b >= 0 && t[b]! > e) b--;
    const cut = <T,>(v: T[]) => v.slice(a, b + 1);
    const daily = Object.fromEntries(Object.entries(json.daily).map(([k, v]) => [k, cut(v as unknown[])]));
    return { ok: true, status: 200, json: async () => ({ daily_units: json.daily_units, daily }) };
  };
  return { fetch, calls };
}
const now = new Date("2026-11-17T12:00:00Z"); // archive reaches 2026-11-10

describe("history", () => {
  it("drops 29 February, relabels days and sets the latest incomplete year apart", () => {
    const j = record(2018, "2021-03-15");
    const h = buildHistory(j.daily.time, parseOpenMeteo(j));
    expect([...h.years.keys()]).toEqual([2018, 2019, 2020]);
    for (const y of h.years.values()) {
      expect(y).toHaveLength(365);
      expect(y[0]!.doy).toBe(1);
      expect(y[364]!.doy).toBe(365);
    }
    expect(h.partial?.year).toBe(2021);
    expect(h.partial?.days).toHaveLength(31 + 28 + 15);
    // 2020 is a leap year: position 59 is 1 March, not 29 February
    const raw = parseOpenMeteo(j);
    const iMar1 = j.daily.time.indexOf("2020-03-01");
    expect(h.years.get(2020)![59]!.tmax).toBe(raw[iMar1]!.tmax);
  });

  it("fetches in 12-year chunks and ignores days the archive has not filled yet", async () => {
    const j = record(1991, "2026-11-10", iowa, 3);
    const { fetch, calls } = serve(j);
    const h = await fetchHistory(42, -93.6, { fetch, now, retries: 0 });
    expect(calls).toHaveLength(3);
    expect(calls.every((u) => u.includes("archive-api.open-meteo.com"))).toBe(true);
    expect(h.years.size).toBe(35); // 1991..2025
    expect(h.partial?.year).toBe(2026);
    expect(h.partial!.days.length).toBe(31 + 28 + 31 + 30 + 31 + 30 + 31 + 31 + 30 + 31 + 7 - 0 /* to 7 Nov after three empty days */);
  });
});

describe("seasons on the calendar", () => {
  const maize: SeasonSpec = { yearStart: 60, yearDays: 330, shift: 0 };
  const south: SeasonSpec = { ...maize, shift: 182 };
  const wheat: SeasonSpec = { yearStart: 200, yearDays: 600, shift: 0 };
  const j = record(1991, "2026-11-10");
  const h = buildHistory(j.daily.time, parseOpenMeteo(j));
  const src = sourceOf({ years: h.years });

  it("a northern maize season starts on 1 March of its label year and carries model days", () => {
    const w = seasonDays(maize, 2010, src)!;
    expect(w).toHaveLength(330);
    expect(w[0]!.doy).toBe(60);
    expect(w[0]!.tmax).toBe(h.years.get(2010)![59]!.tmax);
    expect(w[320]!.doy).toBe(((60 + 320 - 1) % 365) + 1);
    expect(seasonLabel(maize, 2010)).toBe(2010);
  });
  it("a southern season starts in the previous year, six months earlier on the calendar", () => {
    expect(realDay(south, 2010, 0)).toEqual({ year: 2009, idx: 59 - 182 + 365 });
    const w = seasonDays(south, 2010, src)!;
    expect(w[0]!.doy).toBe(60); // model calendar is northern
    expect(w[0]!.tmax).toBe(h.years.get(2009)![242]!.tmax);
  });
  it("a winter wheat season is labelled by its harvest year and spans two calendar years", () => {
    expect(seasonLabel(wheat, 2009)).toBe(2010);
    expect(realDay(wheat, 2010, 0)).toEqual({ year: 2009, idx: 199 });
    expect(realDay(wheat, 2010, 599)).toEqual({ year: 2011, idx: (199 + 599) % 365 });
  });
  it("returns null when a day is missing", () => {
    expect(seasonDays(maize, 1980, src)).toBeNull();
  });
  it("real ensembles only include seasons fully covered by complete years", () => {
    const m = realEnsemble(CROPS.maize, locationByKey("iowa"), h);
    expect(m.source).toBe("real");
    expect(m.years[0]!.label).toBe(1991);
    expect(m.years[m.years.length - 1]!.label).toBe(2024); // 2025's season runs into January 2026, which is not complete
    const s = realEnsemble(CROPS.maize, { ...locationByKey("iowa"), calShift: 182, lat: -33 }, h);
    expect(s.years[0]!.label).toBe(1992); // needs the previous year
  });
});

describe("in-season ensemble", () => {
  const j = record(1991, "2026-11-10");
  const h = buildHistory(j.daily.time, parseOpenMeteo(j));
  it("keeps this season's observed days and fills the rest from each past year", () => {
    const e = inSeasonEnsemble(CROPS.maize, locationByKey("iowa"), h)!;
    expect(e).not.toBeNull();
    expect(e.inSeason!.label).toBe(2026);
    expect(e.inSeason!.through).toBe("2026-11-10");
    const obs = e.inSeason!.observedDays;
    expect(obs).toBe(h.partial!.days.length - 59);
    const a = e.years.find((y) => y.label === 2003)!;
    const b = e.years.find((y) => y.label === 2012)!;
    // observed part identical in every member, equal to this year's record
    expect(a.weather[100]!.tmax).toBe(h.partial!.days[159]!.tmax);
    expect(b.weather[100]!.tmax).toBe(a.weather[100]!.tmax);
    // the remainder follows the analog year
    expect(a.weather[obs + 3]!.tmax).toBe(h.years.get(2003)![59 + obs + 3]!.tmax);
    expect(a.weather[obs + 3]!.tmax).not.toBe(b.weather[obs + 3]!.tmax);
  });
  it("wheat sown this autumn is in season in November; northern maize has finished its window only after January", () => {
    const w = inSeasonEnsemble(CROPS.wheat, locationByKey("iowa"), h)!;
    expect(w.inSeason!.label).toBe(2027);
    expect(w.years.length).toBeGreaterThan(20);
  });
  it("no partial year, no in-season ensemble", () => {
    const j2 = record(1991, "2025-12-31");
    const h2 = buildHistory(j2.daily.time, parseOpenMeteo(j2));
    expect(inSeasonEnsemble(CROPS.maize, locationByKey("iowa"), h2)).toBeNull();
  });
  it("dateOfIndex skips the leap day", () => {
    expect(dateOfIndex(2024, 59)).toBe("2024-03-01");
    expect(dateOfIndex(2025, 59)).toBe("2025-03-01");
    expect(dateOfIndex(2026, 0)).toBe("2026-01-01");
  });
});

describe("loadEnsembles", () => {
  it("builds real ensembles from a mocked archive, then caches", async () => {
    const j = record(1991, "2026-11-10");
    const { fetch, calls } = serve(j);
    const loc = { ...locationByKey("iowa"), key: "t1", lat: 41.11, lon: -93.11 };
    const r = await loadEnsembles(CROPS.maize, loc, { fetch, now, retries: 0 });
    expect(r.base.source).toBe("real");
    expect(r.base.years.length).toBeGreaterThanOrEqual(30);
    expect(r.inSeason?.inSeason?.label).toBe(2026);
    const n = calls.length;
    await loadEnsembles(CROPS.wheat, loc, { fetch, now, retries: 0 });
    expect(calls.length).toBe(n);
  });
  it("falls back to synthetic years with a reason when the archive fails", async () => {
    const loc = { ...locationByKey("iowa"), key: "t2", lat: 40.01, lon: -90.01 };
    const r = await loadEnsembles(CROPS.maize, loc, { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), retries: 0, sleep: async () => {} });
    expect(r.base.source).toBe("synthetic");
    expect(r.base.years).toHaveLength(30);
    expect(r.base.note).toMatch(/Could not load/);
    expect(r.inSeason).toBeNull();
  });
  it("the test field never asks for weather", async () => {
    let called = false;
    const r = await loadEnsembles(CROPS.maize, locationByKey("generic"), { fetch: async () => ((called = true), { ok: true, status: 200, json: async () => ({}) }) });
    expect(called).toBe(false);
    expect(r.base.source).toBe("synthetic");
  });
});

describe("statistics", () => {
  it("percentiles and summary", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.25)).toBe(2.5);
    const s = stats([5, 1, 3, 2, 4, 10, 6, 7, 8, 9]);
    expect(s.mean).toBeCloseTo(5.5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(10);
    expect(s.worst20).toBeCloseTo(1.5); // mean of the two lowest
    expect(s.p10).toBeCloseTo(1.9);
  });
  it("net return counts market-moisture revenue less nitrogen and seed", () => {
    const m = { sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter" as const };
    const p = DEFAULT_PRICES.maize;
    // 10 t/ha dry = 11.83 t at 15.5% moisture
    expect(netReturn(CROPS.maize, m, p, 10)).toBeCloseTo((10 / 0.845) * 190 - 180 * 1.1 - 8 * 10 * 3.5, 6);
  });
});

describe("evaluating options", () => {
  const cfg = CROPS.maize;
  const loc = locationByKey("iowa");
  const soil = soilFor(loc);
  const ens = syntheticEnsemble(cfg, loc, 12);
  const base: Option = { id: "a", name: "A", sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter" };
  const p = DEFAULT_PRICES.maize;

  it("runs every year and summarises", () => {
    const e = evaluate(cfg, loc, soil, base, ens, p);
    expect(e.outcomes).toHaveLength(12);
    expect(e.yield.p10).toBeLessThanOrEqual(e.yield.median);
    expect(e.yield.median).toBeLessThanOrEqual(e.yield.p90);
    expect(e.outcomes.find((o) => o.label === e.worstYear)!.yieldTHa).toBe(e.yield.min);
    expect(e.outcomes[3]!.yieldTHa).toBeCloseTo(simulateOption(cfg, loc, soil, base, ens.years[3]!.weather).yieldTHa, 12);
  });

  it("an option compared with itself differs nowhere", () => {
    const e = evaluate(cfg, loc, soil, base, ens, p);
    const c = compare(e, e);
    expect(c.meanNet).toBe(0);
    expect(c.bWins).toBe(0);
    expect(c.ties).toBe(1);
    expect(c.everyYear).toBeNull();
    expect(c.distribution).toBeNull();
  });

  it("no nitrogen is worse than the default and the comparison says so in the right direction", () => {
    const a = evaluate(cfg, loc, soil, { ...base, nRate: 0 }, ens, p);
    const b = evaluate(cfg, loc, soil, base, ens, p);
    const c = compare(a, b);
    expect(c.meanYield).toBeGreaterThan(0);
    expect(c.bWins).toBeGreaterThan(0.5);
    const rev = compare(b, a);
    expect(rev.meanNet).toBeCloseTo(-c.meanNet, 9);
    expect(rev.aWins).toBeCloseTo(c.bWins, 9);
  });

  it("nitrogen response rises then flattens, and the best rate sits inside its own range", () => {
    const r = nResponse(cfg, loc, soil, base, ens, p, 40);
    expect(r.points[0]!.n).toBe(0);
    expect(r.points[1]!.yieldMean).toBeGreaterThan(r.points[0]!.yieldMean);
    expect(r.best).toBeGreaterThan(0);
    expect(r.range[0]).toBeLessThanOrEqual(r.best);
    expect(r.range[1]).toBeGreaterThanOrEqual(r.best);
    const top = Math.max(...r.points.map((q) => q.netMean));
    expect(r.points.find((q) => q.n === r.best)!.netMean).toBe(top);
  });

  it("loss breakdown adds up and every part is a loss", () => {
    for (const k of [0, 5, 9]) {
      const l = lossesFor(cfg, loc, soil, base, ens.years[k]!.weather);
      expect(l.potential - l.frost - l.water - l.heat - l.nitrogen).toBeCloseTo(l.actual, 9);
      expect(l.actual).toBeCloseTo(simulateOption(cfg, loc, soil, base, ens.years[k]!.weather).yieldTHa, 12);
      // a well-watered crop can come out a few percent lower than a stressed one (more living biomass to respire), so small negative parts occur
      expect(l.potential).toBeGreaterThanOrEqual(l.actual - 0.8);
      for (const part of [l.frost, l.water, l.heat, l.nitrogen]) expect(part).toBeGreaterThan(-0.8);
    }
    const m = meanLosses(cfg, loc, soil, { ...base, nRate: 0 }, ens);
    const m2 = meanLosses(cfg, loc, soil, base, ens);
    expect(m.nitrogen).toBeGreaterThan(m2.nitrogen);
  });

  it("the search finds a plan at least as good as the start, for both objectives", async () => {
    for (const objective of ["mean", "cautious"] as const) {
      const start: Option = { ...base, sowDoy: 160, rm: 95, nRate: 0, seedingRate: 5 };
      const m = await optimize(cfg, loc, soil, start, ens, p, objective, { pause: async () => {} });
      const a = evaluate(cfg, loc, soil, start, ens, p);
      const b = evaluate(cfg, loc, soil, { ...start, ...m }, ens, p);
      expect(objective === "mean" ? b.net.mean : b.net.worst20).toBeGreaterThan(objective === "mean" ? a.net.mean : a.net.worst20);
      expect(m.nRate).toBeGreaterThan(0);
    }
  });

  it("wheat searches both habits", async () => {
    const wcfg = CROPS.wheat;
    const wens = syntheticEnsemble(wcfg, locationByKey("kansas"), 8);
    const start: Option = { id: "w", name: "W", sowDoy: 290, rm: 110, nRate: 60, seedingRate: 350, depthCm: 4, habit: "winter" };
    const m = await optimize(wcfg, locationByKey("kansas"), soilFor(locationByKey("kansas")), start, wens, DEFAULT_PRICES.wheat, "mean", { pause: async () => {} });
    expect(["winter", "spring"]).toContain(m.habit);
    expect(wcfg.grid.sow(m.habit)).toContain(m.sowDoy);
  });
});

describe("locations", () => {
  it("only the test field is synthetic", () => {
    expect(LOCATIONS.filter((l) => l.synthetic).map((l) => l.key)).toEqual(["generic"]);
  });
});
