import type { StandParams } from "./types";

/**
 * Stand establishment and plant density. Pure functions, no state, so each piece is testable on its own.
 * All parameter values live in StandParams and are PLACEHOLDERS, not calibrated to any field data.
 */

export interface Management {
  /** Seeds sown per m2 */
  seedingRate: number;
  /** Sowing depth, cm */
  sowingDepthCm: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Thermal time from sowing to emergence for a given depth. Deeper seed has further to climb. Never below 40% of the base. */
export function emergenceThermalTime(s: StandParams, baseTT: number, depthCm: number): number {
  return Math.max(0.4 * baseTT, baseTT + s.emergeTTPerCm * (depthCm - s.refDepthCm));
}

/**
 * Relative available water (0-1) at the seed. The top layer (0-10 cm) dries first, the next layer stays wetter, so seed
 * placed deeper sits in moister soil: linear from the top layer at the surface to the second layer at 10 cm.
 */
export function seedbedRelWater(depthCm: number, topRel: number, secondRel: number): number {
  const f = clamp(depthCm / 10, 0, 1);
  return clamp(topRel + (secondRel - topRel) * f, 0, 1);
}

/**
 * Fraction of the not-yet-emerged seedlings lost today. Two causes:
 *  - a slow emergence (cold soil or deep seed) leaves seedlings exposed to rot and pests, beyond a tolerated number of days;
 *  - seed placed shallow in a drying seedbed dries out (only when the top soil is dry).
 */
export function dailyEmergenceLoss(
  s: StandParams,
  a: { depthCm: number; daysSinceSowing: number; seedbedRelWater: number },
): number {
  let loss = 0;
  if (a.daysSinceSowing > s.emergeDaysTolerated) loss += s.emergeLossPerDay;
  const shallow = shallowness(s, a.depthCm);
  if (shallow > 0 && a.seedbedRelWater < 0.4) loss += s.shallowDryLoss * shallow * (1 - a.seedbedRelWater / 0.4);
  return clamp(loss, 0, 1);
}

/** 0 at or below the shallow-depth limit's opposite end: 1 at the surface, 0 at shallowDepthCm and deeper. */
function shallowness(s: StandParams, depthCm: number): number {
  return clamp((s.shallowDepthCm - depthCm) / s.shallowDepthCm, 0, 1);
}

/**
 * Seedlings per m2 from seeds sown, the establishment fraction and the survival to emergence. Very shallow seed also
 * loses a share to exposure (birds, herbicide, poor seed-to-soil contact), up to shallowExposureLoss at the surface.
 */
export function plantsFromSeeds(s: StandParams, seedingRate: number, survival: number, depthCm: number): number {
  return seedingRate * s.establishment * (1 - s.shallowExposureLoss * shallowness(s, depthCm)) * clamp(survival, 0, 1);
}

/** Plant density relative to the density the other parameters were tuned for. */
export function relativeDensity(s: StandParams, plants: number): number {
  return plants / s.refPopulation;
}

/** Cap on leaf area index set by how much leaf each plant can carry. A sparse stand cannot fill the ground. */
export function laiCap(s: StandParams, plants: number, laiMax: number): number {
  return Math.min(laiMax, plants * s.leafAreaPerPlant);
}

/**
 * Scales for the kernel-set terms. Each plant needs a minimum growth rate to set kernels, so a crowded stand needs more
 * stand growth for the same kernels (threshold, crowdingExponent), and each plant can only carry so many (maximum,
 * popExponent). Exponents below 1 mean the crop compensates (wheat tillers), 1 and above mean it does not (maize, one ear).
 */
export function kernelSetScale(s: StandParams, plants: number): { threshold: number; max: number } {
  const d = Math.max(0.05, relativeDensity(s, plants));
  return { threshold: d ** s.crowdingExponent, max: d ** s.popExponent };
}
