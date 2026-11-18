import { describe, expect, it } from "vitest";
import { agreement, parseDssatTable } from "../src/compare";

const sample = `*GROWTH ASPECTS OUTPUT FILE
@YEAR DOY   DAS   LAID   CWAD
 2020 150     1    0.1     10
 2020 151     2    0.2     15
`;

describe("DSSAT table parser", () => {
  it("reads columns and rows", () => {
    const t = parseDssatTable(sample);
    expect(t.LAID).toEqual([0.1, 0.2]);
    expect(t.CWAD).toEqual([10, 15]);
  });
});

describe("agreement statistics", () => {
  it("perfect match gives rmse 0 and d 1", () => {
    const a = agreement([1, 2, 3], [1, 2, 3]);
    expect(a.rmse).toBe(0);
    expect(a.d).toBe(1);
  });
  it("reports bias sign", () => {
    expect(agreement([1, 2, 3], [2, 3, 4]).bias).toBeCloseTo(1);
  });
});
