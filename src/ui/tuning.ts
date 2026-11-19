/**
 * The hand-set numbers the state check depends on, gathered in one place so a calibration run can move them.
 * The app never changes them; defaults are the values in use.
 */
export const DEFAULT_TUNING = { delayPerMm: 0.12, delayPerDegC: 2.5, wetScale: 1, wtScale: 1, irrScale: 1, et0Scale: 1 };
export type Tuning = typeof DEFAULT_TUNING;
export const tuning: Tuning = { ...DEFAULT_TUNING };
export const setTuning = (t: Partial<Tuning>) => void Object.assign(tuning, DEFAULT_TUNING, t);
