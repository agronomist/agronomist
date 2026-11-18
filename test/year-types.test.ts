import { describe, expect, it } from "vitest";
import { summariseTypes, supplyDemand } from "../src/ui/year-types";
import type { DayOutput } from "../src/types";

const day = (dvs: number, ws: number) => ({ dvs, ws }) as DayOutput;
const season = (flower: number, fill: number) => [day(0.5, 1), day(0.95, flower), day(1.1, flower), day(1.5, fill), day(1.9, fill)];

describe("supplyDemand", () => {
  it("separates flowering from grain fill and ignores earlier days", () => {
    const sd = supplyDemand(season(0.4, 0.9));
    expect(sd.flowering).toBeCloseTo(0.4);
    expect(sd.fill).toBeCloseTo(0.9);
  });
  it("types seasons", () => {
    expect(supplyDemand(season(0.4, 1)).type).toBe("flowering-severe");
    expect(supplyDemand(season(0.7, 1)).type).toBe("flowering-moderate");
    expect(supplyDemand(season(0.95, 0.6)).type).toBe("late");
    expect(supplyDemand(season(0.95, 0.95)).type).toBe("none");
  });
  it("treats a season without those stages as unstressed", () => {
    expect(supplyDemand([day(0.2, 0.3)]).type).toBe("none");
  });
});

describe("summariseTypes", () => {
  it("gives shares and mean yield per type", () => {
    const items = [
      { label: 1, yieldTHa: 12, sd: supplyDemand(season(1, 1)) },
      { label: 2, yieldTHa: 10, sd: supplyDemand(season(1, 1)) },
      { label: 3, yieldTHa: 4, sd: supplyDemand(season(0.3, 1)) },
      { label: 4, yieldTHa: 8, sd: supplyDemand(season(0.7, 1)) },
    ];
    const r = summariseTypes(items);
    expect(r.find((x) => x.key === "none")).toMatchObject({ years: 2, share: 0.5, meanYield: 11 });
    expect(r.find((x) => x.key === "flowering-severe")!.labels).toEqual([3]);
    expect(r.find((x) => x.key === "late")!.years).toBe(0);
    expect(r.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });
});
