import type { CropKey } from "./crops";

/**
 * How each Midwest state is represented when the model is compared with a state average.
 *
 * A state is not one field, so each is a few points weighted by roughly how much of its crop grows around them, and the
 * share of land that is irrigated or poorly drained without tile is run separately and added back in proportion.
 *
 * What is solid and what is not:
 *  - `tile` (share of cropland drained by tile, 2017 Census of Agriculture, via farmdoc daily): Iowa 53, Indiana 49, Ohio 49, Illinois 39,
 *    Minnesota 37 percent; the other states are below 10. It is recorded for the page, but it is not a model input.
 *  - `untiledWet` (share of cropland that is naturally poorly drained and has no tile) is NOT measured. It is a hand estimate:
 *    tile has gone mostly onto poorly drained land, so what remains is small, and it is the one free number in the drainage correction.
 *  - Irrigation: Kansas corn was about 37 percent irrigated in 2013 (Kansas Corn Growers, producing 57 percent of the crop). Nebraska
 *    has about 8 million irrigated acres (2022 Census) and corn there is roughly 60 percent irrigated; that figure, the point-by-point split
 *    and every other state's share are estimates, not Census numbers.
 *  - `shallowWT` (soils whose water table reaches the root zone in dry spells) is a hand estimate. Rizzo et al. 2018 found shallow water tables raised regional maize production by about 6 percent, and by 24 percent in severe drought years; the water table setup (depth, sinking rate, daily rise) was chosen so these shares give a lift of that order, which is a loose check and not a fit.
 *  - Point locations and weights are approximate: crop-district centres, not county-by-county acreage.
 */
export interface StatePoint {
  name: string;
  lat: number;
  lon: number;
  /** Weight of this point in the state average (the weights of a state sum to 1). */
  w: number;
  /** Share of corn here that is irrigated. Soybeans use 0.8 of it and wheat 0.06 of it. */
  irrCorn: number;
}
export interface StateProfile {
  state: string;
  /** Preset used for the soil when SoilGrids has nothing for a point. */
  location: string;
  points: StatePoint[];
  tile: number;
  untiledWet: number;
  /** Share of cropland on soils with a water table that rises into the root zone in dry spells. An ESTIMATE; Rizzo et al. 2018 mapped it for the Corn Belt but these shares are not read from that map. */
  shallowWT: number;
}

export const IRR_FACTOR: Record<CropKey, number> = { maize: 1, soy: 0.8, wheat: 0.06 };

export const STATE_PROFILES: StateProfile[] = [
  { state: "Iowa", location: "iowa", tile: 0.53, untiledWet: 0.06, shallowWT: 0.3, points: [
    { name: "northwest", lat: 42.8, lon: -95.8, w: 0.3, irrCorn: 0.01 },
    { name: "north central", lat: 42.4, lon: -93.6, w: 0.4, irrCorn: 0.01 },
    { name: "east", lat: 41.5, lon: -91.4, w: 0.3, irrCorn: 0.02 },
  ] },
  { state: "Illinois", location: "illinois", tile: 0.39, untiledWet: 0.12, shallowWT: 0.25, points: [
    { name: "north", lat: 41.8, lon: -89.0, w: 0.35, irrCorn: 0.03 },
    { name: "central", lat: 40.3, lon: -88.8, w: 0.45, irrCorn: 0.02 },
    { name: "south", lat: 38.6, lon: -89.3, w: 0.2, irrCorn: 0.04 },
  ] },
  { state: "Indiana", location: "indiana", tile: 0.49, untiledWet: 0.12, shallowWT: 0.25, points: [
    { name: "north", lat: 41.3, lon: -86.2, w: 0.35, irrCorn: 0.06 },
    { name: "central", lat: 40.2, lon: -86.2, w: 0.4, irrCorn: 0.02 },
    { name: "south", lat: 38.7, lon: -86.6, w: 0.25, irrCorn: 0.02 },
  ] },
  { state: "Minnesota", location: "minnesota", tile: 0.37, untiledWet: 0.1, shallowWT: 0.3, points: [
    { name: "south", lat: 43.8, lon: -94.5, w: 0.5, irrCorn: 0.02 },
    { name: "west", lat: 45.5, lon: -95.8, w: 0.3, irrCorn: 0.05 },
    { name: "northwest", lat: 47.5, lon: -96.4, w: 0.2, irrCorn: 0.02 },
  ] },
  { state: "Nebraska", location: "nebraska", tile: 0.02, untiledWet: 0.02, shallowWT: 0.15, points: [
    { name: "east", lat: 41.2, lon: -96.6, w: 0.35, irrCorn: 0.25 },
    { name: "central", lat: 40.8, lon: -98.9, w: 0.4, irrCorn: 0.7 },
    { name: "west", lat: 41.1, lon: -101.5, w: 0.25, irrCorn: 0.85 },
  ] },
  { state: "Ohio", location: "ohio", tile: 0.49, untiledWet: 0.2, shallowWT: 0.15, points: [
    { name: "northwest", lat: 41.0, lon: -84.0, w: 0.4, irrCorn: 0.01 },
    { name: "central", lat: 40.2, lon: -83.2, w: 0.35, irrCorn: 0.01 },
    { name: "southwest", lat: 39.4, lon: -83.9, w: 0.25, irrCorn: 0.01 },
  ] },
  { state: "Missouri", location: "missouri", tile: 0.05, untiledWet: 0.25, shallowWT: 0.1, points: [
    { name: "north", lat: 40.1, lon: -93.1, w: 0.4, irrCorn: 0.04 },
    { name: "west", lat: 38.6, lon: -94.0, w: 0.3, irrCorn: 0.03 },
    { name: "southeast", lat: 36.6, lon: -89.7, w: 0.3, irrCorn: 0.45 },
  ] },
  { state: "Kansas", location: "kansas", tile: 0.02, untiledWet: 0.02, shallowWT: 0.05, points: [
    { name: "east", lat: 39.3, lon: -96.3, w: 0.35, irrCorn: 0.03 },
    { name: "central", lat: 38.4, lon: -98.0, w: 0.3, irrCorn: 0.25 },
    { name: "southwest", lat: 37.8, lon: -100.6, w: 0.35, irrCorn: 0.85 },
  ] },
  { state: "South Dakota", location: "dakota-s", tile: 0.03, untiledWet: 0.05, shallowWT: 0.1, points: [
    { name: "east", lat: 44.0, lon: -97.0, w: 0.6, irrCorn: 0.04 },
    { name: "central", lat: 44.5, lon: -99.5, w: 0.25, irrCorn: 0.08 },
    { name: "northeast", lat: 45.5, lon: -97.5, w: 0.15, irrCorn: 0.03 },
  ] },
  { state: "North Dakota", location: "dakota-n", tile: 0.03, untiledWet: 0.1, shallowWT: 0.15, points: [
    { name: "east", lat: 47.0, lon: -97.5, w: 0.5, irrCorn: 0.02 },
    { name: "south central", lat: 46.2, lon: -99.0, w: 0.3, irrCorn: 0.05 },
    { name: "north", lat: 48.5, lon: -98.5, w: 0.2, irrCorn: 0.02 },
  ] },
];
