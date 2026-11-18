import { describe, expect, it } from "vitest";
import { componentCheck, rowOk } from "../src/ui/component-check";

describe("component check", () => {
  const rows = componentCheck();
  const by = (s: string) => rows.find((r) => r.name.startsWith(s))!;
  it("runs without a network and names a source for every row", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.source.length).toBeGreaterThan(10);
      expect(Number.isFinite(r.model)).toBe(true);
    }
  });
  it("keeps irrigated yield, biomass and light use inside the published ranges", () => {
    expect(rowOk(by("Irrigated maize yield"))).toBe(true);
    expect(rowOk(by("Aboveground biomass"))).toBe(true);
    expect(rowOk(by("Radiation use efficiency"))).toBe(true);
    expect(rowOk(by("Kernel-set threshold"))).toBe(true);
  });
  it("shows that water productivity is above the Nebraska boundary rather than hiding it", () => {
    const wp = by("Water productivity");
    expect(wp.model).toBeGreaterThan(wp.high);
    expect(wp.note).toMatch(/boundary/);
  });
});
