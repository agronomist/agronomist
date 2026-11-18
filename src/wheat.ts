import type { CropParams } from "./types";

/**
 * PLACEHOLDER winter-wheat parameters: textbook-order values (C3 crop, base 0 °C,
 * long-day and vernalization responses, grain number set in the weeks before
 * anthesis). DVS 0 = emergence, 1 = anthesis, 2 = maturity. NOT calibrated to any
 * cultivar or site. Nitrogen dilution curve is the Justes et al. (1994) form for wheat.
 */
export const wheatWinterDefaults: CropParams = {
  tBase: 0,
  tCeil: 30,
  ttEmergence: 140,
  ttSilking: 1000, // emergence -> anthesis (the field name is shared with maize)
  ttMaturity: 760, // anthesis -> maturity
  photoperiodType: "long",
  photoperiodCritical: 14,
  photoperiodSensitivity: 0.07,
  photoperiodMinFactor: 0.5,
  vernRequired: 45,
  vernMinFactor: 0.05,

  k: 0.6,
  sla: 0.02,
  rue: 3.0, // gross
  parFraction: 0.5,
  tempResponse: [0, 12, 22, 35],
  initialBiomass: 4,

  maintRespCoef: 0.008,
  maintRespQ10: 2,
  maintRespRefTemp: 25,

  co2AssimilationSensitivity: 0.1, // C3: larger than maize; placeholder
  co2TranspirationSensitivity: -0.08, // placeholder

  heatThreshold: 31,
  heatDamageRate: 0.05,

  kernelWindowBefore: 300, // roughly the 3 weeks before anthesis when spikes grow
  kernelWindowAfter: 120,
  kernelSlope: 600, // PLACEHOLDER: ~15,000 grains m-2 at 29 g m-2 d-1
  kernelCgrThreshold: 4, // PLACEHOLDER
  kernelMax: 18000, // grains m-2: strong crops carry 15 000 to 18 000
  potentialKernelWeight: 0.035, // g DM per grain (about 35 mg dry, 40 mg at market moisture)

  frostKillTemp: -4, // after booting
  frostHardyTemp: -16, // hardened winter wheat before booting
  frostSensitiveDvs: 0.7,
  frostSeedlingDvs: 0,
  frostSafeDvs: 1.9,

  rootFraction: [
    [0, 0.5],
    [0.5, 0.3],
    [1.0, 0.1],
    [1.3, 0.05],
    [2.0, 0],
  ],
  leafFraction: [
    [0, 0.7],
    [0.5, 0.5],
    [1.0, 0.1],
    [1.3, 0],
    [2.0, 0],
  ],
  stemFraction: [
    [0, 0.3],
    [0.5, 0.5],
    [1.0, 0.4],
    [1.3, 0.1],
    [2.0, 0],
  ],
  storageFraction: [
    [0, 0],
    [0.5, 0],
    [1.0, 0.5],
    [1.3, 0.9],
    [2.0, 1],
  ],
  leafSenescenceRate: 0.0012,

  kcb: 1.2,
  depletionP: 0.55,
  rootDepthMax: 800,
  rootDecay: 3,
  rootDepthInitial: 200,
  laiMax: 6,

  ncritA: 5.35,
  ncritB: 0.442,
  nUptakeFraction: 0.25,
  nMaxUptake: 4.5,

  // Stand establishment (PLACEHOLDERS): about 300 plants m-2 and 4 cm depth are the reference; wheat compensates by tillering
  stand: {
    refPopulation: 300,
    refDepthCm: 4,
    establishment: 0.85,
    emergeTTPerCm: 10,
    emergeDaysTolerated: 30,
    emergeLossPerDay: 0.01,
    shallowDepthCm: 4,
    shallowDryLoss: 0.1,
    shallowExposureLoss: 0.2,
    leafAreaPerPlant: 0.03,
    popExponent: 0.5,
    crowdingExponent: 0.7,
  },
};

/** Spring habit: no vernalization requirement, hardy only to about -9 °C before booting. */
export const wheatSpringDefaults: CropParams = {
  ...wheatWinterDefaults,
  vernRequired: 0,
  frostHardyTemp: -9,
  ttSilking: 860,
};

/**
 * Derive a cultivar from a base by maturity class (same 95-125 scale as the maize hybrids; base 110).
 * Later cultivars take more thermal time to anthesis and grain filling and have a higher
 * potential grain number and weight. The slopes are PLACEHOLDERS.
 */
export function wheatCultivar(base: CropParams, rm: number): CropParams {
  const d = rm - 110;
  return {
    ...base,
    ttSilking: base.ttSilking + 6 * d,
    ttMaturity: base.ttMaturity + 4 * d,
    potentialKernelWeight: base.potentialKernelWeight + 0.0003 * d,
    kernelMax: base.kernelMax + 100 * d,
  };
}
