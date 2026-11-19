import { loamWithN, type SeasonalOptions, type SoilParams } from "../index";

/**
 * Field locations. Climate values are rounded long-term normals for the area, fed to the synthetic weather
 * generator (one smooth annual cycle plus daily noise), so they set the character of a place, not its exact weather.
 * Soils are generic textures with plausible water holding, not mapped soil data. The place list covers the US Midwest; a few other places stay in the code (marked hidden) for tests.
 */
export interface Location {
  key: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  climate: Required<Pick<SeasonalOptions, "tmeanAnnual" | "tmeanAmp" | "sradMean" | "sradAmp" | "rainMean">> & { peakDoy?: number; rainAmp?: number; rainPeakDoy?: number };
  soil: { texture: string; fieldCapacity: number; wiltingPoint: number; nScale: number };
  /** Layered soil from SoilGrids; when present it replaces the uniform soil built from `soil`. */
  soilParams?: SoilParams;
  blurb: string;
  /** True for a location the player dropped on the map. */
  pin?: boolean;
  /** True for the test field, which has no real weather record: its years are always synthetic. */
  synthetic?: boolean;
  /** Kept for tests and comparisons but not offered in the place list (outside the US Midwest). */
  hidden?: boolean;
  /**
   * Days between the model's northern calendar and this place's real calendar (0 in the north, SOUTH_SHIFT in the
   * south). Southern climates are fitted on the shifted record, the model runs at |latitude| (day length is mirrored),
   * and dates are shifted back for display.
   */
  calShift?: number;
}

export const LOCATIONS: Location[] = [
  {
    key: "iowa", name: "Central Iowa", region: "USA", lat: 42, lon: -93.6,
    climate: { tmeanAnnual: 9.5, tmeanAmp: 14.5, sradMean: 14.5, sradAmp: 8, rainMean: 2.6, rainAmp: 0.4, rainPeakDoy: 170 },
    soil: { texture: "deep silt loam", fieldCapacity: 0.33, wiltingPoint: 0.13, nScale: 1.3 },
    blurb: "The classic Corn Belt: cold winters, warm humid summers, deep fertile soil that stores a lot of water.",
  },
  {
    key: "kansas", name: "Central Kansas", region: "USA", lat: 38.5, lon: -98,
    climate: { tmeanAnnual: 13, tmeanAmp: 13.5, sradMean: 16.5, sradAmp: 7.5, rainMean: 2.0, rainAmp: 0.45, rainPeakDoy: 160 },
    soil: { texture: "silt loam", fieldCapacity: 0.3, wiltingPoint: 0.14, nScale: 1 },
    blurb: "The Hard Red Winter wheat heartland: hot summers, drier than Iowa, and spring freezes that can catch early crops.",
  },
  {
    key: "nebraska", name: "Nebraska, sandy ground", region: "USA", lat: 41, lon: -100.5,
    climate: { tmeanAnnual: 10.5, tmeanAmp: 14, sradMean: 15.5, sradAmp: 7.5, rainMean: 1.9, rainAmp: 0.5, rainPeakDoy: 165 },
    soil: { texture: "sandy loam", fieldCapacity: 0.2, wiltingPoint: 0.08, nScale: 0.6 },
    blurb: "Sandy soil holds little water and lets nitrogen wash through, so droughts bite sooner and nitrogen timing matters.",
  },
  {
    key: "illinois",
    name: "Central Illinois",
    region: "Illinois",
    lat: 40.1,
    lon: -88.2,
    climate: { tmeanAnnual: 11, tmeanAmp: 14.5, sradMean: 14.5, sradAmp: 8, rainMean: 2.6, rainAmp: 0.35, rainPeakDoy: 150 },
    soil: { texture: "deep silty clay loam", fieldCapacity: 0.34, wiltingPoint: 0.14, nScale: 1.4 },
    blurb: "Some of the deepest, darkest prairie soil in the Corn Belt: high organic matter, plenty of stored water, and a warm, humid summer.",
  },
  {
    key: "indiana",
    name: "Central Indiana",
    region: "Indiana",
    lat: 40.4,
    lon: -86.9,
    climate: { tmeanAnnual: 10.5, tmeanAmp: 14, sradMean: 14, sradAmp: 8, rainMean: 2.7, rainAmp: 0.25, rainPeakDoy: 150 },
    soil: { texture: "silt loam", fieldCapacity: 0.32, wiltingPoint: 0.14, nScale: 1.1 },
    blurb: "Rainfall is fairly even through the year, soils are productive but a little less deep than Illinois, and wet springs can delay sowing.",
  },
  {
    key: "minnesota",
    name: "Southern Minnesota",
    region: "Minnesota",
    lat: 44.1,
    lon: -94,
    climate: { tmeanAnnual: 7.5, tmeanAmp: 16, sradMean: 14, sradAmp: 8.5, rainMean: 2.4, rainAmp: 0.45, rainPeakDoy: 165 },
    soil: { texture: "clay loam", fieldCapacity: 0.33, wiltingPoint: 0.14, nScale: 1.4 },
    blurb: "A shorter, cooler season than Iowa, with good water-holding soil. Frost on either end of the season is a real constraint on maturity.",
  },
  {
    key: "ohio",
    name: "Northwest Ohio",
    region: "Ohio",
    lat: 40.8,
    lon: -83.8,
    climate: { tmeanAnnual: 10.5, tmeanAmp: 13.5, sradMean: 13.5, sradAmp: 7.5, rainMean: 2.7, rainAmp: 0.15, rainPeakDoy: 150 },
    soil: { texture: "clay loam, slow to drain", fieldCapacity: 0.33, wiltingPoint: 0.17, nScale: 1 },
    blurb: "Heavy, slow-draining soil and steady rain. Water is rarely short, but a wet spring delays sowing and pushes it into a hot, short season.",
  },
  {
    key: "missouri",
    name: "Central Missouri",
    region: "Missouri",
    lat: 39,
    lon: -92.3,
    climate: { tmeanAnnual: 12.5, tmeanAmp: 13.5, sradMean: 14.5, sradAmp: 7.5, rainMean: 2.9, rainAmp: 0.25, rainPeakDoy: 140 },
    soil: { texture: "silt loam over a clay pan", fieldCapacity: 0.3, wiltingPoint: 0.15, nScale: 0.9 },
    blurb: "A warm, long season, but a clay layer limits rooting depth, so crops here run out of water in a dry July sooner than in Iowa.",
  },
  {
    key: "dakota-s",
    name: "Eastern South Dakota",
    region: "South Dakota",
    lat: 44.3,
    lon: -97.5,
    climate: { tmeanAnnual: 7.5, tmeanAmp: 16.5, sradMean: 15, sradAmp: 8, rainMean: 1.8, rainAmp: 0.55, rainPeakDoy: 165 },
    soil: { texture: "silt loam", fieldCapacity: 0.31, wiltingPoint: 0.14, nScale: 1.1 },
    blurb: "The drier, cooler western edge of the Corn Belt. Rain is concentrated in early summer, so stored water and sowing date matter.",
  },
  {
    key: "dakota-n",
    name: "Eastern North Dakota",
    region: "North Dakota",
    lat: 47,
    lon: -97,
    climate: { tmeanAnnual: 4.5, tmeanAmp: 17.5, sradMean: 14, sradAmp: 9, rainMean: 1.4, rainAmp: 0.6, rainPeakDoy: 175 },
    soil: { texture: "clay loam", fieldCapacity: 0.32, wiltingPoint: 0.15, nScale: 1.2 },
    blurb: "Long summer days, a short frost-free season and a dry-ish climate: spring wheat and early soybeans country, and a stretch for corn.",
  },
  {
    key: "po",
    hidden: true, name: "Po Valley", region: "Italy", lat: 45.1, lon: 10.8,
    climate: { tmeanAnnual: 13, tmeanAmp: 12, sradMean: 13.5, sradAmp: 8, rainMean: 2.3, rainAmp: 0.15, rainPeakDoy: 130 },
    soil: { texture: "clay loam", fieldCapacity: 0.34, wiltingPoint: 0.15, nScale: 1.1 },
    blurb: "Mild winters, hot humid summers and heavy soil, one of Europe's main maize and wheat areas.",
  },
  {
    key: "saskatchewan",
    hidden: true, name: "Saskatchewan prairies", region: "Canada", lat: 52, lon: -106,
    climate: { tmeanAnnual: 2.5, tmeanAmp: 17, sradMean: 13.5, sradAmp: 9, rainMean: 1.2, rainAmp: 0.6, rainPeakDoy: 180 },
    soil: { texture: "clay loam", fieldCapacity: 0.32, wiltingPoint: 0.15, nScale: 1.2 },
    blurb: "Very cold winters and a short summer with long days: spring wheat country, and a hard place for maize or winter types.",
  },
  {
    key: "generic", name: "Generic test field", region: "synthetic", lat: 40, lon: 0, synthetic: true,
    climate: { tmeanAnnual: 11, tmeanAmp: 13, sradMean: 15, sradAmp: 7, rainMean: 3 },
    soil: { texture: "loam", fieldCapacity: 0.3, wiltingPoint: 0.14, nScale: 1 },
    blurb: "The original placeholder site used in the model tests.",
  },
];

export const SOUTH_SHIFT = 182;
export const DEFAULT_LOCATION = "iowa";
const custom = new Map<string, Location>();
/** Make a map-pin location available to locationByKey (the model code looks locations up by key). */
export function registerLocation(loc: Location): Location {
  custom.set(loc.key, loc);
  return loc;
}
export const locationByKey = (k: string): Location => custom.get(k) ?? LOCATIONS.find((l) => l.key === k) ?? LOCATIONS[0]!;

/** Thickness of the extra deep layer added below the mapped metre, mm. Roots of maize and wheat reach 1.5 m or more where the soil allows. */
export const DEEP_LAYER_MM = 1000;

/** Add a deep layer with the texture of the deepest mapped one (no organic N; nitrate leached from above can still be taken up). */
function deepen(sp: SoilParams): SoilParams {
  const last = sp.layers[sp.layers.length - 1]!;
  return { ...sp, layers: [...sp.layers, { thickness: DEEP_LAYER_MM, fieldCapacity: last.fieldCapacity, wiltingPoint: last.wiltingPoint, organicN: 0, mineralN: 4 }] };
}

/**
 * Share of plant-available water in the profile at sowing. The model starts on the sowing day, so it cannot see the
 * winter and spring before it; wetter climates start fuller (about 0.9 at 950 mm of rain a year, 0.7 at 450 mm).
 */
export const startFraction = (loc: Location) => Math.min(0.9, Math.max(0.55, 0.45 + (loc.climate.rainMean * 365) / 2000));

/** Six-layer soil for a location: the same five layers and N pools as the default loam (organic N scaled), plus a deep layer. */
export function soilFor(loc: Location): SoilParams {
  if (loc.soilParams) return deepen({ ...loc.soilParams, initialFraction: startFraction(loc) });
  return deepen({
    ...loamWithN,
    initialFraction: startFraction(loc),
    layers: loamWithN.layers.map((l) => ({
      ...l,
      fieldCapacity: loc.soil.fieldCapacity,
      wiltingPoint: loc.soil.wiltingPoint,
      organicN: (l.organicN ?? 0) * loc.soil.nScale,
    })),
  });
}

/** Plant-available water in the top 1 m, mm. */
export function availableWaterMm(loc: Location): number {
  if (loc.soilParams) return loc.soilParams.layers.reduce((a, l) => a + (l.fieldCapacity - l.wiltingPoint) * l.thickness, 0);
  return (loc.soil.fieldCapacity - loc.soil.wiltingPoint) * 1000;
}

export function climateFacts(loc: Location): { jan: number; jul: number; rainMm: number } {
  const c = loc.climate;
  const at = (doy: number) => c.tmeanAnnual + c.tmeanAmp * Math.cos((2 * Math.PI * (doy - (c.peakDoy ?? 200))) / 365);
  const s = loc.calShift ?? 0; // real mid-January and mid-July, in model days
  return { jan: at(15 + s), jul: at(196 + s), rainMm: c.rainMean * 365 };
}
