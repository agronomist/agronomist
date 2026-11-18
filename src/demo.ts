import { simulate, maizeDefaults, loamDefaults, syntheticWeather } from "./index";

for (const [label, opts] of [
  ["wet", { rainMean: 5, seed: 3 }],
  ["dry", { rainMean: 1.2, seed: 3 }],
] as const) {
  const r = simulate({
    weather: syntheticWeather(opts),
    crop: maizeDefaults,
    soil: loamDefaults,
  });
  const peakLai = Math.max(...r.days.map((d) => d.lai));
  console.log(
    `${label}: matured=${r.matured} days=${r.days.length} yield=${r.yieldTHa.toFixed(1)} t/ha ` +
      `peakLAI=${peakLai.toFixed(1)} T=${r.balance.transpiration.toFixed(0)}mm`,
  );
}
