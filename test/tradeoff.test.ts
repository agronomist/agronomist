import { describe, expect, it } from "vitest";
import { paretoFront } from "../src/ui/tradeoff";

describe("paretoFront", () => {
  const pts = [
    { a: 10, b: 5, n: 100 },
    { a: 8, b: 6, n: 100 },
    { a: 10, b: 5, n: 150 }, // same returns, more nitrogen: dominated
    { a: 7, b: 4, n: 120 }, // worse on everything: dominated
    { a: 6, b: 6, n: 0 }, // least nitrogen: efficient
  ];
  const f = paretoFront(pts, [(p) => p.a, (p) => p.b, (p) => p.n], [true, true, false]);
  it("drops plans another plan beats on every axis or ties and beats on one", () => {
    expect(f).toEqual([pts[0], pts[1], pts[4]]);
  });
  it("keeps ties that are identical", () => {
    const same = [{ a: 1, b: 1, n: 1 }, { a: 1, b: 1, n: 1 }];
    expect(paretoFront(same, [(p) => p.a, (p) => p.b, (p) => p.n], [true, true, false])).toHaveLength(2);
  });
});
