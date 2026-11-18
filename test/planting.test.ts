import { describe, expect, it } from "vitest";
import { sowingDays, MAX_DELAY, OBSERVED_SOW } from "../src/ui/planting";
import type { WeatherDay } from "../src/index";

const season = (rain: number, t: number): WeatherDay[] =>
  Array.from({ length: 200 }, (_, i) => ({ doy: 60 + i, tmax: t + 5, tmin: t - 5, srad: 15, rain }));
const seasons = (n: number) => Array.from({ length: n }, (_, i) => ({ label: 1990 + i, weather: season(2, 12) }));

describe("sowingDays", () => {
  it("gives the median season the default date", () => {
    const s = seasons(21);
    expect(sowingDays("maize", "Iowa", s, 60, 120).get(1995)!.doy).toBe(120);
  });
  it("delays a wet, cold spring and advances a dry, warm one, within limits", () => {
    const s = seasons(21);
    s[3] = { label: 1993, weather: season(8, 8) };
    s[4] = { label: 1994, weather: season(0, 15) };
    const m = sowingDays("maize", "Iowa", s, 60, 120);
    expect(m.get(1993)!.doy).toBeGreaterThan(125);
    expect(m.get(1993)!.doy).toBeLessThanOrEqual(120 + MAX_DELAY);
    expect(m.get(1994)!.doy).toBeLessThan(120);
    expect(m.get(1994)!.doy).toBeGreaterThanOrEqual(113);
  });
  it("leaves wheat and short records fixed, and prefers observed dates", () => {
    expect(sowingDays("wheat", "Kansas", seasons(21), 60, 290).get(1990)).toEqual({ doy: 290, source: "fixed" });
    expect(sowingDays("maize", "Iowa", seasons(5), 60, 120).get(1990)!.source).toBe("fixed");
    OBSERVED_SOW.Iowa = { maize: { 1990: 131 } };
    expect(sowingDays("maize", "Iowa", seasons(21), 60, 120).get(1990)).toEqual({ doy: 131, source: "observed" });
    delete OBSERVED_SOW.Iowa;
  });
});
