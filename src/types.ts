/** Daily weather record. Units are in the comments; all rates are per day. */
export interface WeatherDay {
  /** Julian day of year (1-366); used for daylength */
  doy: number;
  /** Maximum air temperature, °C */
  tmax: number;
  /** Minimum air temperature, °C */
  tmin: number;
  /** Incoming shortwave radiation, MJ m-2 d-1 */
  srad: number;
  /** Rainfall + irrigation, mm d-1 */
  rain: number;
  /** Reference evapotranspiration, mm d-1 (optional; estimated if omitted) */
  et0?: number;
}

/** Piecewise-linear table: [x, y] pairs with strictly increasing x. */
export type Table = ReadonlyArray<readonly [number, number]>;

export interface CropParams {
  // --- Phenology ---
  tBase: number; // base temperature for development, °C
  tCeil: number; // temperature above which no further thermal time accrues, °C
  ttEmergence: number; // sowing -> emergence, °C d
  ttSilking: number; // emergence -> silking (DVS 0 -> 1), °C d
  ttMaturity: number; // silking -> maturity (DVS 1 -> 2), °C d
  /** Photoperiod: development slows when daylength exceeds this (h). Short-day response. */
  photoperiodCritical: number;
  /** Fractional slowdown of vegetative development per hour above critical */
  photoperiodSensitivity: number;
  /** Lower bound on the photoperiod factor */
  photoperiodMinFactor: number;
  /** "short" (default, maize-like): long days slow development. "long" (wheat-like): short days slow it. */
  photoperiodType?: "short" | "long";
  /** Vernalization requirement, in effective cold days. 0 or undefined = none (spring habit, maize). */
  vernRequired?: number;
  /** Development-rate multiplier when no vernalization has accrued (rises linearly to 1 at vernRequired) */
  vernMinFactor?: number;

  // --- Light interception & biomass ---
  k: number; // canopy extinction coefficient
  sla: number; // specific leaf area, m2 leaf g-1 leaf
  rue: number; // GROSS radiation-use efficiency, g DM MJ-1 intercepted PAR
  parFraction: number; // PAR fraction of shortwave
  tempResponse: readonly [number, number, number, number]; // [Tmin, Topt1, Topt2, Tmax] for growth
  initialBiomass: number; // g m-2 at emergence

  // --- Respiration ---
  /** Maintenance respiration coefficient at reference temperature, g DM g-1 DM d-1 (living non-storage organs) */
  maintRespCoef: number;
  maintRespQ10: number;
  maintRespRefTemp: number; // °C

  // --- CO2 (C4 crop: small effects; PLACEHOLDER values) ---
  /** Fractional change in assimilation per +100 ppm CO2 above 400 */
  co2AssimilationSensitivity: number;
  /** Fractional change in transpiration demand per +100 ppm CO2 above 400 (negative = reduction) */
  co2TranspirationSensitivity: number;

  // --- Heat stress on grain set around silking ---
  heatThreshold: number; // daily Tmax (°C) above which damage accrues
  /** If set, heat damage follows canopy temperature (see canopy.ts), with the canopy-minus-air offset scaled by this. Unset keeps air temperature with a drought amplifier. */
  canopyCoupling?: number;
  heatDamageRate: number; // fraction of kernel set lost per °C above threshold per day, inside the critical window
  /** Fraction of the grain stored before the kernel count is set that is lost in proportion to heat damage (aborted kernels). Default 0. */
  heatStorageLoss?: number;

  // --- Critical period and kernel set (Andrade-type: kernel number follows crop growth rate around silking) ---
  kernelWindowBefore: number; // °C d before silking at which the critical window opens
  kernelWindowAfter: number; // °C d after silking at which it closes
  kernelSlope: number; // kernels m-2 per (g m-2 d-1) of mean crop growth rate above the threshold (PLACEHOLDER)
  kernelCgrThreshold: number; // g m-2 d-1 (PLACEHOLDER)
  kernelMax: number; // upper bound on kernels m-2
  /** If set, kernel number follows a saturating curve of growth rate above the threshold (initial slope kernelSlope, ceiling this value) instead of a straight line cut off at kernelMax. Andrade et al. 1999 found the plant-level relationship curvilinear. */
  kernelAsymptote?: number;
  potentialKernelWeight: number; // g DM per kernel; grain sink = kernels * this

  // --- Frost ---
  frostKillTemp: number; // daily Tmin (°C) at or below which the crop is killed
  frostSeedlingDvs: number; // below this DVS the growing point is protected (no kill)
  /** Optional hardier threshold (°C) used before frostSensitiveDvs (e.g. wheat in winter). Default: frostKillTemp. */
  frostHardyTemp?: number;
  /** DVS from which frostKillTemp applies instead of frostHardyTemp (e.g. wheat from jointing/booting). Default 0. */
  frostSensitiveDvs?: number;
  frostSafeDvs: number; // at or above this DVS (black layer) a frost no longer reduces yield; run ends as mature

  // --- Partitioning (functions of DVS) ---
  rootFraction: Table; // fraction of new total biomass to roots
  leafFraction: Table; // fraction of new shoot biomass to leaves
  stemFraction: Table; // ... to stems
  storageFraction: Table; // ... to ear/grain (before heat-stress reduction)
  leafSenescenceRate: number; // relative leaf loss per °C d after silking

  // --- Water ---
  kcb: number; // basal crop coefficient at full cover
  depletionP: number; // fraction of available water extractable without stress (FAO-56 style)
  rootDepthMax: number; // mm
  /** Exponential decline of root-water-uptake weight with depth (dimensionless; higher = shallower roots) */
  rootDecay: number;
  /** Rooting depth at emergence, mm (grows linearly with DVS to rootDepthMax by silking) */
  rootDepthInitial: number;
  /** Maximum leaf area index; assimilate the canopy cannot take goes to stem */
  laiMax: number;

  // --- Nitrogen (used only when the soil defines a nitrogen pool) ---
  /** Critical shoot N concentration (%) = ncritA * W^-ncritB with W shoot biomass in t/ha (Plenet & Lemaire form; verify values) */
  ncritA: number;
  ncritB: number;
  /** Fraction of mineral N in explored layers that roots can take up per day */
  nUptakeFraction: number;
  /** Maximum crop N uptake, kg N ha-1 d-1 */
  nMaxUptake: number;
  /** Legume: biological fixation covers whatever the soil cannot supply, so nitrogen never limits growth */
  fixesN?: boolean;

  /** Stand establishment and density response; omit to ignore population and depth */
  stand?: StandParams;
}

/** Stand establishment and plant density (optional; without it, population and depth have no effect). PLACEHOLDER values. */
export interface StandParams {
  /** Plants per m2 that the biomass and kernel parameters are tuned for */
  refPopulation: number;
  /** Sowing depth, cm, at which ttEmergence applies */
  refDepthCm: number;
  /** Fraction of seeds that produce a seedling in good conditions */
  establishment: number;
  /** Extra thermal time to emerge per cm of sowing depth beyond refDepthCm, °C d */
  emergeTTPerCm: number;
  /** Days from sowing beyond which slow emergence starts to cost seedlings */
  emergeDaysTolerated: number;
  /** Fraction of seedlings lost per day beyond that */
  emergeLossPerDay: number;
  /** Sowing depth, cm, at or above which seed is at risk of drying out in a dry seedbed */
  shallowDepthCm: number;
  /** Maximum fraction lost per day for the shallowest seed in a dry seedbed */
  shallowDryLoss: number;
  /** Fraction of seeds lost to exposure when sown at the surface, falling to 0 at shallowDepthCm */
  shallowExposureLoss: number;
  /** Largest leaf area one plant can carry, m2 plant-1 (caps leaf area index in a sparse stand) */
  leafAreaPerPlant: number;
  /** Exponent for the maximum kernel number: 1 = no compensation by the plant, lower = more compensation */
  popExponent: number;
  /** Exponent for the growth-rate threshold of kernel set: higher = crowding costs more */
  crowdingExponent: number;
}

export interface SoilLayer {
  thickness: number; // mm
  fieldCapacity: number; // m3 m-3
  wiltingPoint: number; // m3 m-3
  /** Mineralizable organic N, kg N ha-1 (omit for no N pool) */
  organicN?: number;
  /** Initial mineral N (nitrate + ammonium), kg N ha-1 */
  mineralN?: number;
}

export interface SoilParams {
  layers: SoilLayer[];
  /** Fraction of organic N mineralized per day at 25 C and optimal moisture. If undefined, N is not simulated (non-limiting). */
  mineralizationRate?: number;
  mineralizationQ10?: number;
  /** Initial plant-available water as fraction of capacity (0-1), same in all layers */
  initialFraction: number;
  /**
   * Share of the water held above field capacity that drains out of a layer each day. 1 (default) is free drainage:
   * everything above field capacity leaves at once. A poorly drained soil without tile has a small value (0.1 to 0.3),
   * so wet spells leave the root zone saturated.
   */
  drainFraction?: number;
  /** Pore space between field capacity and saturation, m3 m-3 (default 0.12). Only matters when `drainFraction` is below 1. */
  extraPorosity?: number;
}

/** Automatic irrigation: when the root zone has dried below `trigger`, apply `amountMm` until `maxSeasonMm` is used. */
export interface Irrigation {
  /** Relative plant-available water in the root zone (0-1) below which to irrigate. Default 0.5 */
  trigger?: number;
  /** Depth per application, mm. Default 25 */
  amountMm?: number;
  /** Seasonal limit, mm. Default 300 */
  maxSeasonMm?: number;
  /** Stop irrigating once development passes this DVS (default 1.7, well into grain filling) */
  stopDvs?: number;
}

/** Fertilizer application. day 0 = sowing day. Goes into the top layer. */
export interface Fertilizer {
  day: number;
  kgN: number;
}

export interface DayOutput {
  day: number; // days after sowing (1-based)
  doy: number;
  daylength: number; // h
  photoperiodFactor: number;
  dvs: number; // 0 emergence, 1 silking, 2 maturity (-1 pre-emergence)
  lai: number;
  fi: number;
  ws: number; // water stress factor (1 = none)
  aeration: number; // waterlogging stress factor (1 = none)
  tempFactor: number;
  grainSet: number; // 1 = no heat damage
  gross: number; // gross assimilation, g m-2 d-1
  respiration: number; // maintenance respiration, g m-2 d-1
  growth: number; // NET new dry matter = gross - respiration, g m-2 d-1
  totalBiomass: number; // living organs + dead leaf, g m-2
  leaf: number;
  stem: number;
  root: number;
  storage: number;
  deadLeaf: number;
  soilWater: number; // mm in whole profile
  soilWaterLayers: number[];
  transpiration: number;
  soilEvap: number;
  drainage: number;
  /** Nitrogen nutrition index (actual / critical shoot N, capped at 1); 1 if N not simulated */
  nni: number;
  nCrop: number; // shoot N, kg ha-1
  minN: number; // soil mineral N, kg ha-1
  nUptake: number;
  nMineralized: number;
  nLeached: number;
  /** True while the crop is inside its critical window around silking */
  inWindow: boolean;
  /** Vernalization progress 0-1 (1 when the crop has no requirement) */
  vern: number;
  /** Kernels m-2 (0 until the window closes and kernel number is fixed) */
  kernels: number;
  /** Plants per m2 (0 before emergence) */
  plants: number;
}

/** Conditions the crop actually met during its critical window around silking. */
export interface CriticalPeriodReport {
  /** False if the run ended (frost, end of weather) before the window closed */
  completed: boolean;
  /** Days after sowing (1-based); 0 if the window was never entered */
  startDay: number;
  endDay: number;
  startDoy: number;
  endDoy: number;
  days: number;
  meanSrad: number; // MJ m-2 d-1
  meanTmax: number; // °C
  hotDays: number; // days with Tmax above the heat threshold
  meanWs: number; // 1 = no water stress
  meanNni: number; // 1 = no N stress
  meanCgr: number; // g m-2 d-1
  kernelsPerM2: number;
  /** 1 = no heat damage to kernel set */
  heatSetFactor: number;
}

export interface NitrogenBalance {
  fertilizer: number;
  mineralized: number;
  uptake: number;
  leached: number;
  /** Initial N assigned to the crop at emergence (seed reserve) */
  seed: number;
  mineralChange: number; // end minus start soil mineral N
  organicChange: number; // end minus start organic N
}

export interface SimulationResult {
  days: DayOutput[];
  matured: boolean;
  /** Final storage-organ (ear) dry matter, t ha-1 (g m-2 / 100) */
  yieldTHa: number;
  /** Cumulative water-balance terms, mm */
  balance: {
    rain: number;
    /** Irrigation applied, mm (not included in `rain`) */
    irrigation: number;
    transpiration: number;
    soilEvap: number;
    drainage: number;
    /** Change in soil water storage (end minus start), mm */
    storageChange: number;
  };
  /** Sum of daily NET growth, g m-2 (totalBiomass(end) = initialBiomass + this) */
  cumulativeGrowth: number;
  cumulativeGross: number;
  cumulativeRespiration: number;
  /** Present only when the soil defines N pools. */
  nitrogen?: NitrogenBalance;
  /** True if a killing frost ended the crop before black layer */
  frostKilled: boolean;
  /** Stand at emergence; undefined when population and depth are not simulated */
  stand?: { seeds: number; plants: number; survival: number; emergenceDay: number };
  criticalPeriod: CriticalPeriodReport;
}
