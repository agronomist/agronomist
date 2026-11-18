import { describe, expect, it } from "vitest";
import { buildHistory } from "../src/data/history";
import { buildSnapshot, loadSnapshot } from "../src/ui/snapshot";
import { fetchedHistories, seedHistory } from "../src/ui/ensemble";

const day = (i: number) => ({ doy: i + 1, tmax: 25 + (i % 7) * 0.13, tmin: 12.04, srad: 18.26, rain: i % 5 === 0 ? 3.37 : 0, dewpoint: 10.2 });

describe("snapshot", () => {
  it("round-trips a weather record to one decimal", async () => {
    const times = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2001, 0, 1 + i)).toISOString().slice(0, 10));
    seedHistory(41.5, -93.5, buildHistory(times, times.map((_, i) => day(i))));
    const snap = await buildSnapshot();
    const copy = JSON.parse(JSON.stringify(snap));
    seedHistory(41.5, -93.5, { years: new Map() });
    expect(loadSnapshot(copy).weather).toBeGreaterThan(0);
    const h = (await fetchedHistories()).get("41.50,-93.50")!;
    const d = h.years.get(2001)![10]!;
    expect(d.doy).toBe(11);
    expect(Math.abs(d.tmax - day(10).tmax)).toBeLessThan(0.051);
    expect(d.dewpoint).toBeCloseTo(10.2, 1);
    expect(d.et0).toBeUndefined();
  });
});
