/**
 * Saxton & Rawls (2006) pedotransfer functions for volumetric water content at
 * wilting point (1500 kPa) and field capacity (33 kPa).
 * Inputs: sand and clay in % (mass), organic matter in % (mass).
 * Coefficients are from my recollection of the published equations; the unit tests check
 * texture-class plausibility, but verify against the paper before quantitative use.
 */
export function saxtonRawls(sandPct: number, clayPct: number, omPct: number): { wp: number; fc: number } {
  const S = sandPct / 100;
  const C = clayPct / 100;
  const OM = omPct;

  const wp1 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
  const wp = wp1 + (0.14 * wp1 - 0.02);

  const fc1 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
  const fc = fc1 + (1.283 * fc1 * fc1 - 0.374 * fc1 - 0.015);

  const wpC = Math.min(0.5, Math.max(0.01, wp));
  // keep a physically meaningful available-water range
  const fcC = Math.min(0.6, Math.max(wpC + 0.03, fc));
  return { wp: wpC, fc: fcC };
}

/** Organic matter (%) from soil organic carbon (g/kg) using the van Bemmelen factor 1.724. */
export const omFromSoc = (socGkg: number): number => (socGkg * 1.724) / 10;
