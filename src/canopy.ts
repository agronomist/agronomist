/**
 * Canopy temperature relative to air, after the empirical baselines of Idso et al. (1981).
 *
 * A canopy transpiring freely runs cooler than the air by an amount that grows with the vapour pressure deficit (the lower baseline,
 * linear in VPD). A canopy that has stopped transpiring runs warmer, by a roughly constant 4 to 5 degrees for corn (the upper limit).
 * The crop water stress index (CWSI, 0 to 1) says where in between a canopy sits; here it is 1 minus the water stress factor.
 *
 * The upper limit is from corn measurements (Chavez et al., Kansas State). The lower baseline intercept and slope are
 * ORDER-OF-MAGNITUDE PLACEHOLDERS, not fitted values, and `coupling` scales the whole offset so the drought amplification of heat damage
 * lands near the 1.7 times of Lobell et al. 2011. They need a check against measured canopy temperatures.
 */
export const LOWER_INTERCEPT = 1.5; // °C
export const LOWER_SLOPE = 1.7; // °C per kPa
export const UPPER_LIMIT = 4.5; // °C
export const REFERENCE_CWSI = 0.2; // the stress level the heat threshold was set for (a typical rain-fed, mostly watered crop)

const es = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

/** Afternoon vapour pressure deficit, kPa, from daily extremes (the minimum stands in for the dew point). */
export function vpdKpa(tmax: number, tmin: number): number {
  return Math.max(0, es(tmax) - es(Math.min(tmin, tmax)));
}

/** Canopy minus air temperature, °C. */
export function canopyOffset(vpd: number, cwsi: number): number {
  const lower = LOWER_INTERCEPT - LOWER_SLOPE * vpd;
  return lower + Math.max(0, Math.min(1, cwsi)) * (UPPER_LIMIT - lower);
}

/** How much hotter (or cooler) than a crop at the reference stress the canopy is today, °C, scaled by `coupling`. */
export function relativeCanopyHeat(tmax: number, tmin: number, ws: number, coupling: number): number {
  const v = vpdKpa(tmax, tmin);
  return coupling * (canopyOffset(v, 1 - ws) - canopyOffset(v, REFERENCE_CWSI));
}
