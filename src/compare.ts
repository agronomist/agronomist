/**
 * Comparison harness stub for DSSAT benchmarking.
 *
 * Parses a DSSAT daily output table (e.g. PlantGro.OUT): whitespace-separated
 * columns, header line starting with "@", data lines after it. Then computes
 * agreement statistics between observed/DSSAT and model series.
 */
export function parseDssatTable(text: string): Record<string, number[]> {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith("@"));
  if (headerIdx < 0) throw new Error("No '@' header line found");
  const cols = lines[headerIdx]!.replace(/^@/, "").trim().split(/\s+/);
  const out: Record<string, number[]> = Object.fromEntries(cols.map((c) => [c, []]));
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim() || line.startsWith("*") || line.startsWith("@")) continue;
    const vals = line.trim().split(/\s+/).map(Number);
    if (vals.length !== cols.length || vals.some(Number.isNaN)) continue;
    cols.forEach((c, i) => out[c]!.push(vals[i]!));
  }
  return out;
}

export interface Agreement {
  n: number;
  rmse: number;
  bias: number; // mean(model - reference)
  /** Willmott's index of agreement (1 = perfect) */
  d: number;
}

export function agreement(reference: number[], model: number[]): Agreement {
  const n = Math.min(reference.length, model.length);
  if (n === 0) throw new Error("Empty series");
  const mean = reference.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let se = 0;
  let bias = 0;
  let denom = 0;
  for (let i = 0; i < n; i++) {
    const diff = model[i]! - reference[i]!;
    se += diff * diff;
    bias += diff;
    denom += (Math.abs(model[i]! - mean) + Math.abs(reference[i]! - mean)) ** 2;
  }
  return { n, rmse: Math.sqrt(se / n), bias: bias / n, d: denom > 0 ? 1 - se / denom : 1 };
}
