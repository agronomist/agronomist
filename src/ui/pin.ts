import { fetchClimate, fetchSoilPoint, buildSoilParams, textureClass, loamWithN, type HttpOptions } from "../index";
import { registerLocation, SOUTH_SHIFT, type Location } from "./locations";

export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinError";
  }
}

export const pinKey = (lat: number, lon: number) => `pin_${lat.toFixed(2)}_${lon.toFixed(2)}`;
const GENERIC_ORGANIC_N = loamWithN.layers.reduce((a, l) => a + (l.organicN ?? 0), 0);

const fmtLat = (x: number) => `${Math.abs(x).toFixed(2)}°${x >= 0 ? "N" : "S"}`;
const fmtLon = (x: number) => `${Math.abs(x).toFixed(2)}°${x >= 0 ? "E" : "W"}`;

/**
 * Build a playable location from a dropped pin: ten recent years of Open-Meteo weather fitted to the
 * generator's annual cycle, and SoilGrids layers turned into soil parameters. A pin with no soil data
 * (water, built-up land, a failed request) keeps the real climate and a generic loam, and says so.
 */
/** The US Midwest and the neighbouring plains: where the model is calibrated and offered. */
export const MIDWEST = { latMin: 36, latMax: 49.5, lonMin: -104.5, lonMax: -80.5 };
export const inMidwest = (lat: number, lon: number) => lat >= MIDWEST.latMin && lat <= MIDWEST.latMax && lon >= MIDWEST.lonMin && lon <= MIDWEST.lonMax;

/** Pass `world: true` to allow a pin anywhere (the page does not; tests of the southern hemisphere do). */
export async function loadPin(lat: number, lon: number, o: HttpOptions & { world?: boolean } = {}): Promise<Location> {
  if (!o.world && !inMidwest(lat, lon)) throw new PinError("Pins are limited to the US Midwest for now: between about 36°N and 49.5°N, and 104.5°W to 80.5°W.");
  if (!(Math.abs(lat) <= 66)) {
    throw new PinError("Pins must be between 66°S and 66°N: the model has no polar seasons.");
  }
  const calShift = lat < 0 ? SOUTH_SHIFT : 0;
  if (!(lon >= -180 && lon <= 180)) throw new PinError("Longitude is outside -180 to 180.");
  const [climate, soilTry] = await Promise.all([
    fetchClimate(lat, lon, o, calShift).catch((e) => {
      throw new PinError(`Could not get weather for this point (${e instanceof Error ? e.message : e}).`);
    }),
    fetchSoilPoint(lat, lon, o).then(
      (p) => ({ ok: true as const, p }),
      (e) => ({ ok: false as const, why: e instanceof Error ? e.message : String(e) }),
    ),
  ]);

  const notes: string[] = [];
  let soil: Location["soil"] = { texture: "loam", fieldCapacity: 0.3, wiltingPoint: 0.14, nScale: 1 };
  let soilParams: Location["soilParams"];
  if (soilTry.ok) {
    const sp = buildSoilParams([soilTry.p]);
    soilParams = sp;
    const mm = sp.layers.reduce((a, l) => a + l.thickness, 0);
    const wmean = (f: (l: (typeof sp.layers)[number]) => number) => sp.layers.reduce((a, l) => a + f(l) * l.thickness, 0) / mm;
    const top = soilTry.p.depths.filter((d) => d.bottomCm <= 30);
    const w = (f: (d: (typeof top)[number]) => number) => top.reduce((a, d) => a + f(d) * (d.bottomCm - d.topCm), 0) / 30;
    soil = {
      texture: textureClass(w((d) => d.sandPct), w((d) => d.clayPct)),
      fieldCapacity: wmean((l) => l.fieldCapacity),
      wiltingPoint: wmean((l) => l.wiltingPoint),
      nScale: sp.layers.reduce((a, l) => a + (l.organicN ?? 0), 0) / GENERIC_ORGANIC_N,
    };
  } else {
    notes.push("No soil data for this point (water or built-up land, or the soil service is busy), so a generic loam is used.");
  }
  const loc: Location = {
    key: pinKey(lat, lon),
    name: "Your pin",
    region: `${fmtLat(lat)}, ${fmtLon(lon)}`,
    lat,
    lon,
    climate: {
      tmeanAnnual: climate.tmeanAnnual,
      tmeanAmp: climate.tmeanAmp,
      peakDoy: climate.peakDoy,
      sradMean: climate.sradMean,
      sradAmp: climate.sradAmp,
      rainMean: climate.rainMean,
      rainAmp: climate.rainAmp,
      rainPeakDoy: climate.rainPeakDoy,
    },
    soil,
    soilParams,
    pin: true,
    calShift,
    blurb:
      `Averages for 2015 to 2024 from Open-Meteo at this point${soilTry.ok ? ", soil layers from SoilGrids (about 250 m)" : ""}. ` +
      (calShift ? "Southern hemisphere: seasons and dates are mirrored. " : "") +
      `The seasons you compare come from the real daily weather record at this point. ${notes.join(" ")}`.trim(),
  };
  return registerLocation(loc);
}
