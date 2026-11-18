import { describe, expect, it } from "vitest";
import { et0PenmanMonteith, fetchPowerHistory, parsePower, powerUrl } from "../src/data/power";

// FAO-56 worked example 18 (Brussels, 6 July): ET0 = 3.9 mm/day
describe("Penman-Monteith ET0", () => {
  it("reproduces the FAO-56 example", () => {
    const et = et0PenmanMonteith({ tmax: 21.5, tmin: 12.3, rs: 22.07, tdew: 12.07, u2: 2.078, lat: 50.8, elev: 100, doy: 187 });
    expect(et).toBeGreaterThan(3.7);
    expect(et).toBeLessThan(4.1);
  });
  it("is higher in dry, windy air than in humid, still air", () => {
    const base = { tmax: 30, tmin: 18, rs: 24, lat: 40, elev: 250, doy: 190 };
    expect(et0PenmanMonteith({ ...base, tdew: 8, u2: 4 })).toBeGreaterThan(et0PenmanMonteith({ ...base, tdew: 20, u2: 0.8 }));
  });
});

const response = (n: number, fill: number[] = [], tail = 0) => {
  const keys = Array.from({ length: n }, (_, i) => `2020${String(Math.floor(i / 28) + 1).padStart(2, "0")}${String((i % 28) + 1).padStart(2, "0")}`);
  const col = (f: (i: number) => number) => Object.fromEntries(keys.map((k, i) => [k, i >= n - tail ? -999 : fill.includes(i) ? -999 : f(i)]));
  return {
    geometry: { coordinates: [-86, 40, 250] },
    parameters: { ALLSKY_SFC_SW_DWN: { units: "MJ/m^2/day" } },
    properties: {
      parameter: {
        T2M_MAX: col(() => 28),
        T2M_MIN: col(() => 16),
        ALLSKY_SFC_SW_DWN: col(() => 22),
        PRECTOTCORR: col((i) => (i === 3 ? 12.5 : 0)),
        T2MDEW: col(() => 14),
        WS2M: col(() => 2.5),
      },
    },
  };
};

describe("parsePower", () => {
  it("maps the variables, adds dew point and a computed ET0", () => {
    const { times, days } = parsePower(response(10));
    expect(times[0]).toBe("2020-01-01");
    expect(days[0]).toMatchObject({ tmax: 28, tmin: 16, srad: 22, dewpoint: 14 });
    expect(days[3]!.rain).toBe(12.5);
    expect(days[0]!.et0).toBeGreaterThan(0);
  });
  it("fills a short gap and cuts the days the service has not filled yet", () => {
    const { days } = parsePower(response(12, [5], 2));
    expect(days).toHaveLength(10);
    expect(days[5]!.tmax).toBe(28);
  });
  it("converts kWh/m2 to MJ/m2 when the response says so", () => {
    const r = response(5);
    r.parameters.ALLSKY_SFC_SW_DWN.units = "kW-hr/m^2/day";
    r.properties.parameter.ALLSKY_SFC_SW_DWN = Object.fromEntries(Object.keys(r.properties.parameter.T2M_MAX).map((k) => [k, 6]));
    expect(parsePower(r).days[0]!.srad).toBeCloseTo(21.6, 6);
  });
  it("builds a URL that asks for the right things", () => {
    const u = new URL(powerUrl(40.1, -86.2, "2001-01-01", "2006-12-31"));
    expect(u.searchParams.get("start")).toBe("20010101");
    expect(u.searchParams.get("parameters")).toContain("T2MDEW");
    expect(u.searchParams.get("community")).toBe("AG");
  });
});

describe("fetchPowerHistory", () => {
  it("splits a span the service refuses as too long, and still returns the whole record", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      const u = new URL(url);
      const a = u.searchParams.get("start")!;
      const b = u.searchParams.get("end")!;
      calls.push(`${a}-${b}`);
      const years = Number(b.slice(0, 4)) - Number(a.slice(0, 4)) + 1;
      if (years > 2) return { ok: false, status: 422, json: async () => ({}) } as unknown as Response;
      const keys: string[] = [];
      const t1 = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(4, 6)) - 1, Number(b.slice(6, 8)));
      for (let t = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(4, 6)) - 1, Number(a.slice(6, 8))); t <= t1; t += 86400000) keys.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
      const col = (v: number) => Object.fromEntries(keys.map((k) => [k, v]));
      return {
        ok: true,
        status: 200,
        json: async () => ({ geometry: { coordinates: [-86, 40, 250] }, properties: { parameter: { T2M_MAX: col(25), T2M_MIN: col(12), ALLSKY_SFC_SW_DWN: col(20), PRECTOTCORR: col(1), T2MDEW: col(10), WS2M: col(2) } } }),
      } as unknown as Response;
    }) as typeof globalThis.fetch;
    const h = await fetchPowerHistory(40, -86, { fetch, retries: 0, firstYear: 2001, now: new Date("2007-03-01T00:00:00Z") });
    expect(calls.length).toBeGreaterThan(2);
    expect([...h.years.keys()].sort()).toEqual([2001, 2002, 2003, 2004, 2005, 2006]);
    expect(h.partial?.year).toBe(2007);
    expect(h.years.get(2003)![10]!.tmax).toBe(25);
  });
});
