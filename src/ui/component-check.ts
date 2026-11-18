import { CROPS } from "./crops";
import { syntheticYear } from "./weather-years";
import { locationByKey, soilFor } from "./locations";
import { simulateOption, type Management } from "./model-run";
import { maizeDefaults } from "../index";

/**
 * Checks of the model's parts, not of its final yield: does the machinery that makes yield match values measured or simulated elsewhere?
 * Every row runs on generated weather for a preset place, so it needs no network, and each one names its source. Values that miss are shown, not hidden.
 */
export interface ComponentRow {
  name: string;
  model: number;
  low: number;
  high: number;
  unit: string;
  source: string;
  note?: string;
}

const MAIZE: Management = { sowDoy: 120, rm: 110, nRate: 200, seedingRate: 8, depthCm: 5, habit: "winter" };
const MOISTURE = 0.845; // grain is quoted at 15.5 percent moisture, the model's yield is dry matter

function runs(place: string, irrigated: boolean, n = 30) {
  const cfg = CROPS.maize;
  const loc = locationByKey(place);
  const soil = soilFor(loc);
  const start = MAIZE.sowDoy - cfg.yearStart;
  return Array.from({ length: n }, (_, k) => {
    const w = syntheticYear(cfg, "typical", k + 1, loc);
    const r = simulateOption(cfg, loc, soil, { ...MAIZE, irrigated }, w);
    let ipar = 0, vegGrow = 0, vegIpar = 0;
    r.days.forEach((d, i) => {
      const ip = d.fi * 0.5 * w[start + i]!.srad;
      ipar += ip;
      if (d.dvs < 1) { vegGrow += d.growth; vegIpar += ip; }
    });
    const last = r.days[r.days.length - 1]!;
    return { yield155: r.yieldTHa / MOISTURE, supply: r.balance.rain + r.balance.irrigation, et: r.balance.transpiration + r.balance.soilEvap, vegRue: vegGrow / vegIpar, aboveground: last.totalBiomass - last.root, ipar };
  });
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

export function componentCheck(): ComponentRow[] {
  const irrNE = runs("nebraska", true);
  const irrIA = runs("iowa", true);
  const wp = mean(irrIA.map((r) => r.yield155 * 1000)) / (mean(irrIA.map((r) => r.supply)) - 100);
  const wpEt = mean(irrIA.map((r) => r.yield155 * 1000)) / (mean(irrIA.map((r) => r.et)) - 100);
  return [
    {
      name: "Irrigated maize yield, central Nebraska",
      model: mean(irrNE.map((r) => r.yield155)),
      low: 14.4, high: 15.4, unit: "t/ha at 15.5% moisture",
      source: "Hybrid-Maize simulated yield potential for the western Corn Belt, about 14.4 to 15.4 t/ha (Grassini et al.; Yang et al.)",
    },
    {
      name: "Aboveground biomass at maturity, irrigated",
      model: mean(irrIA.map((r) => r.aboveground)),
      low: 2257, high: 2916, unit: "g/m²",
      source: "Measured under optimal growth in Nebraska, 1998 to 2001 (Lindquist et al. 2005)",
    },
    {
      name: "Radiation use efficiency before silking",
      model: mean(irrIA.map((r) => r.vegRue)),
      low: 3.74 * 0.85, high: 3.84 * 0.85, unit: "g per MJ of intercepted PAR",
      source: "3.74 to 3.84 g per MJ of absorbed PAR (Lindquist et al. 2005), taking absorbed as 85% of intercepted",
      note: "the 85% is an assumption",
    },
    {
      name: "Water productivity of irrigated maize, per mm of rain and irrigation",
      model: wp,
      low: 19.3, high: 27.7, unit: "kg grain per ha per mm of supply above 100 mm",
      source: "Mean 19.3 and upper boundary 27.7 for irrigated maize in Nebraska (Grassini and Cassman, 2010)",
      note: "above the boundary when only rain and irrigation count, which ignores the soil water the crop starts with",
    },
    {
      name: "Water productivity of irrigated maize, per mm of water used (evaporation plus transpiration)",
      model: wpEt,
      low: 19.3, high: 27.7, unit: "kg grain per ha per mm above 100 mm",
      source: "Same benchmark (Grassini and Cassman, 2010)",
      note: "which of the two the benchmark's 'water supply' matches is not settled here, so both are shown",
    },
    {
      name: "Kernel-set threshold",
      model: maizeDefaults.kernelCgrThreshold / (maizeDefaults.stand?.refPopulation ?? 7.5),
      low: 0.9, high: 1.1, unit: "g per plant per day",
      source: "About 1 g per plant per day for kernel set (Andrade et al. 1999); the model's threshold is set to it",
      note: "set from the paper, not an independent test",
    },
  ];
}

export const rowOk = (r: ComponentRow) => r.model >= r.low && r.model <= r.high;
