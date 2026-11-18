/** Extraterrestrial radiation on a horizontal surface, MJ m-2 d-1 (FAO-56 eq. 21). */
export function extraterrestrial(doy: number, latDeg: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

/** Diffuse share of daily global radiation from the clearness index (Erbs et al. 1982). */
export function diffuseFraction(srad: number, doy: number, latDeg: number): number {
  const ra = extraterrestrial(doy, latDeg);
  if (ra <= 0) return 1;
  const kt = Math.max(0, Math.min(1, srad / ra));
  if (kt < 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

/** Daily diffuse fraction of a typical Corn Belt summer day (Erbs gives about 0.55 to 0.6 at the usual clearness of 0.45 to 0.55), the point at which the diffuse-light multiplier is 1. */
export const REFERENCE_DIFFUSE = 0.58;

/**
 * Multiplier on radiation use efficiency from the direct/diffuse mix. A canopy uses diffuse light more efficiently because it spreads
 * over shaded leaves instead of saturating the sunlit ones (Sinclair et al. 1992; Gu et al. 2003). `gain` is the fractional change in RUE per
 * unit of diffuse fraction; it is a PLACEHOLDER of about 0.3, and the reference makes an average day neutral so existing calibrations hold.
 */
export function diffuseRueFactor(srad: number, doy: number, latDeg: number, gain: number): number {
  if (!gain) return 1;
  return Math.max(0.5, 1 + gain * (diffuseFraction(srad, doy, latDeg) - REFERENCE_DIFFUSE));
}
