import { seasonalWeather, type WeatherDay } from "../index";
import type { CropConfig } from "./crops";
import type { Location } from "./locations";

/** One season of weather for the ensemble. `label` is the harvest year for real seasons, or the draw number for synthetic ones. */
export interface EnsembleYear {
  label: number;
  weather: WeatherDay[];
}

export interface Ensemble {
  source: "real" | "synthetic";
  years: EnsembleYear[];
  /** Short plain-language note for the page, e.g. why synthetic years are used. */
  note: string;
  /** Present when this season is already under way and the days so far are real. */
  inSeason?: { label: number; through: string; observedDays: number };
}

/**
 * Weather of the months before a season's first model day (real seasons only), kept beside the season's array so every function that is handed
 * the array can start the soil from the water that weather left. Looked up by array identity, so slices carry nothing.
 */
const PRE = new WeakMap<WeatherDay[], WeatherDay[]>();
export const tagPre = (season: WeatherDay[], pre: WeatherDay[]): WeatherDay[] => (PRE.set(season, pre), season);
export const preOf = (season: WeatherDay[]): WeatherDay[] | undefined => PRE.get(season);

const synth = new Map<string, WeatherDay[]>();

/** A synthetic year from the generator: the location's climate normals plus a scenario's hazards, drawn with `seed`. */
export function syntheticYear(cfg: CropConfig, scenario: string, seed: number, loc: Location): WeatherDay[] {
  const k = `${cfg.key}:${loc.key}:${scenario}:${seed}`;
  let y = synth.get(k);
  if (!y) {
    const sc = cfg.scenarios[scenario] ?? cfg.scenarios.typical!;
    y = seasonalWeather({
      startDoy: cfg.yearStart,
      days: cfg.yearDays,
      seed,
      ...loc.climate,
      tmeanAnnual: loc.climate.tmeanAnnual + (sc.tempShift ?? 0),
      rainMean: loc.climate.rainMean * (sc.rainFactor ?? 1),
      ...sc.opts,
    });
    synth.set(k, y);
  }
  return y;
}

// The active ensemble for each crop and location, so the viewer can play any of its years.
const registry = new Map<string, Ensemble>();
const rkey = (crop: string, loc: string) => `${crop}:${loc}`;
export const registerEnsemble = (crop: string, loc: string, e: Ensemble | null) => {
  if (e) registry.set(rkey(crop, loc), e);
  else registry.delete(rkey(crop, loc));
};
export const getEnsemble = (crop: string, loc: string): Ensemble | undefined => registry.get(rkey(crop, loc));

/** Scenario keys of the form "y2012" pick a year from the registered ensemble. */
export const yearScenario = (label: number) => `y${label}`;
export const isYearScenario = (s: string) => /^y\d+$/.test(s);

/**
 * The weather the viewer plays for a scenario: a year of the active ensemble ("y2012"), or a synthetic stress
 * test ("hazard", "freeze") drawn from the location's normals.
 */
export function yearWeather(cfg: CropConfig, scenario: string, seed: number, loc: Location): WeatherDay[] {
  if (isYearScenario(scenario)) {
    const hit = getEnsemble(cfg.key, loc.key)?.years.find((y) => y.label === Number(scenario.slice(1)));
    if (hit) return hit.weather;
    scenario = "typical";
  }
  return syntheticYear(cfg, scenario, seed, loc);
}
