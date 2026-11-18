import { describe, expect, it } from "vitest";
import { seasonalWeather, fitClimate, textureClass, parseOpenMeteo } from "../src";
import { loadPin, PinError } from "../src/ui/pin";
import { dateLabel, setCalendarShift } from "../src/ui/charts";
import { locationByKey, availableWaterMm, climateFacts } from "../src/ui/locations";
import { runSeason, findBest, type Settings } from "../src/ui/model-run";
import { soilGridsResponse } from "./data/fixtures";

/** Ten synthetic years of daily weather in the Open-Meteo archive shape, with known generator settings. */
function multiYear(opts: { tmeanAnnual: number; tmeanAmp: number; peakDoy?: number; sradMean: number; sradAmp: number; rainMean: number }, shiftBack = 0) {
  const time: string[] = [], tmax: number[] = [], tmin: number[] = [], rad: number[] = [], rain: number[] = [];
  for (let y = 2015; y <= 2024; y++) {
    const w = seasonalWeather({ startDoy: 1, days: 365, seed: y, ...opts });
    const n = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
    for (let i = 0; i < n; i++) {
      const d = w[Math.min(i, 364)]!;
      time.push(new Date(Date.UTC(y, 0, 1 + i - shiftBack)).toISOString().slice(0, 10));
      tmax.push(d.tmax); tmin.push(d.tmin); rad.push(d.srad); rain.push(Math.round(d.rain * 10) / 10);
    }
  }
  return {
    daily_units: { shortwave_radiation_sum: "MJ/m²" },
    daily: { time, temperature_2m_max: tmax, temperature_2m_min: tmin, shortwave_radiation_sum: rad, precipitation_sum: rain, et0_fao_evapotranspiration: rad.map((r) => r * 0.17) },
  };
}
const iowa = { tmeanAnnual: 9.5, tmeanAmp: 14.5, sradMean: 14.5, sradAmp: 8, rainMean: 2.6 };
const mkFetch = (weather: unknown, soil: unknown | "fail" = soilGridsResponse()) => async (url: string) => {
  if (url.includes("open-meteo")) return { ok: true, status: 200, json: async () => weather };
  if (soil === "fail") return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => soil };
};
const noSleep = async () => {};

describe("fitClimate", () => {
  it("a pin outside the Midwest is refused unless the world option is on", async () => {
    await expect(loadPin(-33.5, -61, { fetch: mkFetch(multiYear(iowa)), sleep: noSleep })).rejects.toThrow(/Midwest/);
    await expect(loadPin(48.9, -123, { fetch: mkFetch(multiYear(iowa)), sleep: noSleep })).rejects.toThrow(/Midwest/);
  });

  it("recovers the generator settings that made the record", () => {
    const f = fitClimate(parseOpenMeteo(multiYear(iowa)));
    expect(f.tmeanAnnual).toBeCloseTo(9.5, 0);
    expect(f.tmeanAmp).toBeGreaterThan(13.8);
    expect(f.tmeanAmp).toBeLessThan(15.2);
    expect(Math.abs(f.peakDoy - 200)).toBeLessThan(4);
    expect(f.sradMean).toBeCloseTo(14.5, 0);
    expect(f.sradAmp).toBeGreaterThan(7);
    expect(f.sradAmp).toBeLessThan(9);
    expect(f.rainMean).toBeGreaterThan(2.4);
    expect(f.rainMean).toBeLessThan(2.8);
  });
  it("finds a shifted temperature peak", () => {
    const f = fitClimate(parseOpenMeteo(multiYear({ ...iowa, peakDoy: 215 })));
    expect(Math.abs(f.peakDoy - 215)).toBeLessThan(4);
  });
  it("refuses a record shorter than a year", () => {
    expect(() => fitClimate(parseOpenMeteo(multiYear(iowa)).slice(0, 100))).toThrow();
  });
});

describe("textureClass", () => {
  it("names textbook soils", () => {
    expect(textureClass(90, 5)).toBe("sand");
    expect(textureClass(40, 20)).toBe("loam");
    expect(textureClass(20, 15)).toBe("silt loam");
    expect(textureClass(60, 10)).toBe("sandy loam");
    expect(textureClass(30, 33)).toBe("clay loam");
    expect(textureClass(20, 60)).toBe("clay");
  });
});

describe("loadPin", () => {
  it("builds a location with fitted climate, SoilGrids layers and its own key", async () => {
    const loc = await loadPin(42.03, -93.62, { fetch: mkFetch(multiYear(iowa)), sleep: noSleep });
    expect(loc.pin).toBe(true);
    expect(locationByKey(loc.key)).toBe(loc);
    expect(loc.climate.tmeanAnnual).toBeCloseTo(9.5, 0);
    expect(loc.soilParams?.layers.length).toBe(5);
    expect(availableWaterMm(loc)).toBeGreaterThan(80);
    expect(availableWaterMm(loc)).toBeLessThan(260);
    expect(climateFacts(loc).jul).toBeGreaterThan(22);
    expect(climateFacts(loc).jan).toBeLessThan(-2);
  });
  it("keeps the real climate and uses a generic soil when SoilGrids has nothing", async () => {
    const loc = await loadPin(42.5, -93, { fetch: mkFetch(multiYear(iowa), "fail"), sleep: noSleep, retries: 0 });
    expect(loc.soilParams).toBeUndefined();
    expect(loc.soil.texture).toBe("loam");
    expect(loc.blurb).toMatch(/generic loam/);
  });
  it("refuses a failed weather request and polar latitudes", async () => {
    const bad = async () => ({ ok: false, status: 404, json: async () => ({}) });
    await expect(loadPin(40, -90, { fetch: bad, sleep: noSleep, retries: 0 })).rejects.toBeInstanceOf(PinError);
    await expect(loadPin(-75, -60, { fetch: mkFetch(multiYear(iowa)), sleep: noSleep, world: true })).rejects.toThrow(/66/);
  });
  it("a pin matching the Iowa preset plays like the Iowa preset", async () => {
    const loc = await loadPin(42.0, -93.6, { fetch: mkFetch(multiYear(iowa), soilGridsResponse({ clay: 220, sand: 250, soc: 180, nitrogen: 180, bdod: 120 })), sleep: noSleep });
    const base: Settings = { crop: "maize", location: "iowa", scenario: "typical", sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter", seed: 4 };
    const a = runSeason(base).result.yieldTHa;
    const b = runSeason({ ...base, location: loc.key }).result.yieldTHa;
    expect(b).toBeGreaterThan(a * 0.8);
    expect(b).toBeLessThan(a * 1.2);
    const best = findBest("maize", "typical", 4, loc.key);
    const iowaBest = findBest("maize", "typical", 4, "iowa");
    expect(best.yieldTHa).toBeGreaterThan(iowaBest.yieldTHa * 0.8);
    expect(best.yieldTHa).toBeLessThan(iowaBest.yieldTHa * 1.2);
  });
});

describe("southern hemisphere pins", () => {
  // the same climate with the seasons six months apart: a southern record is the northern one moved by 182 days
  const south = () => multiYear(iowa, 182);
  it("mirrors the calendar: shifted climate fit, real month names, same season length", async () => {
    const n = await loadPin(42, -93.6, { fetch: mkFetch(multiYear(iowa)), sleep: noSleep });
    const so = await loadPin(-42, -60.6, { fetch: mkFetch(south()), sleep: noSleep, world: true });
    expect(so.calShift).toBe(182);
    expect(n.calShift).toBe(0);
    expect(so.climate.tmeanAnnual).toBeCloseTo(n.climate.tmeanAnnual, 1);
    expect(Math.abs(so.climate.peakDoy! - n.climate.peakDoy!)).toBeLessThan(5);
    const f = climateFacts(so);
    expect(f.jan).toBeGreaterThan(f.jul + 15); // southern January is the warm month
    expect(climateFacts(n).jan).toBeLessThan(climateFacts(n).jul);
    const base: Settings = { crop: "maize", location: n.key, scenario: "typical", sowDoy: 120, rm: 110, nRate: 180, seedingRate: 8, depthCm: 5, habit: "winter", seed: 4 };
    const yn = runSeason(base).result.yieldTHa;
    const ys = runSeason({ ...base, location: so.key }).result.yieldTHa;
    expect(ys).toBeGreaterThan(yn * 0.93);
    expect(ys).toBeLessThan(yn * 1.07);
  });
  it("shows southern dates for the model's calendar", () => {
    setCalendarShift(0);
    expect(dateLabel(120)).toBe("Apr 30");
    setCalendarShift(182);
    expect(dateLabel(120)).toBe("Oct 30");
    expect(dateLabel(290)).toBe("Apr 18"); // wheat sown in the model's autumn is sown in the southern autumn
    setCalendarShift(0);
  });
  it("wheat in the south still finds a winter sowing date and survives", async () => {
    const so = await loadPin(-38, -60, { fetch: mkFetch(south()), sleep: noSleep, world: true });
    const best = findBest("wheat", "typical", 4, so.key);
    expect(best.yieldTHa).toBeGreaterThan(3);
  });
});
