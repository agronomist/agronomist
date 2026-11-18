import { describe, expect, it } from "vitest";
import { openMeteoUrl, parseOpenMeteo, fetchWeather, getJson, WeatherDataError } from "../../src";
import { openMeteoResponse } from "./fixtures";

describe("Open-Meteo URL", () => {
  it("targets the archive endpoint with the variables the model needs", () => {
    const u = new URL(openMeteoUrl(40.123456, -90.5, "2020-05-01", "2020-10-31"));
    expect(u.host).toBe("archive-api.open-meteo.com");
    expect(u.pathname).toBe("/v1/archive");
    expect(u.searchParams.get("latitude")).toBe("40.1235");
    expect(u.searchParams.get("start_date")).toBe("2020-05-01");
    const daily = u.searchParams.get("daily")!.split(",");
    for (const v of ["temperature_2m_max", "temperature_2m_min", "shortwave_radiation_sum", "precipitation_sum"]) {
      expect(daily).toContain(v);
    }
  });
});

describe("parseOpenMeteo", () => {
  it("returns model weather with day of year and sensible values", () => {
    const w = parseOpenMeteo(openMeteoResponse({ days: 10 }));
    expect(w).toHaveLength(10);
    expect(w[0]!.doy).toBe(122); // 2020-05-01 is day 122 in a leap year
    expect(w[0]!.tmax).toBeGreaterThanOrEqual(w[0]!.tmin);
    expect(w.every((d) => d.srad >= 0 && d.rain >= 0)).toBe(true);
    expect(w[0]!.et0).toBeDefined();
  });

  it("interpolates short gaps in temperature and radiation", () => {
    const w = parseOpenMeteo(openMeteoResponse({ days: 20, nullAt: { shortwave_radiation_sum: [5, 6] } }));
    const clean = parseOpenMeteo(openMeteoResponse({ days: 20 }));
    const lo = Math.min(clean[4]!.srad, clean[7]!.srad);
    const hi = Math.max(clean[4]!.srad, clean[7]!.srad);
    expect(w[5]!.srad).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(w[5]!.srad).toBeLessThanOrEqual(hi + 1e-9);
  });

  it("throws on long gaps or edge gaps", () => {
    expect(() => parseOpenMeteo(openMeteoResponse({ days: 20, nullAt: { temperature_2m_max: [3, 4, 5, 6] } }))).toThrow(WeatherDataError);
    expect(() => parseOpenMeteo(openMeteoResponse({ days: 20, nullAt: { temperature_2m_min: [0] } }))).toThrow(WeatherDataError);
  });

  it("treats missing rain as 0 and missing ET0 as undefined (model estimates it)", () => {
    const w = parseOpenMeteo(
      openMeteoResponse({ days: 10, nullAt: { precipitation_sum: [2], et0_fao_evapotranspiration: [2] } }),
    );
    expect(w[2]!.rain).toBe(0);
    expect(w[2]!.et0).toBeUndefined();
  });

  it("converts Wh/m2 radiation to MJ/m2 and rejects unknown units", () => {
    const mj = parseOpenMeteo(openMeteoResponse({ days: 5 }));
    const wh = parseOpenMeteo(openMeteoResponse({ days: 5, radUnit: "Wh/m²" }));
    expect(wh[0]!.srad).toBeCloseTo(mj[0]!.srad, 6);
    expect(() => parseOpenMeteo(openMeteoResponse({ days: 5, radUnit: "W/m²" }))).toThrow(WeatherDataError);
  });

  it("rejects malformed responses", () => {
    expect(() => parseOpenMeteo({})).toThrow(WeatherDataError);
    expect(() => parseOpenMeteo({ daily: { time: ["2020-01-01"] } })).toThrow(WeatherDataError);
  });
});

describe("HTTP retries", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });
  const noSleep = async () => {};

  it("retries on 429 and 5xx, then succeeds", async () => {
    let n = 0;
    const f = async () => (++n < 3 ? bad(n === 1 ? 429 : 503) : ok({ a: 1 }));
    expect(await getJson("u", { fetch: f, sleep: noSleep })).toEqual({ a: 1 });
    expect(n).toBe(3);
  });

  it("fails fast on other 4xx", async () => {
    let n = 0;
    const f = async () => (n++, bad(400));
    await expect(getJson("u", { fetch: f, sleep: noSleep })).rejects.toThrow("HTTP 400");
    expect(n).toBe(1);
  });

  it("gives up after the retry budget and backs off exponentially", async () => {
    const waits: number[] = [];
    const f = async () => bad(503);
    await expect(getJson("u", { fetch: f, retries: 2, sleep: async (ms) => void waits.push(ms) })).rejects.toThrow("HTTP 503");
    expect(waits).toEqual([500, 1000]);
  });

  it("retries network errors", async () => {
    let n = 0;
    const f = async () => {
      if (++n < 2) throw new Error("network");
      return ok({ b: 2 });
    };
    expect(await getJson("u", { fetch: f, sleep: noSleep })).toEqual({ b: 2 });
  });

  it("fetchWeather wires URL, fetch and parser together", async () => {
    const urls: string[] = [];
    const f = async (u: string) => (urls.push(u), ok(openMeteoResponse({ days: 12 })));
    const w = await fetchWeather(40, -90, "2020-05-01", "2020-05-12", { fetch: f });
    expect(w).toHaveLength(12);
    expect(urls[0]).toContain("archive-api.open-meteo.com");
  });
});
