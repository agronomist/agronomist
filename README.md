# cropmodel

Modular, tested baseline maize growth model in TypeScript. Runs in Node and the browser.

## Status
A **baseline**, not DSSAT and not calibrated. Parameters in `src/defaults.ts` are
generic placeholders. Do not use outputs quantitatively until fitted to field data.

## Structure
- `src/processes.ts` swappable process modules (thermal time, light interception,
  temperature response, growth, reference ET). Override any via `simulate({ processes })`.
- `src/model.ts` daily loop: phenology, single-layer water balance, DVS partitioning.
- `src/compare.ts` DSSAT output parser and agreement statistics (RMSE, bias, Willmott d).
- `test/` conservation (biomass, water), monotonicity and stress-response tests.

## Processes included (v0.2)
Thermal-time phenology with photoperiod (short-day slowdown of the vegetative phase),
Beer-Lambert light interception, gross RUE assimilation minus Q10 maintenance
respiration, DVS partitioning, heat-stress reduction of grain set in a window around
silking, simple CO2 effects (assimilation and transpiration), and a multi-layer
tipping-bucket water balance with root-depth-weighted uptake.
Pass `latitude` and `co2` to `simulate`.

**Nitrogen (v0.3):** enabled when the soil defines `mineralizationRate` (see `loamWithN`);
otherwise N is non-limiting, as before. Includes temperature/moisture-driven
mineralization of an organic N pool, fertilizer applications (`fertilizer: [{day, kgN}]`,
day 0 = sowing), leaching with drainage, uptake limited by demand, daily cap and root
access, and a nitrogen nutrition index (NNI = actual / critical shoot N) that scales
assimilation. Critical N follows a dilution curve (A * W^-B); check coefficients
against the literature before relying on them. Balances close exactly (see tests).

## Critical period, hybrids and timing (v0.5)
- **Kernel number from the critical window.** The window opens `kernelWindowBefore` °C d before silking and closes `kernelWindowAfter` °C d after (about a month). Kernels m-2 = slope * (mean crop growth rate in the window - threshold), capped at `kernelMax`, reduced by heat damage inside the window. Radiation, water, N and temperature enter through the crop growth rate they allow.
- **Sink-limited filling.** After the window closes, grain growth is capped at kernels * potential kernel weight; surplus assimilate goes to stem (mass conserved).
- **Frost.** Tmin <= `frostKillTemp` kills the crop between `frostSeedlingDvs` and `frostSafeDvs`; after black layer it is harmless.
- **`result.criticalPeriod`** reports what the window actually met: dates, mean radiation, mean Tmax, hot days, water stress, N stress, crop growth rate, kernels.
- **`hybrid(base, rm)`** scales thermal time and potential by relative maturity (placeholder slopes).
- **`analyzeTimings`** runs every sowing date x hybrid and returns yield, silking date, window report and `windowConditions` (radiation, temperature, water, N and heat components, 0-1). The score is a transparent feedback heuristic, not part of the crop model.
- **`seasonalWeather`** makes a synthetic annual cycle with optional heat wave and dry spell for experiments.
Kernel slope, threshold, window lengths, hybrid slopes and heat damage rate are PLACEHOLDERS, not fitted.

## Data adapters (v0.4) - `src/data/`
- `openmeteo.ts`: Open-Meteo archive (ERA5-Land, ~10 km) daily weather. Reads the radiation unit from the response, fills gaps up to 3 days, treats missing rain as 0.
- `soilgrids.ts`: SoilGrids v2 point query (0-100 cm, 5 layers). Conversion factors are read from the response (`d_factor`); null values (water/masked areas) raise `SoilDataError`.
- `pedotransfer.ts`: Saxton & Rawls (2006) field capacity / wilting point from sand, clay, organic matter. Verify coefficients against the paper before quantitative use.
- `soil.ts`: median across sample points, organic N (kg/ha) from total N, bulk density and thickness; mineral N is an assumption (SoilGrids has none).
- `field.ts`: drawn polygon validation (self-crossing, size limits), area, centroid, sample points.
- `scenario.ts`: `loadFieldScenario(polygon, {startDate, endDate, fetch})` returns weather + soil + latitude + area, with a soil cache, partial-failure warnings and `SoilUnavailable` for fallback to a preset soil.
All adapters take an injectable `fetch`; tests use synthetic fixtures shaped like the documented responses. They have NOT been run against the live services from this sandbox.
Attribution: Open-Meteo data is CC BY 4.0 (non-commercial use on the free tier); check ISRIC's SoilGrids data policy and cite SoilGrids 2.0 (Poggio et al. 2021).

## Known simplifications (candidates to upgrade)
- N: shoot pool only (no root N, no remobilization to grain, no denitrification/volatilization, single mineral pool for NH4+NO3); NNI affects assimilation but not leaf expansion.
- RUE-based assimilation, not leaf-level photosynthesis; no growth respiration term.
- Root depth is a function of DVS, not of assimilate supply or soil strength.
- No runoff, no capillary rise, no groundwater; soil evaporation only from the top layer.
- CO2, heat and photoperiod parameters are placeholders, not fitted.
- ET0 is Priestley-Taylor with Rn approximated as 0.6 * Rs.

## Next steps (game)
Economics (profit, grain drying), the decision space, the grid-search worker, the two benchmarks (hindsight best and 20-year climatology best), and calibration against real data.

## Earlier next steps
1. Run DSSAT CERES-Maize on a public benchmark experiment, parse PlantGro.OUT with
   `parseDssatTable`, and compare LAI/biomass/yield with `agreement`.
2. Fit placeholder parameters to that data.
3. Replace one process at a time and test on independent data.

## Commands
`npm test`, `npm run demo`

## v0.6: wheat, and a crop-agnostic viewer

- Model: optional vernalization (`vernRequired`, `vernMinFactor`, process `vernalizationRate`), long-day photoperiod (`photoperiodType: "long"`), and stage-dependent frost hardiness (`frostHardyTemp`, `frostSensitiveDvs`). Maize behaviour is unchanged.
- `src/wheat.ts`: placeholder winter and spring wheat parameter sets, `wheatCultivar` (maturity class 95-125). Grain number is set from crop growth rate in the weeks before anthesis (the same critical-window mechanism as maize). Nitrogen dilution curve uses the Justes form (verify before quantitative use).
- Viewer (`src/ui/`): `crops.ts` holds the per-crop config (parameters, weather window, scenarios, labels, search grid), `art-wheat.ts` the wheat plant. Build with `node scripts/build-viewer.mjs`; `dist/site/` is a static two-file version (index.html + app.js) ready for `vercel --prod`.
- Known simplifications: no heat-accelerated senescence after anthesis, no stem-reserve remobilization, synthetic weather, all parameters uncalibrated. Winter wheat sown in spring can still head late in autumn in this model, so the best-choice search only offers habit-appropriate sowing dates.
- 124 tests.
