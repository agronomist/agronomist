import { IRR_FACTOR, type StateProfile } from "./states";
import type { CropKey } from "./crops";

/** Yields (t/ha dry, by season label) of one weighted point under each kind of field the state mixes. */
export interface PointRuns {
  w: number;
  /** Share of this point's crop that is irrigated. */
  irr: number;
  free: Map<number, number>;
  poor?: Map<number, number>;
  irrigated?: Map<number, number>;
}

export const irrShare = (crop: CropKey, irrCorn: number) => Math.min(1, irrCorn * IRR_FACTOR[crop]);

/**
 * State-average yield per year. "points" is the weighted average of rain-fed, freely drained fields. "full" also mixes in the
 * irrigated share and, for the rain-fed rest, the poorly drained untiled share.
 */
export function stateYields(runs: PointRuns[], p: Pick<StateProfile, "untiledWet">, mode: "points" | "full"): Map<number, number> {
  const years = [...runs[0]!.free.keys()].filter((y) => runs.every((r) => r.free.has(y)));
  const wsum = runs.reduce((a, r) => a + r.w, 0);
  const out = new Map<number, number>();
  for (const y of years) {
    let v = 0;
    for (const r of runs) {
      const free = r.free.get(y)!;
      const rainfed = mode === "full" && r.poor?.has(y) ? (1 - p.untiledWet) * free + p.untiledWet * r.poor.get(y)! : free;
      const here = mode === "full" && r.irrigated?.has(y) ? (1 - r.irr) * rainfed + r.irr * r.irrigated.get(y)! : rainfed;
      v += (r.w / wsum) * here;
    }
    out.set(y, v);
  }
  return out;
}
