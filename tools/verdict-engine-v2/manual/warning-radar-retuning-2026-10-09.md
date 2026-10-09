# Warning Radar retuning — 2026-10-09 (first measurement pass)

His order: the Warning Radar must get measurably more effective —
down-weight/drop warning factors that never precede declines, only via
transparent, backtested changes. This document is the full record of the
method, the decision rule, and the before/after metrics.

## Why a retrospective, not the live ledger

The live ledger (`data/warning-ledger.json`) is too young for
factor-effectiveness measurement: 23 warnings issued (first batch
2026-10-08), all still OPEN (a warning needs 20 sessions to resolve).
So the measurement instrument is `tools/measure-warning-radar.js`: it
replays the CURRENT engine over truncated history and scores warnings with
the exact outcome definitions the live tracker uses:

- HIT: min close-to-close return within 20 sessions <= -10%
- FALSE_POSITIVE: 20 sessions elapsed, close >= +5% vs warning close,
  and the stock never drew down 10%
- NEUTRAL: 20 sessions elapsed, neither of the above

## Method (identical for before and after)

- Tool: `node tools/measure-warning-radar.js --step 10
  --out <file>` with `V2_MIRROR=/home/hatch/workspace/v2-mirror`
- Eval dates: every 10th trading session, 2026-01-05 to 2026-09-10
  (17 dates; the last date needs 20 forward sessions inside the mirror)
- Universe: all mirror symbols with ≥30 sessions, minus present-day
  non-equity classification; price-only engine inputs (dossier=null,
  fundamentals=null — never scored live either; regime recomputed from
  index history truncated at each eval date)
- Before: engine at rules.js PUMP_WEIGHTS
  {EXHAUSTION 0.20, PARABOLIC 0.13, DIST_VOLUME 0.22, CLIMAX 0.10,
   WINNER_FADE 0.25, LATE_CIRCUIT_FADE 0.10}, DISTRIBUTION via
  pump_score ≥ 0.60 OR ≥2 bearish flags
- Experiment A: only PUMP_WEIGHTS changed (re-ranked); cutoffs untouched
- Experiment B: weights restored; only the DISTRIBUTION gate changed
  (≥2-flag shortcut removed); cutoffs untouched

## Decision rule (stated BEFORE tuning)

With ≥30 retrospective warnings, a scored bearish factor with
hit_rate < 35% is down-weighted. No factor is dropped unless its hit
rate is < 10% with ≥30 warnings — none met this bar (every factor
preceded declines in ≥30% of its warnings), so nothing was dropped.

## Baseline (BEFORE) — 2026-10-09

400 warnings, 396 resolved, 145 hits, 32 false positives, 219 neutral.
Precision 36.6%, false-positive rate 8.1%.

| Flag (bearish)   | weight | warnings | hits | hit_rate |
|------------------|--------|----------|------|----------|
| EXHAUSTION       | 0.20   | 70       | 41   | 58.6%    |
| PARABOLIC        | 0.13   | 80       | 43   | 53.8%    |
| CLIMAX           | 0.10   | 196      | 68   | 34.7%    |
| WINNER_FADE      | 0.25   | 307      | 103  | 33.6%    |
| DIST_VOLUME      | 0.22   | 120      | 36   | 30.0%    |
| LATE_CIRCUIT_FADE| 0.10   | 0        | 0    | —        |

Reading: the two highest-weighted flags (WINNER_FADE 0.25, DIST_VOLUME
0.22 — upweighted per universe-report §6 rule 4 on per-symbol IC) are the
two weakest measured. EXHAUSTION (58.6%) and PARABOLIC (53.8%) are the
strongest but carry mid weights. LATE_CIRCUIT_FADE never fired in the
window — kept unchanged (no evidence either way).

By verdict (before): DISTRIBUTION_WARNING 326 warnings / 31.9% precision;
EXHAUSTION_RISK 70 / 58.6%; ELEVATED_RISK 4 / 0% (n too small to read).

## Experiment A — weight re-ranking (REJECTED by its own backtest)

Hypothesis: re-rank PUMP_WEIGHTS to measured factor effectiveness
(EXHAUSTION 0.20→0.24, PARABOLIC 0.13→0.16, DIST_VOLUME 0.22→0.14,
CLIMAX 0.10→0.14, WINNER_FADE 0.25→0.22, LATE_CIRCUIT_FADE 0.10 unchanged).

Result (same 17 eval dates): warnings 400→632, precision 36.6%→29.2%,
false-positive rate 8.1%→10.3%. ELEVATED_RISK exploded 4→236 warnings at
13.1% precision.

Mechanism (understood, not hand-waved): pump_score = activeW/eligibleW,
and eligibleW SHRINKS in gated regimes (bull-only flags score off in
sideways/bear markets). Raising CLIMAX's weight meant CLIMAX-alone now
scores 0.14/0.36 = 0.39 ≥ 0.35 in gated regimes → floods of weak
ELEVATED_RISK warnings. Re-ranking weights without modeling the
denominator dynamics was the error.

Decision: REVERTED. rules.js PUMP_WEIGHTS restored to the research-cited
values. Per the standing rule ("only transparent, backtested changes"),
a change that degrades measured precision does not ship — the negative
result is recorded here instead of buried.

## Experiment B — score-only DISTRIBUTION gate (under measurement)

Observation from the baseline: DISTRIBUTION_WARNING fires at 31.9%
precision (n=326) while EXHAUSTION_RISK fires at 58.6% (n=70). The
difference: DISTRIBUTION also triggers on a ≥2-bearish-flags COUNT
shortcut, letting two weak flags (CLIMAX+WINNER_FADE ≈ 0.35, measured
hit rates ~34%) reach the top warning tier without a strong score.

Change (engine.js labelVerdict, marked RULE-14 EXPERIMENT): the
≥2-flag shortcut is removed; DISTRIBUTION_WARNING now requires
pump_score ≥ 0.60 only. The score already encodes flag strength via
PUMP_WEIGHTS, so this is a strictness change, not a reweighting.

Ship criterion: retrospective precision must improve vs the 36.6%
baseline WITHOUT the warning count collapsing to a trivial handful.
Otherwise revert.

Result (same 17 eval dates): 396 warnings, precision 36.6%→36.7%,
false-positive rate 8.1%→8.2%. DISTRIBUTION_WARNING precision did rise
31.9%→34.2% (326→243 warnings) — but the demoted warnings landed in
ELEVATED_RISK (4→83 warnings @ 24.1%), netting to noise overall.

Decision: REVERTED. +0.1pp is not a measurable improvement.

## Experiment C — exp B + ELEVATED_RISK cutoff 0.40 (REJECTED)

Same as B, plus the ELEVATED_RISK cutoff raised 0.35 → 0.40, demoting
the weakest score band to NEUTRAL.

Result: 351 warnings, precision 36.6%→38.3% (+1.7pp), false-positive
rate 8.1%→8.9%. By verdict: DISTRIBUTION 243 @ 34.2%, EXHAUSTION_RISK
70 @ 58.6%, ELEVATED_RISK 38 @ 23.7%.

Statistical check: the +1.7pp move is ~0.5 standard errors
(SE ≈ 3.6pp for these n) — NOT significant. The DISTRIBUTION-tier
+2.3pp is likewise < 0.6 SE. Directionally "stricter = slightly more
precise," but nothing here clears "measurably more effective."

Decision: REVERTED. engine.js restored to the research-cited logic.

## Final verdict (2026-10-09)

No engine-behavior change ships. Findings:

1. NO warning factor "never precedes declines." Weakest measured bearish
   factor: DIST_VOLUME, 30.0% hit rate (n=120). Nothing meets the
   <10%-with-n≥30 bar for dropping.
2. The current calibration (precision 36.6%, FP rate 8.1% on 396 resolved
   retrospective warnings) is not beaten by any tested variant.
3. What DOES ship as strengthening (this commit):
   - the missing daily pipeline scripts onto main, so the 16:00 cron
     actually runs (warnings regenerate daily, ledger grows);
   - `engine_weights_version` + `pump_weights` provenance in every
     track-record rebuild, so future metrics are attributable;
   - this document + `tools/measure-warning-radar.js` as the standing
     retuning instrument.
4. The live ledger is the future arbiter: once it holds resolved
   warnings, re-run this exact method against LIVE (dossier-aware)
   outcomes. If the live ledger disagrees with the retrospective
   ranking, the live ledger wins.

## Results table — all experiments (same 17 eval dates)

| metric            | baseline | exp A (reweight) | exp B (score-only DIST) | exp C (B + ELEV 0.40) |
|-------------------|----------|------------------|-------------------------|-----------------------|
| warnings issued   | 400      | 632              | 396                     | 351                   |
| resolved          | 396      | 603              | 392                     | 347                   |
| precision         | 36.6%    | 29.2%            | 36.7%                   | 38.3%                 |
| false-positive rt | 8.1%     | 10.3%            | 8.2%                    | 8.9%                  |
| shipped?          | —        | NO (worse)       | NO (noise)              | NO (not significant)  |

Raw outputs: /tmp/wr-retro-baseline.json, /tmp/wr-retro-after.json
(rejected exp A), /tmp/wr-retro-expb.json, /tmp/wr-retro-expc.json.

## Honest limitations

- Price-only retrospective: no sector multiplier, no float/promoter
  data, age = bar count. Sector-gated factors behave slightly differently
  live than in the retro.
- Regime recomputed from truncated index history at each eval date —
  matches the engine's own regime logic, but index history revisions
  would shift some dates.
- Measures the CURRENT engine on past data (the right question for "is
  the current engine effective"), not historical engine versions.
- 17 eval dates is thin for the rarest flags (LATE_CIRCUIT_FADE n=0,
  ELEVATED_RISK n=4) — no conclusions drawn for them.
- This is ONE retuning pass. If the live ledger, once mature, disagrees
  with the retrospective ranking, the live ledger wins.
