import type { CropParams } from "./types";

/**
 * Derive a hybrid from the base parameters by relative maturity (days; the base is 110).
 * Longer hybrids need more thermal time (so intercept more light and have higher
 * potential kernel number and weight) but flower later and risk frost before black layer.
 * The slopes are PLACEHOLDERS, not fitted to any hybrid set.
 */
export function hybrid(base: CropParams, rm: number): CropParams {
  const d = rm - 110;
  return {
    ...base,
    ttSilking: base.ttSilking + 5.5 * d,
    ttMaturity: base.ttMaturity + 8.5 * d,
    potentialKernelWeight: base.potentialKernelWeight + 0.0008 * d,
    kernelMax: base.kernelMax + 20 * d,
    kernelAsymptote: base.kernelAsymptote === undefined ? undefined : base.kernelAsymptote + 20 * d,
  };
}
