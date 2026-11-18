import type { CropParams, SoilParams } from "./types";

/**
 * PLACEHOLDER maize parameters: generic, textbook-order values chosen so the
 * model behaves sensibly. They are NOT calibrated to any cultivar or site and
 * must be fitted to field data before any quantitative use.
 */
export const maizeDefaults: CropParams = {
  tBase: 8,
  tCeil: 30,
  ttEmergence: 80,
  ttSilking: 800,
  ttMaturity: 700,
  photoperiodCritical: 12.5,
  photoperiodSensitivity: 0.1,
  photoperiodMinFactor: 0.4,

  k: 0.65,
  sla: 0.018,
  rue: 4.0, // gross; maintenance respiration is now explicit
  parFraction: 0.5,
  tempResponse: [8, 18, 30, 42],
  initialBiomass: 6,

  maintRespCoef: 0.008,
  maintRespQ10: 2,
  maintRespRefTemp: 25,

  co2AssimilationSensitivity: 0.03, // placeholder
  co2TranspirationSensitivity: -0.05, // placeholder

  heatThreshold: 30,
  heatDamageRate: 0.008,
  heatStorageLoss: 0.7,

  kernelWindowBefore: 200, // about 2 weeks before silking in warm weather
  kernelWindowAfter: 150, // about 10 days after
  kernelSlope: 408, // initial slope of the saturating curve, set so the median Iowa year keeps its kernel number (see test/calibration.test.ts)
  kernelCgrThreshold: 7.5, // g m-2 d-1 at the reference density of 7.5 plants m-2, i.e. 1 g per plant per day (Andrade et al. 1999: threshold for kernel set about 1 g d-1)
  kernelMax: 4500,
  kernelAsymptote: 5000, // PLACEHOLDER ceiling of the curve, about 670 kernels per plant at 7.5 plants m-2
  potentialKernelWeight: 0.32,

  frostKillTemp: -2,
  frostSeedlingDvs: 0.15,
  frostSafeDvs: 1.9,

  // Shoot partitioning tables share breakpoints so fractions sum to 1.
  rootFraction: [
    [0, 0.4],
    [0.5, 0.2],
    [1.0, 0.1],
    [1.3, 0.05],
    [2.0, 0],
  ],
  leafFraction: [
    [0, 0.7],
    [0.5, 0.55],
    [1.0, 0.15],
    [1.2, 0],
    [2.0, 0],
  ],
  stemFraction: [
    [0, 0.3],
    [0.5, 0.45],
    [1.0, 0.25],
    [1.2, 0.1],
    [2.0, 0],
  ],
  storageFraction: [
    [0, 0],
    [0.5, 0],
    [1.0, 0.6],
    [1.2, 0.9],
    [2.0, 1],
  ],
  leafSenescenceRate: 0.0007,

  kcb: 1.15,
  depletionP: 0.55,
  rootDepthMax: 1500, // the soil has a deep layer below the mapped metre (see soilFor)
  rootDecay: 3,
  rootDepthInitial: 250,
  laiMax: 6,

  ncritA: 3.4,
  ncritB: 0.37,
  nUptakeFraction: 0.25,
  nMaxUptake: 5,

  // Stand establishment (PLACEHOLDERS): about 7.5 plants m-2 (75 000 ha-1) and 5 cm depth are the reference
  stand: {
    refPopulation: 7.5,
    refDepthCm: 5,
    establishment: 0.93,
    emergeTTPerCm: 12,
    emergeDaysTolerated: 14,
    emergeLossPerDay: 0.03,
    shallowDepthCm: 5,
    shallowDryLoss: 0.15,
    shallowExposureLoss: 0.3,
    leafAreaPerPlant: 0.85,
    popExponent: 1,
    crowdingExponent: 2,
  },
};

export const loamDefaults: SoilParams = {
  layers: [
    { thickness: 100, fieldCapacity: 0.3, wiltingPoint: 0.14 },
    { thickness: 200, fieldCapacity: 0.3, wiltingPoint: 0.14 },
    { thickness: 200, fieldCapacity: 0.3, wiltingPoint: 0.14 },
    { thickness: 250, fieldCapacity: 0.3, wiltingPoint: 0.14 },
    { thickness: 250, fieldCapacity: 0.3, wiltingPoint: 0.14 },
  ],
  initialFraction: 0.7,
};

/** Loam with an N pool: placeholder values of plausible order (about 1% of organic N mineralized per season in the top layers). */
export const loamWithN: SoilParams = {
  ...loamDefaults,
  mineralizationRate: 1e-4,
  mineralizationQ10: 2,
  layers: loamDefaults.layers.map((l, i) => ({
    ...l,
    organicN: [1200, 2200, 1800, 1500, 1000][i]!,
    mineralN: [15, 12, 8, 6, 4][i]!,
  })),
};
