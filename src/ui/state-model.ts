import { tuning } from "./tuning";
import { IRR_FACTOR, type StateProfile } from "./states";
import type { CropKey } from "./crops";

/** Yields (t/ha dry, by season label) of one weighted point under each kind of field the state mixes. */
export interface PointRuns {
  w: number;
  /** Share of this point's crop that is irrigated. */
  irr: number;
  free: Map<number, number>;
  poor?: Map<number, number>;
  wt?: Map<number, number>;
  irrigated?: Map<number, number>;
}

export const irrShare = (crop: CropKey, irrCorn: number) => Math.min(1, irrCorn * IRR_FACTOR[crop] * tuning.irrScale);

/**
 * State-average yield per year. "points" is the weighted average of rain-fed, freely drained fields. "full" also mixes in the
 * irrigated share and, for the rain-fed rest, the poorly drained untiled share.
 */
export function stateYields(runs: PointRuns[], p: Pick<StateProfile, "untiledWet" | "shallowWT">, mode: "points" | "full"): Map<number, number> {
  const years = [...runs[0]!.free.keys()].filter((y) => runs.every((r) => r.free.has(y)));
  const wsum = runs.reduce((a, r) => a + r.w, 0);
  const out = new Map<number, number>();
  for (const y of years) {
    let v = 0;
    for (const r of runs) {
      const free = r.free.get(y)!;
      const poorV = mode === "full" && r.poor?.has(y) ? r.poor.get(y)! : free;
      const wtV = mode === "full" && r.wt?.has(y) ? r.wt.get(y)! : free;
      const wet = Math.min(0.9, p.untiledWet * tuning.wetScale);
      const wt = Math.min(0.9 - wet, p.shallowWT * tuning.wtScale);
      const rainfed = mode === "full" ? (1 - wet - wt) * free + wet * poorV + wt * wtV : free;
      const here = mode === "full" && r.irrigated?.has(y) ? (1 - r.irr) * rainfed + r.irr * r.irrigated.get(y)! : rainfed;
      v += (r.w / wsum) * here;
    }
    out.set(y, v);
  }
  return out;
}
