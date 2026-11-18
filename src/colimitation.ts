import type { DayOutput } from "./types";

/**
 * Water–nitrogen colimitation after Sadras (2005) and Cossani and Sadras (2018), Advances in Agronomy 150: 231 to 263,
 * using the model's daily stress scalars (1 = no stress, 0 = full stress). Limitation L = 1 - scalar, averaged over the
 * days of crop growth weighted by growth, so a stressed day counts as much as the crop was growing that day.
 *   colimitation C = 1 - |Lw - Ln|  (1 when both are equally limiting, 0 when one resource dominates)
 *   total stress T = Lw + Ln, maximum stress M = max(Lw, Ln), CT = C / T, CM = C / M
 */
export interface Colimitation {
  lw: number;
  ln: number;
  c: number;
  total: number;
  max: number;
  /** C / max stress; high when stress is low and balanced. Capped where stress is almost zero. */
  cm: number;
  /** Which resource limits more: "water", "nitrogen" or "balanced" (within 0.05). */
  dominant: "water" | "nitrogen" | "balanced";
}

export function colimitation(days: readonly Pick<DayOutput, "ws" | "nni" | "growth" | "dvs">[]): Colimitation {
  let w = 0, lw = 0, ln = 0;
  for (const d of days) {
    if (d.dvs >= 2 || d.growth <= 0) continue;
    w += d.growth;
    lw += d.growth * (1 - d.ws);
    ln += d.growth * (1 - Math.min(1, d.nni));
  }
  const Lw = w > 0 ? lw / w : 0;
  const Ln = w > 0 ? ln / w : 0;
  const c = 1 - Math.abs(Lw - Ln);
  const max = Math.max(Lw, Ln);
  return {
    lw: Lw,
    ln: Ln,
    c,
    total: Lw + Ln,
    max,
    cm: c / Math.max(max, 0.05),
    dominant: Math.abs(Lw - Ln) < 0.05 ? "balanced" : Lw > Ln ? "water" : "nitrogen",
  };
}
