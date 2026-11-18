import type { CropParams } from "./types";

/**
 * Soybean parameters. Same engine as maize and wheat with a different life: a short-day plant, seed number
 * set over a long window from first flower (R1) through pod set and early seed fill, nitrogen from
 * fixation, and partitioning that keeps making leaf and stem well into reproduction.
 * Fitted to Iowa-level yields in test/calibration.test.ts; other values are textbook order.
 */
export const soybeanDefaults: CropParams = {
  tBase: 8,
  tCeil: 30,
  ttEmergence: 90,
  ttSilking: 620, // emergence to first flower (R1)
  ttMaturity: 700, // R1 to physiological maturity (R7)
  photoperiodCritical: 12.5,
  photoperiodSensitivity: 0.05,
  photoperiodMinFactor: 0.5,

  k: 0.7,
  sla: 0.022,
  rue: 2.3,
  diffuseGain: 0.3, // PLACEHOLDER, see radiation.ts
  parFraction: 0.5,
  tempResponse: [8, 22, 31, 42],
  initialBiomass: 3,

  maintRespCoef: 0.008,
  maintRespQ10: 2,
  maintRespRefTemp: 25,

  co2AssimilationSensitivity: 0.1,
  co2TranspirationSensitivity: -0.08,

  heatThreshold: 30,
  heatDamageRate: 0.008,
  heatStorageLoss: 0.7,

  kernelWindowBefore: 60,
  kernelWindowAfter: 450, // R1 to about R5: flowers, pods and early seeds are all being set
  kernelSlope: 230,
  kernelCgrThreshold: 3,
  kernelMax: 4500,
  potentialKernelWeight: 0.15,

  frostKillTemp: -2,
  frostSeedlingDvs: 0,
  frostSafeDvs: 1.9,

  rootFraction: [
    [0, 0.35],
    [0.5, 0.2],
    [1.0, 0.12],
    [1.3, 0.08],
    [2.0, 0],
  ],
  leafFraction: [
    [0, 0.65],
    [0.5, 0.5],
    [1.0, 0.3],
    [1.3, 0.12],
    [1.6, 0],
    [2.0, 0],
  ],
  stemFraction: [
    [0, 0.35],
    [0.5, 0.5],
    [1.0, 0.6],
    [1.3, 0.38],
    [1.6, 0.25],
    [2.0, 0.15],
  ],
  storageFraction: [
    [0, 0],
    [0.5, 0],
    [1.0, 0.1],
    [1.3, 0.5],
    [1.6, 0.75],
    [2.0, 0.85],
  ],
  leafSenescenceRate: 0.0009,

  kcb: 1.1,
  depletionP: 0.5,
  rootDepthMax: 1300,
  rootDecay: 3,
  rootDepthInitial: 150,
  laiMax: 6,

  ncritA: 4.5,
  ncritB: 0.35,
  nUptakeFraction: 0.25,
  nMaxUptake: 4,
  fixesN: true,

  stand: {
    refPopulation: 30,
    refDepthCm: 3.5,
    establishment: 0.85,
    emergeTTPerCm: 14,
    emergeDaysTolerated: 14,
    emergeLossPerDay: 0.03,
    shallowDepthCm: 2.5,
    shallowDryLoss: 0.15,
    shallowExposureLoss: 0.2,
    leafAreaPerPlant: 0.28,
    popExponent: 0.25,
    crowdingExponent: 0.5,
  },
};

/** rm is the maturity group times ten (30 = MG 3.0). Later groups flower later and fill longer. */
export function soybeanCultivar(base: CropParams, rm: number): CropParams {
  const d = (rm - 30) / 10;
  return {
    ...base,
    ttSilking: base.ttSilking + 45 * d,
    ttMaturity: base.ttMaturity + 70 * d,
    photoperiodCritical: base.photoperiodCritical + 0.35 * d,
    kernelSlope: base.kernelSlope + 8 * d,
  };
}
