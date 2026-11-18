import { describe, expect, it } from "vitest";
import {
  loadFieldScenario,
  simulate,
  maizeDefaults,
  SoilUnavailable,
  FieldError,
  type LngLat,
  type SoilPointProfile,
} from "../../src";
import { openMeteoResponse, routedFetch, soilGridsResponse } from "./fixtures";

const field: LngLat[] = [
  [-90.0, 40.0],
  [-89.995, 40.0],
  [-89.995, 40.005],
  [-90.0, 40.005],
];
const noSleep = async () => {};
const base = { startDate: "2020-05-01", endDate: "2020-11-16", sleep: noSleep };

describe("loadFieldScenario", () => {
  it("assembles weather, soil, area and latitude, then the model runs on it with closed balances", async () => {
    const { fn, calls } = routedFetch({ weather: () => openMeteoResponse(), soil: () => soilGridsResponse() });
    const s = await loadFieldScenario(field, { ...base, fetch: fn });
    // 0.005 deg at 40 N is about 556 m x 426 m
    expect(s.areaHa).toBeGreaterThan(22);
    expect(s.areaHa).toBeLessThan(26);
    expect(s.latitude).toBeCloseTo(40.0025, 3);
    expect(s.weather.length).toBe(200);
    expect(s.soilPointsUsed).toBe(3);
    // 1 weather call + 3 soil calls
    expect(calls.filter((u) => u.includes("open-meteo")).length).toBe(1);
    expect(calls.filter((u) => u.includes("isric")).length).toBe(3);

    const r = simulate({
      weather: s.weather,
      crop: maizeDefaults,
      soil: s.soil,
      latitude: s.latitude,
      fertilizer: [{ day: 0, kgN: 60 }, { day: 40, kgN: 90 }],
    });
    expect(r.matured).toBe(true);
    expect(r.yieldTHa).toBeGreaterThan(1);
    expect(r.yieldTHa).toBeLessThan(18);
    const b = r.balance;
    expect(b.rain - b.transpiration - b.soilEvap - b.drainage).toBeCloseTo(b.storageChange, 6);
    const n = r.nitrogen!;
    const last = r.days[r.days.length - 1]!;
    const minN0 = s.soil.layers.reduce((a, l) => a + (l.mineralN ?? 0), 0);
    expect(minN0 + n.fertilizer + n.mineralized).toBeCloseTo(last.minN + n.uptake + n.leached, 6);
  });

  it("degrades gracefully when some soil points fail", async () => {
    let n = 0;
    const { fn } = routedFetch({
      weather: () => openMeteoResponse(),
      soil: () => (++n === 2 ? new Error("fail") : soilGridsResponse()),
    });
    const s = await loadFieldScenario(field, { ...base, fetch: fn, retries: 0 });
    expect(s.soilPointsUsed).toBe(2);
    expect(s.warnings.join(" ")).toMatch(/1 of 3/);
  });

  it("throws SoilUnavailable when every soil point fails, so the UI can offer a preset soil", async () => {
    const { fn } = routedFetch({ weather: () => openMeteoResponse(), soil: () => new Error("down") });
    await expect(loadFieldScenario(field, { ...base, fetch: fn, retries: 0 })).rejects.toBeInstanceOf(SoilUnavailable);
  });

  it("treats null soil values (e.g. water or masked areas) as unavailable", async () => {
    const { fn } = routedFetch({ weather: () => openMeteoResponse(), soil: () => soilGridsResponse({ nullDepth: "0-5cm" }) });
    await expect(loadFieldScenario(field, { ...base, fetch: fn, retries: 0 })).rejects.toBeInstanceOf(SoilUnavailable);
  });

  it("uses the cache so repeated loads of the same field make no new SoilGrids calls", async () => {
    const cache = new Map<string, SoilPointProfile>();
    const first = routedFetch({ weather: () => openMeteoResponse(), soil: () => soilGridsResponse() });
    await loadFieldScenario(field, { ...base, fetch: first.fn, soilCache: cache });
    const second = routedFetch({ weather: () => openMeteoResponse(), soil: () => soilGridsResponse() });
    await loadFieldScenario(field, { ...base, fetch: second.fn, soilCache: cache });
    expect(second.calls.filter((u) => u.includes("isric")).length).toBe(0);
  });

  it("rejects invalid drawings before any network call", async () => {
    const { fn, calls } = routedFetch({ weather: () => openMeteoResponse(), soil: () => soilGridsResponse() });
    await expect(loadFieldScenario([[0, 0], [1, 1]], { ...base, fetch: fn })).rejects.toBeInstanceOf(FieldError);
    expect(calls).toHaveLength(0);
  });

  it("warns for fields smaller than the data resolution", async () => {
    const tiny: LngLat[] = [[-90, 40], [-89.9993, 40], [-89.9993, 40.0007], [-90, 40.0007]];
    const { fn } = routedFetch({ weather: () => openMeteoResponse(), soil: () => soilGridsResponse() });
    const s = await loadFieldScenario(tiny, { ...base, fetch: fn });
    expect(s.warnings.join(" ")).toMatch(/small/i);
  });
});
