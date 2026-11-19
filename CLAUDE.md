# Agronomist — working notes for Claude Code

Simplified, testable crop model (maize, soybean, wheat) for the US Midwest. Not DSSAT. Live at https://agronomist-psi.vercel.app (Vercel project `agronomist`, team `team_bHkFnVq8WSnIqZEXuSrUwuf4`). Owner: Ariel Zajdband (agronomist and PM).

## Layout
- `src/model.ts`: daily cereal engine (layered water balance, thermal-time phenology, optional structure parameters in `src/types.ts`).
- `src/ui/`: app, decision lab, state check (`state-check.ts`), calibration knobs (`tuning.ts`, `model-run.ts` WATER_DEFAULTS), year types (`year-types.ts`), Three.js scene (`scene-three.ts`).
- `src/data/`: Open-Meteo and NASA POWER fetchers (`power.ts` computes FAO-56 ET0). `api/`: Vercel relays (`om.mjs`, `power.mjs`).
- `scripts/`: `state-check-offline.mts`, `structure-spread.mts`, `calibrate.mts`, `drought-years.mts`; all take a snapshot file.
- `data/snapshot-power-2026-11-19.json.gz`: weather (NASA POWER, 1991 to 2024) and SoilGrids soil for every state point. Run scripts offline with it, e.g. `npx tsx scripts/state-check-offline.mts data/snapshot-power-2026-11-19.json.gz maize`.

## Commands
- `npx tsc --noEmit`, `npx vitest run` (264 tests).
- Build: `node scripts/split-site.mjs dist/site` (dist/site is committed). Deploy: git push, then Vercel `create_deployment` from the pushed sha (forceNew, target production) or the Vercel project's git integration.
- Commit trailers: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Rules
- Never commit or expose the Open-Meteo key. It lives only as Vercel env var `OPEN_METEO_KEY`; the user should rotate it. Do not put any API key in client code or in the repo.
- Opt-in structure options stay off unless real data supports them.
- Standing preferences: briefly suggest altitude, depth and range upgrades plus an outside check on substantive work; no "confidence tier" wording in essays; keep replies short.

## State of the model (Nov 2026)
- State check against NASS state yields (detrended anomalies): maize mean r about 0.37, soy similar, wheat Kansas 0.43. Level gaps in the check are measured against the 2020 trend; the model has no technology trend.
- Changes made from real data: winter wheat frost judged on crown temperature (`frostHardyCrown`); soil 2 m total (`DEEP_LAYER_MM` 1000); autumn start 0.6; state hybrid maturity in the state check (`STATE_RM`, `tuning.stateRm`).
- Tested and left off: VPD, uptake limit (never binds), upward flux, stem reserves, kernel weight cap, root front, two-stage evaporation, ET0 scale (POWER ET0 matches Open-Meteo within 2% in Iowa 2018; `tuning.et0Scale` exists, default 1).
- POWER rain vs Open-Meteo: seasonal totals correlate 0.8 to 0.9, daily 0.7; not the main limit.
- Bad years: the model catches 18 of 37 state-years more than 10% below trend; it misses cool, wet, late-planting years (1993, 1995). Likely fix: observed planting dates.
- Full calibration (14 parameters) overfit and pushed parameters to their bounds: do not adopt.

## Next steps
1. Planting dates: NASS Quick Stats API (free key from the user, set as Vercel env var `NASS_KEY`; never in chat or repo). Add a relay in `api/`, fill `OBSERVED_SOW` in `src/ui/planting.ts`, rerun the state check.
2. Why 1993 is not a bad year in the model (cool-season grain fill, planting delay).
3. Wheat outside Kansas (soft red winter wheat, Nebraska/Illinois/Indiana/Ohio): level gaps of 50 to 80%.
4. Johnston, Iowa 1988 check needs weather before 1992 (Open-Meteo archive).
5. Phone check of the WebGL field view; remaining water ideas (tile drainage, canopy interception).
