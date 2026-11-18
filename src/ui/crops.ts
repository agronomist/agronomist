import {
  hybrid,
  maizeDefaults,
  wheatCultivar,
  wheatSpringDefaults,
  wheatWinterDefaults,
  type CropParams,
  type SeasonalOptions,
} from "../index";
import { maizeArt } from "./art-maize";
import { wheatArt } from "./art-wheat";
import type { PlantArt } from "./draw-util";

export type CropKey = "maize" | "wheat";
export type Habit = "winter" | "spring";

export interface Settings {
  crop: CropKey;
  location: string;
  scenario: string;
  sowDoy: number; // may exceed 365 for crops sown in autumn and harvested the next year
  rm: number;
  nRate: number;
  seedingRate: number; // seeds per m2
  depthCm: number; // sowing depth, cm
  habit: Habit; // wheat only
  seed: number;
}

export interface Scenario {
  label: string;
  /** Hazards with fixed calendar dates (heat wave, cold snap, dry spell) */
  opts: SeasonalOptions;
  /** Multiplies the location's mean daily rain */
  rainFactor?: number;
  /** Added to the location's annual mean temperature, °C */
  tempShift?: number;
}

export interface CropConfig {
  key: CropKey;
  label: string;
  art: PlantArt;
  cropFor(s: Settings): CropParams;
  /** Day of year at which the weather timeline starts, and how many days it covers */
  yearStart: number;
  yearDays: number;
  sow: { min: number; max: number; step: number; value: number };
  nMax: number;
  /** Slider range for the seeding rate (seeds per m2) and sowing depth (cm) */
  pop: { min: number; max: number; step: number };
  depth: { min: number; max: number; step: number };
  defaults: { rm: number; nRate: number; habit: Habit; seedingRate: number; depthCm: number };
  rmLabel: string;
  habits: boolean;
  scenarios: Record<string, Scenario>;
  fertilizerFor(nRate: number, sowDoy: number): { day: number; kgN: number }[];
  grid: { sow: (habit: Habit) => number[]; rm: number[]; n: number[]; pop: number[]; depth: number[]; habits: Habit[] };
  grainWord: string; // "kernel" or "grain"
  idealSrad: number;
  stageName(a: { dvs: number; emerged: boolean; killed: boolean; inWindow: boolean; kernels: number; tmean: number }): string;
  frostLabel: string;
  lede: string;
}

const maize: CropConfig = {
  key: "maize",
  label: "Maize",
  art: maizeArt,
  cropFor: (s) => hybrid(maizeDefaults, s.rm),
  yearStart: 60,
  yearDays: 330,
  sow: { min: 80, max: 185, step: 5, value: 120 },
  nMax: 300,
  pop: { min: 4, max: 12, step: 0.5 },
  depth: { min: 1, max: 10, step: 1 },
  defaults: { rm: 110, nRate: 180, habit: "winter", seedingRate: 8, depthCm: 5 },
  rmLabel: "Hybrid maturity",
  habits: false,
  scenarios: {
    typical: { label: "Typical year", opts: {} },
    hazard: {
      label: "Midsummer heat wave + drought",
      opts: { heatWave: { startDoy: 185, endDoy: 215, addC: 9 }, drySpell: { startDoy: 175, endDoy: 225 } },
    },
    dry: { label: "Dry year", opts: {}, rainFactor: 0.5 },
    wet: { label: "Cool, wet year", opts: {}, rainFactor: 1.6, tempShift: -1 },
  },
  fertilizerFor: (n) => (n > 0 ? [{ day: 0, kgN: n * 0.4 }, { day: 40, kgN: n * 0.6 }] : []),
  grid: { sow: () => [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 185], rm: [95, 105, 115, 125], n: [0, 60, 120, 180, 240], pop: [5, 6, 7, 8, 9, 10, 11], depth: [2, 3, 4, 5, 6, 8], habits: ["winter"] },
  grainWord: "kernel",
  idealSrad: 22,
  stageName: ({ dvs, emerged, killed, inWindow, kernels }) => {
    if (!emerged) return "Seed in the soil";
    if (killed) return "Killed by frost";
    if (dvs >= 2) return "Black layer: mature";
    if (inWindow) return "Critical window";
    if (kernels > 0 && dvs < 1.8) return "Grain filling";
    if (kernels > 0) return "Drying down";
    if (dvs < 0.3) return "Seedling";
    return "Rapid vegetative growth";
  },
  frostLabel: "killing frost",
  lede: "One simulated season, played back. The plant, the soil profile and every chart come from the same model run, so changing the sowing date, hybrid or nitrogen shows where the critical window lands and what it meets.",
};

const wheat: CropConfig = {
  key: "wheat",
  label: "Wheat",
  art: wheatArt,
  cropFor: (s) => wheatCultivar(s.habit === "winter" ? wheatWinterDefaults : wheatSpringDefaults, s.rm),
  yearStart: 200,
  yearDays: 600,
  sow: { min: 255, max: 470, step: 5, value: 290 },
  nMax: 240,
  pop: { min: 100, max: 600, step: 25 },
  depth: { min: 1, max: 8, step: 1 },
  defaults: { rm: 110, nRate: 140, habit: "winter", seedingRate: 350, depthCm: 4 },
  rmLabel: "Cultivar maturity",
  habits: true,
  scenarios: {
    typical: { label: "Typical year", opts: {} },
    hazard: {
      label: "Late-spring heat wave + drought",
      opts: { heatWave: { startDoy: 128, endDoy: 148, addC: 6 }, drySpell: { startDoy: 112, endDoy: 160 } },
    },
    freeze: {
      label: "Late-spring freeze",
      // a negative heat wave is a cold snap
      opts: { heatWave: { startDoy: 124, endDoy: 133, addC: -15 } },
    },
    dry: { label: "Dry year", opts: {}, rainFactor: 0.4 },
    wet: { label: "Cool, wet year", opts: {}, rainFactor: 1.5, tempShift: -1 },
  },
  fertilizerFor: (n, sowDoy) => {
    if (n <= 0) return [];
    // 30% at sowing, 70% at spring green-up (about 15 March) or 40 days after a spring sowing
    const toGreenUp = (75 + 365 - (sowDoy % 365)) % 365;
    const second = toGreenUp > 150 ? 40 : Math.max(25, toGreenUp);
    return [{ day: 0, kgN: n * 0.3 }, { day: second, kgN: n * 0.7 }];
  },
  // winter types are only offered autumn to mid-winter sowings, spring types late winter to early spring
  grid: { sow: (h) => (h === "winter" ? [255, 275, 290, 305, 320, 335, 350, 380] : [380, 410, 440, 470]), rm: [95, 105, 115, 125], n: [0, 60, 120, 180], pop: [150, 200, 250, 300, 350, 400, 500], depth: [2, 3, 4, 5, 6], habits: ["winter", "spring"] },
  grainWord: "grain",
  idealSrad: 20,
  stageName: ({ dvs, emerged, killed, inWindow, kernels, tmean }) => {
    if (!emerged) return "Seed in the soil";
    if (killed) return "Killed by frost";
    if (dvs >= 2) return "Maturity: harvest-ready";
    if (inWindow) return "Critical window";
    if (kernels > 0 && dvs < 1.8) return "Grain filling";
    if (kernels > 0) return "Ripening";
    if (dvs < 0.5 && tmean < 3) return "Winter dormancy";
    if (dvs < 0.25) return "Tillering";
    if (dvs < 0.7) return "Stem elongation";
    return "Booting and heading";
  },
  frostLabel: "killing frost after booting",
  lede: "One simulated season, played back. Winter wheat needs a cold spell before it can head, so sowing date, winter or spring habit and cultivar decide when the critical window lands and what weather it meets.",
};

export const CROPS: Record<CropKey, CropConfig> = { maize, wheat };
