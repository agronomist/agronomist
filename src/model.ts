import { relativeCanopyHeat } from "./canopy";
import { defaultProcesses, clamp, interpolate, type ProcessSet } from "./processes";
import type {
  Irrigation,
  CropParams,
  DayOutput,
  Fertilizer,
  SimulationResult,
  SoilParams,
  WeatherDay,
} from "./types";
import {
  dailyEmergenceLoss,
  emergenceThermalTime,
  kernelSetScale,
  seedbedRelWater,
  laiCap,
  plantsFromSeeds,
  relativeDensity,
  type Management,
} from "./stand";

export interface SimulationInput {
  weather: WeatherDay[]; // first record is the sowing day
  crop: CropParams;
  soil: SoilParams;
  /** Latitude in degrees (north positive); drives daylength. Default 0 (no photoperiod effect). */
  latitude?: number;
  /** Atmospheric CO2, ppm. Default 400 (reference; no CO2 effect). */
  co2?: number;
  /** Fertilizer applications (only effective when the soil defines N pools). */
  fertilizer?: Fertilizer[];
  /** Override any process module; unspecified ones use the defaults. */
  processes?: Partial<ProcessSet>;
  /** Seeding rate and sowing depth. Used only when the crop defines `stand`; otherwise ignored. */
  management?: Management;
  /** Automatic irrigation. Default none (rain-fed). */
  irrigation?: Irrigation;
}

/**
 * Daily-step cereal model (maize and wheat parameter sets): thermal-time phenology with photoperiod, Beer-Lambert
 * light interception, RUE gross assimilation minus maintenance respiration,
 * DVS-driven partitioning with heat-stress reduction of grain set, CO2 effects,
 * and a multi-layer tipping-bucket water balance with root-weighted uptake.
 *
 * Conservation properties (checked in tests):
 *   biomass:  totalBiomass(end) = initialBiomass + sum(net growth),
 *             net growth = gross assimilation - maintenance respiration
 *   water:    soilWater(start) + rain = soilWater(end) + T + Es + drainage
 *   nitrogen: minN(start) + fertilizer + mineralized = minN(end) + uptake + leached
 *             organicN(start) - mineralized = organicN(end)
 *             cropN(end) = seed + uptake
 *   kernels:  grain filling is capped at kernels * potentialKernelWeight once the critical window closes
 * Nitrogen is simulated only if soil.mineralizationRate is defined; otherwise N is non-limiting.
 */
export function simulate(input: SimulationInput): SimulationResult {
  const { weather, crop: p, soil } = input;
  const proc: ProcessSet = { ...defaultProcesses, ...input.processes };
  const latitude = input.latitude ?? 0;
  const co2 = input.co2 ?? 400;
  const co2f = proc.co2Effects(co2, p);

  const L = soil.layers;
  const tops: number[] = [];
  {
    let z = 0;
    for (const l of L) {
      tops.push(z);
      z += l.thickness;
    }
  }
  const fc = L.map((l) => l.fieldCapacity * l.thickness);
  const wp = L.map((l) => l.wiltingPoint * l.thickness);
  const airDry1 = 0.5 * wp[0]!;

  const sw = L.map((_, i) => wp[i]! + soil.initialFraction * (fc[i]! - wp[i]!));
  const total = () => sw.reduce((a, b) => a + b, 0);
  const sw0 = total();

  // ---- Nitrogen state ----
  const nOn = soil.mineralizationRate !== undefined;
  const minN = L.map((l) => (nOn ? (l.mineralN ?? 0) : 0));
  const org = L.map((l) => (nOn ? (l.organicN ?? 0) : 0));
  const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const minN0 = sumArr(minN);
  const org0 = sumArr(org);
  const fert = input.fertilizer ?? [];
  const nBal = { fertilizer: 0, mineralized: 0, uptake: 0, leached: 0, seed: 0 };
  let nCrop = 0;

  // ---- Stand: seeding rate and depth act only if the crop defines stand parameters and management is given ----
  const sp = p.stand;
  const mg = input.management;
  const standOn = sp !== undefined && mg !== undefined;
  const ttEmerge = standOn ? emergenceThermalTime(sp, p.ttEmergence, mg.sowingDepthCm) : p.ttEmergence;
  let survival = 1;
  let plants = 0;
  let density = 1; // plants relative to the reference density
  let leafCap = p.laiMax; // maximum leaf area index
  let setScale = { threshold: 1, max: 1 }; // scales on the kernel-set terms
  let emergenceDay = 0;

  let emerged = false;
  let ttSinceSowing = 0;
  let dvs = -1;
  let leaf = 0;
  let stem = 0;
  let root = 0;
  let storage = 0;
  let deadLeaf = 0;
  let heatDamage = 0;
  let frostKilled = false;
  let vdays = 0; // effective vernalization days since sowing

  // ---- Critical window state ----
  const winStartDvs = 1 - p.kernelWindowBefore / p.ttSilking;
  const winEndDvs = 1 + p.kernelWindowAfter / p.ttMaturity;
  const cp = { days: 0, srad: 0, tmax: 0, ws: 0, nni: 0, cgr: 0, hot: 0, startDay: 0, endDay: 0, startDoy: 0, endDoy: 0 };
  let windowClosed = false;
  let kernels = 0;
  let sinkCap = Infinity;
  let matured = false;
  let cumulativeGrowth = 0;
  let cumulativeGross = 0;
  let cumulativeResp = 0;
  const bal = { rain: 0, irrigation: 0, transpiration: 0, soilEvap: 0, drainage: 0 };
  const days: DayOutput[] = [];

  for (let i = 0; i < weather.length && !matured && !frostKilled; i++) {
    const w = weather[i]!;
    const dtt = proc.thermalTime(w, p);
    const tmean = (w.tmax + w.tmin) / 2;
    const dl = proc.daylength(w.doy, latitude);
    const ppf = proc.photoperiodFactor(dl, p);
    const vreq = p.vernRequired ?? 0;
    if (vreq > 0) vdays += proc.vernalizationRate(tmean);
    const vern = vreq > 0 ? clamp(vdays / vreq, 0, 1) : 1;
    const vf = vreq > 0 ? (p.vernMinFactor ?? 0.1) + (1 - (p.vernMinFactor ?? 0.1)) * vern : 1;

    // ---- Nitrogen: fertilizer and mineralization (start of day) ----
    let nMin = 0;
    if (nOn) {
      for (const f of fert) {
        if (f.day === i) {
          minN[0]! += f.kgN;
          nBal.fertilizer += f.kgN;
        }
      }
      const fT = (soil.mineralizationQ10 ?? 2) ** ((tmean - 25) / 10);
      for (let l = 0; l < L.length; l++) {
        const rel = clamp((sw[l]! - wp[l]!) / (fc[l]! - wp[l]!), 0, 1);
        const m = Math.min(org[l]!, soil.mineralizationRate! * org[l]! * fT * (0.1 + 0.9 * rel));
        org[l]! -= m;
        minN[l]! += m;
        nMin += m;
      }
      nBal.mineralized += nMin;
    }

    // ---- Irrigation: applied when the root zone has dried below the trigger ----
    let irrigated = 0;
    const irr = input.irrigation;
    if (irr && emerged && dvs < (irr.stopDvs ?? 1.7) && bal.irrigation < (irr.maxSeasonMm ?? 300)) {
      const rd = p.rootDepthInitial + (p.rootDepthMax - p.rootDepthInitial) * clamp(dvs, 0, 1);
      let have = 0;
      let full = 0;
      for (let l = 0; l < L.length; l++) {
        const explored = clamp((rd - tops[l]!) / L[l]!.thickness, 0, 1);
        have += Math.max(0, sw[l]! - wp[l]!) * explored;
        full += (fc[l]! - wp[l]!) * explored;
      }
      if (full > 0 && have / full < (irr.trigger ?? 0.5)) irrigated = Math.min(irr.amountMm ?? 25, (irr.maxSeasonMm ?? 300) - bal.irrigation);
      bal.irrigation += irrigated;
    }

    // ---- Water: infiltration cascades down (mineral N moves with drainage) ----
    // Water above field capacity drains at `drainFraction` per day; what exceeds saturation passes straight through.
    // With the default of 1 this is the plain tipping bucket: everything above field capacity leaves the layer at once.
    let inflow = w.rain + irrigated;
    let inflowN = 0;
    bal.rain += w.rain;
    const dF = clamp(soil.drainFraction ?? 1, 0, 1);
    const poro = soil.extraPorosity ?? 0.12;
    for (let l = 0; l < L.length; l++) {
      sw[l]! += inflow;
      minN[l]! += inflowN;
      const sat = fc[l]! + poro * L[l]!.thickness;
      const over = Math.max(0, sw[l]! - sat);
      const held = Math.max(0, Math.min(sw[l]!, sat) - fc[l]!);
      const excess = dF >= 1 ? Math.max(0, sw[l]! - fc[l]!) : over + dF * held;
      const moved = sw[l]! > 0 ? minN[l]! * (excess / sw[l]!) : 0;
      sw[l]! -= excess;
      minN[l]! -= moved;
      inflow = excess;
      inflowN = moved;
    }
    const drainage = inflow;
    const nLeached = inflowN;
    nBal.leached += nLeached;

    // ---- Canopy state at start of day ----
    const fi = emerged ? proc.lightInterception(leaf * p.sla, p) : 0;
    const et0 = proc.referenceET(w);

    // ---- Soil evaporation from the top layer ----
    const relTop = (sw[0]! - wp[0]!) / (fc[0]! - wp[0]!);
    const relSecond = L.length > 1 ? (sw[1]! - wp[1]!) / (fc[1]! - wp[1]!) : relTop;
    const evapFactor = clamp(relTop / 0.5, 0, 1);
    const soilEvap = Math.min(Math.max(0, sw[0]! - airDry1), (1 - fi) * et0 * evapFactor);
    sw[0]! -= soilEvap;

    // ---- Transpiration: root-weighted uptake across layers ----
    let transpiration = 0;
    let ws = 1;
    if (emerged) {
      const rootDepth = p.rootDepthInitial + (p.rootDepthMax - p.rootDepthInitial) * clamp(dvs, 0, 1);
      const cap: number[] = [];
      const maxCap: number[] = [];
      for (let l = 0; l < L.length; l++) {
        const explored = clamp((rootDepth - tops[l]!) / L[l]!.thickness, 0, 1);
        cap.push(Math.max(0, sw[l]! - wp[l]!) * explored);
        maxCap.push((fc[l]! - wp[l]!) * explored);
      }
      const availRoot = cap.reduce((a, b) => a + b, 0);
      const maxAvail = maxCap.reduce((a, b) => a + b, 0);
      const relAvail = maxAvail > 0 ? availRoot / maxAvail : 0;
      const ks = clamp(relAvail / p.depletionP, 0, 1);
      const tPot = p.kcb * fi * et0 * co2f.transpiration;
      transpiration = Math.min(tPot * ks, availRoot);

      // allocate demand across layers by weight, capped by each layer's supply
      const weights = cap.map((c, l) => c * Math.exp((-p.rootDecay * tops[l]!) / rootDepth));
      const left = cap.slice();
      let remaining = transpiration;
      for (let iter = 0; iter < L.length && remaining > 1e-12; iter++) {
        let sumW = 0;
        for (let l = 0; l < L.length; l++) if (left[l]! > 1e-12) sumW += weights[l]!;
        if (sumW <= 0) break;
        let taken = 0;
        for (let l = 0; l < L.length; l++) {
          if (left[l]! <= 1e-12) continue;
          const take = Math.min(left[l]!, (remaining * weights[l]!) / sumW);
          left[l]! -= take;
          sw[l]! -= take;
          taken += take;
        }
        remaining -= taken;
      }
      ws = tPot > 1e-9 ? Math.min(1, transpiration / tPot) : 1;
    }
    // ---- Aeration: a root zone holding water above field capacity starves roots of oxygen ----
    let aeration = 1;
    if (emerged && dF < 1) {
      const rd = p.rootDepthInitial + (p.rootDepthMax - p.rootDepthInitial) * clamp(dvs, 0, 1);
      let wet = 0;
      let room = 0;
      for (let l = 0; l < L.length; l++) {
        const explored = clamp((Math.min(rd, 400) - tops[l]!) / L[l]!.thickness, 0, 1);
        wet += Math.max(0, sw[l]! - fc[l]!) * explored;
        room += poro * L[l]!.thickness * explored;
      }
      const filled = room > 0 ? wet / room : 0;
      aeration = 1 - 0.8 * clamp((filled - 0.5) / 0.5, 0, 1);
    }
    bal.transpiration += transpiration;
    bal.soilEvap += soilEvap;
    bal.drainage += drainage;

    // ---- Phenology, growth, respiration ----
    let nni = 1;
    let nUptakeToday = 0;
    let gross = 0;
    let resp = 0;
    let growth = 0;
    let tempFactor = 0;
    let grainSet = clamp(1 - heatDamage, 0, 1);
    let inWindowToday = false;
    if (!emerged) {
      ttSinceSowing += dtt;
      if (standOn) survival *= 1 - dailyEmergenceLoss(sp, { depthCm: mg.sowingDepthCm, daysSinceSowing: i + 1, seedbedRelWater: seedbedRelWater(mg.sowingDepthCm, relTop, relSecond) });
      if (ttSinceSowing >= ttEmerge) {
        emerged = true;
        emergenceDay = i + 1;
        dvs = 0;
        if (standOn) {
          plants = plantsFromSeeds(sp, mg.seedingRate, survival, mg.sowingDepthCm);
          density = relativeDensity(sp, plants);
          leafCap = laiCap(sp, plants, p.laiMax);
          setScale = kernelSetScale(sp, plants);
        }
        const biomass0 = p.initialBiomass * density;
        const r = interpolate(p.rootFraction, 0);
        root = biomass0 * r;
        const shoot = biomass0 * (1 - r);
        leaf = shoot * interpolate(p.leafFraction, 0);
        stem = shoot * interpolate(p.stemFraction, 0);
        storage = shoot * interpolate(p.storageFraction, 0);
        if (nOn) {
          const shootDM = leaf + stem + storage;
          nCrop = (proc.criticalN(shootDM / 100, p) / 100) * shootDM * 10;
          nBal.seed = nCrop;
        }
      }
    } else if (
      dvs >= p.frostSeedlingDvs &&
      w.tmin <= (dvs >= (p.frostSensitiveDvs ?? 0) ? p.frostKillTemp : (p.frostHardyTemp ?? p.frostKillTemp))
    ) {
      // killing frost: after black layer it is harmless, before it ends the crop
      if (dvs >= p.frostSafeDvs) matured = true;
      else frostKilled = true;
    } else {
      tempFactor = proc.temperatureFactor(tmean, p);

      // ---- Nitrogen uptake and nutrition index ----
      if (nOn) {
        const shootDM = leaf + stem + storage + deadLeaf;
        const ncrit = proc.criticalN(shootDM / 100, p);
        const targetN = (ncrit / 100) * shootDM * 10;
        const demand = Math.max(0, targetN - nCrop);
        const rootDepth = p.rootDepthInitial + (p.rootDepthMax - p.rootDepthInitial) * clamp(dvs, 0, 1);
        const avail = L.map(
          (l, k) => minN[k]! * clamp((rootDepth - tops[k]!) / l.thickness, 0, 1) * p.nUptakeFraction,
        );
        const supply = sumArr(avail);
        const uptake = Math.min(demand, p.nMaxUptake, supply);
        if (uptake > 0 && supply > 0) {
          for (let k = 0; k < L.length; k++) minN[k]! -= (uptake * avail[k]!) / supply;
          nCrop += uptake;
          nBal.uptake += uptake;
          nUptakeToday = uptake;
        }
        nni = targetN > 0 && !p.fixesN ? clamp(nCrop / targetN, 0, 1) : 1;
      }

      gross =
        proc.dailyGrowth({ srad: w.srad, fi, tempFactor, ws, p }) * co2f.assimilation * nni * aeration;
      resp = Math.min(
        gross,
        proc.maintenanceRespiration({ tmean, livingBiomass: leaf + stem + root, p }),
      );
      growth = gross - resp;
      cumulativeGross += gross;
      cumulativeResp += resp;
      cumulativeGrowth += growth;

      // ---- Critical window: record the conditions the crop actually experienced ----
      inWindowToday = !windowClosed && dvs >= winStartDvs;
      if (inWindowToday) {
        if (cp.days === 0) {
          cp.startDay = i + 1;
          cp.startDoy = w.doy;
        }
        cp.days++;
        cp.endDay = i + 1;
        cp.endDoy = w.doy;
        cp.srad += w.srad;
        cp.tmax += w.tmax;
        cp.ws += ws;
        cp.nni += nni;
        cp.cgr += growth;
        // a water-stressed canopy runs warmer than the air and a well-watered one cooler, so damage follows canopy temperature
        // (Lobell et al. 2011 found 1.7x the damage under drought); without a coupling the old air-temperature amplifier is used
        const tHeat = p.canopyCoupling === undefined ? w.tmax : w.tmax + relativeCanopyHeat(w.tmax, w.tmin, ws, p.canopyCoupling);
        if (tHeat > p.heatThreshold) {
          cp.hot++;
          heatDamage += (tHeat - p.heatThreshold) * p.heatDamageRate * (p.canopyCoupling === undefined ? 1 + 0.5 * (1 - ws) : 1);
        }
      }
      grainSet = clamp(1 - heatDamage, 0, 1);

      const fr = interpolate(p.rootFraction, dvs);
      const shootGrowth = growth * (1 - fr);
      const sFrac = interpolate(p.storageFraction, dvs);
      root += growth * fr;
      // leaf area is capped at laiMax; the surplus goes to stem so mass is conserved
      const leafWant = shootGrowth * interpolate(p.leafFraction, dvs);
      const toLeaf = Math.min(leafWant, Math.max(0, leafCap / p.sla - leaf));
      leaf += toLeaf;
      // once kernel number is fixed, grain filling is capped by the sink (kernels * potential weight);
      // assimilate the sink cannot take goes to stem, so mass is conserved
      const wantStorage = shootGrowth * sFrac;
      const toStorage = windowClosed ? Math.min(wantStorage, Math.max(0, sinkCap - storage)) : wantStorage;
      stem += shootGrowth * interpolate(p.stemFraction, dvs) + (wantStorage - toStorage) + (leafWant - toLeaf);
      storage += toStorage;

      if (dvs >= 1) {
        const loss = leaf * p.leafSenescenceRate * dtt;
        leaf -= loss;
        deadLeaf += loss;
      }

      dvs += dvs < 1 ? (dtt * ppf * vf) / p.ttSilking : dtt / p.ttMaturity;
      if (dvs >= 2) {
        dvs = 2;
        matured = true;
      }

      // window closes once DVS passes its end: kernel number is set from mean CGR, reduced by heat
      if (!windowClosed && dvs > winEndDvs) {
        windowClosed = true;
        const meanCgr = cp.days > 0 ? cp.cgr / cp.days : 0;
        const above = Math.max(0, meanCgr - p.kernelCgrThreshold * setScale.threshold);
        if (p.kernelAsymptote !== undefined) {
          const ceiling = p.kernelAsymptote * setScale.max;
          kernels = ceiling * (1 - Math.exp((-p.kernelSlope * above) / ceiling)) * grainSet;
        } else {
          kernels = clamp(p.kernelSlope * above, 0, p.kernelMax * setScale.max) * grainSet;
        }
        // kernels aborted by heat take the assimilate already stored for them with them
        if (p.heatStorageLoss) {
          const lost = storage * (1 - grainSet) * p.heatStorageLoss;
          storage -= lost;
          deadLeaf += lost; // residue, so the biomass balance stays exact
        }
        sinkCap = storage + kernels * p.potentialKernelWeight;
      }
    }

    days.push({
      day: i + 1,
      doy: w.doy,
      daylength: dl,
      photoperiodFactor: ppf,
      dvs,
      lai: leaf * p.sla,
      fi,
      ws,
      aeration,
      tempFactor,
      grainSet,
      gross,
      respiration: resp,
      growth,
      totalBiomass: leaf + stem + root + storage + deadLeaf,
      leaf,
      stem,
      root,
      storage,
      deadLeaf,
      soilWater: total(),
      soilWaterLayers: sw.slice(),
      transpiration,
      soilEvap,
      drainage,
      nni,
      nCrop,
      minN: sumArr(minN),
      nUptake: nUptakeToday,
      nMineralized: nMin,
      nLeached,
      inWindow: inWindowToday,
      vern,
      kernels,
      plants,
    });
  }

  return {
    days,
    matured,
    yieldTHa: storage / 100,
    balance: { ...bal, storageChange: total() - sw0 },
    cumulativeGrowth,
    cumulativeGross,
    cumulativeRespiration: cumulativeResp,
    frostKilled,
    stand: standOn ? { seeds: mg.seedingRate, plants, survival, emergenceDay } : undefined,
    criticalPeriod: {
      completed: windowClosed,
      startDay: cp.startDay,
      endDay: cp.endDay,
      startDoy: cp.startDoy,
      endDoy: cp.endDoy,
      days: cp.days,
      meanSrad: cp.days ? cp.srad / cp.days : 0,
      meanTmax: cp.days ? cp.tmax / cp.days : 0,
      hotDays: cp.hot,
      meanWs: cp.days ? cp.ws / cp.days : 1,
      meanNni: cp.days ? cp.nni / cp.days : 1,
      meanCgr: cp.days ? cp.cgr / cp.days : 0,
      kernelsPerM2: kernels,
      heatSetFactor: clamp(1 - heatDamage, 0, 1),
    },
    nitrogen: nOn
      ? {
          ...nBal,
          mineralChange: sumArr(minN) - minN0,
          organicChange: sumArr(org) - org0,
        }
      : undefined,
  };
}
