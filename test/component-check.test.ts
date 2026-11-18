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
  it("shows both readings of water productivity: above the Nebraska boundary per mm of rain and irrigation, inside it per mm used", () => {
    const supply = by("Water productivity of irrigated maize, per mm of rain");
    const used = by("Water productivity of irrigated maize, per mm of water used");
    expect(supply.model).toBeGreaterThan(supply.high);
    expect(rowOk(used)).toBe(true);
    expect(supply.note).toMatch(/boundary/);
  });
});
