import type { SoilParams } from "../types";
import { omFromSoc, saxtonRawls } from "./pedotransfer";
import { SOIL_DEPTHS, SoilDataError, type SoilPointProfile } from "./soilgrids";

export const median = (xs: number[]): number => {
  if (xs.length === 0) throw new Error("median of empty array");
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface BuildSoilOptions {
  /** Initial plant-available water as fraction of capacity. Default 0.7. */
  initialFraction?: number;
  /** Initial mineral N per layer, kg N/ha (SoilGrids has none; default is an assumption). */
  initialMineralN?: number[];
  /** Fraction of organic N mineralized per day at 25 C. Default 1e-4 (placeholder). */
  mineralizationRate?: number;
}

/**
 * Convert one or more SoilGrids point profiles (e.g. sampled across a drawn field) into
 * model soil parameters. Properties are aggregated by median across points per depth.
 * Ignores coarse fragments; treats total N as the mineralizable pool.
 */
export function buildSoilParams(profiles: SoilPointProfile[], o: BuildSoilOptions = {}): SoilParams {
  if (profiles.length === 0) throw new SoilDataError("No soil profiles to aggregate");
  const mineral = o.initialMineralN ?? [10, 8, 6, 4, 2];

  const layers = SOIL_DEPTHS.map((label, k) => {
    const recs = profiles.map((p) => p.depths.find((d) => d.label === label)!);
    const top = recs[0]!.topCm;
    const bottom = recs[0]!.bottomCm;
    const thickness = (bottom - top) * 10; // mm

    const clay = median(recs.map((r) => r.clayPct));
    const sand = median(recs.map((r) => r.sandPct));
    const soc = median(recs.map((r) => r.socGkg));
    const nitrogen = median(recs.map((r) => r.nitrogenGkg));
    const bd = median(recs.map((r) => r.bdodKgDm3));

    const { wp, fc } = saxtonRawls(sand, clay, omFromSoc(soc));
    // kg N/ha = (g N / kg soil / 1000) * soil mass (kg/ha); mass = bd(t/m3) * thickness(mm) * 1e4
    const organicN = (nitrogen / 1000) * bd * thickness * 1e4;
    return {
      thickness,
      fieldCapacity: fc,
      wiltingPoint: wp,
      organicN,
      mineralN: mineral[k] ?? 0,
    };
  });

  return {
    layers,
    initialFraction: o.initialFraction ?? 0.7,
    mineralizationRate: o.mineralizationRate ?? 1e-4,
    mineralizationQ10: 2,
  };
}

/** USDA texture class from sand and clay percentages (silt is the rest). */
export function textureClass(sandPct: number, clayPct: number): string {
  const sand = sandPct, clay = clayPct, silt = 100 - sand - clay;
  if (silt + 1.5 * clay < 15) return "sand";
  if (silt + 2 * clay < 30) return "loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return "sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "silt loam";
  if (silt >= 80 && clay < 12) return "silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "silty clay loam";
  if (clay >= 35 && sand > 45) return "sandy clay";
  if (clay >= 40 && silt >= 40) return "silty clay";
  if (clay >= 40) return "clay";
  return "loam";
}
