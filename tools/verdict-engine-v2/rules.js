'use strict';
/* ============================================================================
 * rules.js — Verdict Engine v2: single source of truth for every constant.
 *
 * Every value below is cited to the research document that produced it.
 * Nothing here is tuned by hand; engine-parameterized (non-research) values
 * are marked [ENGINE CHOICE] and documented as such in ENGINE.md.
 *
 * Educational framing: the engine is a WARNING INSTRUMENT (risk/opportunity
 * flags with evidence). It never emits buy/sell calls and never claims to be
 * a market-beating system.
 * ========================================================================= */

/* ----------------------------------------------------------------------------
 * Circuit-limit regime (from factors.js, unchanged).
 * NEPSE price limits: ±10% before 2026-04-20, ±15% from 2026-04-20.
 * ---------------------------------------------------------------------------- */
const CIRCUIT_CUTOVER = 20260420;           // factors.js
const LIMIT_TOLERANCE_CANONICAL = 0.999;     // factors.js circuitCount60 (P5 §5)
const LIMIT_TOLERANCE_IGNITION = 0.995;      // universe-report §6 rule 9 (SYPNL H8:
                                            // genuine circuits print 9.97–10.03%)

/* ----------------------------------------------------------------------------
 * Rule 1 — Circuit age gates.
 * universe-report §6 rule 1 / new-listing-lifecycle §3 (interaction test):
 *   age ≤10  → bullish ignition-continuation (fine-bin ρ +0.287, p<0.0001)
 *   age 11–14 → transition — NO signal (fixed-age ρ: age10 +0.143ns, age15 −0.015)
 *   age ≥15  → bearish exhaustion (ρ −0.327 at 21–30, p<0.0001)
 * Crossover N ≈ 13–15. Both sides clear p<0.01 but rest on 57 listings —
 * do NOT promote to core weight without OOS confirmation (universe-report §7.5).
 * ---------------------------------------------------------------------------- */
const AGE_GATE = {
  IGNITION_MAX: 10,      // age ≤10: bullish ignition weight
  TRANSITION_MIN: 11,    // 11–14: suppressed — no circuit signal
  TRANSITION_MAX: 14,
  EXHAUSTION_MIN: 15,    // age ≥15: bearish exhaustion weight
};

/* ----------------------------------------------------------------------------
 * Rule 2 — Regime gates (market-wide regime from index SMA200).
 * universe-report §6 rule 2 (regime splits): circuit/markup/vol_surge score
 * ONLY in bull regime (they invert sideways). slowbleed_v2 ONLY in bear —
 * and stays experimental, NEVER in the composite score (§6 rule 3).
 * mom20 + turnover_spike are regime-independent (§4 rule 2 of the brief).
 * ---------------------------------------------------------------------------- */
const REGIME_GATES = {
  bull_only:   ['circuit', 'markup_asym', 'vol_surge'],  // scored in bull only
  bear_only:   ['slowbleed_v2'],                          // experimental, never scored
  independent: ['mom20', 'turnover_spike'],              // scored in any regime
};
// Regime values the caller may pass. null = unknown → gated factors are shown
// but NOT scored (honest abstention, not a guess).
const REGIMES = ['bull', 'bear', 'sideways', null];

/* ----------------------------------------------------------------------------
 * Rule 3 — Sector map.
 * universe-report §6 rule 6 (sector splits): Finance + Development Bank →
 * bearish factor weights ×0 (emit CONTRADICTORY_SECTOR note; readings still
 * shown). Hydropower ×0.5 ("expect least from Hydro"). Manufacturing And
 * Processing ×1.0; every other equity sector ×1.0.
 * ---------------------------------------------------------------------------- */
const SECTOR_BEARISH_MULTIPLIER = {
  'Finance': 0,                 // ×0 + CONTRADICTORY_SECTOR note
  'Development Bank': 0,       // ×0 + CONTRADICTORY_SECTOR note
  'Hydropower': 0.5,           // bearish weights halved
  // all others default 1.0 (incl. 'Manufacturing And Processing')
};
const CONTRADICTORY_SECTORS = ['Finance', 'Development Bank'];
const CONTRADICTORY_SECTOR_NOTE =
  'Bearish factor weights set to ×0 for this sector: sector splits show the ' +
  'bearish factors contradict in Finance/Development Bank (universe-report §6 rule 6). ' +
  'Factor readings are shown, not scored.';

/* ----------------------------------------------------------------------------
 * Rule 4 — Instrument gating.
 * analyst-synthesis §3 (6+ workers, independently): Debentures and Mutual
 * Funds break equity factors (NAV/par-pegged tapes; block-cross false
 * positives on f_slowbleed_v2 and f_vol_surge). Promoter-share lines are
 * illiquidity drift. → verdict EXCLUDED_NON_EQUITY, no equity scoring.
 * ---------------------------------------------------------------------------- */
const EXCLUDED_SECTORS = ['Debentures', 'Mutual Funds', 'Promoter Shares'];
const EXCLUDED_NON_EQUITY_REASON =
  'Equity factors do not apply to this instrument type: NAV/par-pegged tapes ' +
  'make momentum/markup meaningless and institutional block crosses trigger ' +
  'false distribution flags (analyst-synthesis §3).';

/* ----------------------------------------------------------------------------
 * Rule 5 — Volume floors (odd-lot artifact guards).
 * analyst-synthesis §4: CORBL "limit-up" on 75 shares; SPL's on 572; UNL's
 * "27.5x surge" = 1,100 shares. Absolute share-count floors, configurable.
 * ---------------------------------------------------------------------------- */
const VOLUME_FLOORS = {
  // A limit-up day counts toward circuit statistics only if volume ≥500
  // shares, EXCEPT listing age ≤10 (withheld-float ignition exemption —
  // genuine ignitions print tiny: analyst-synthesis §4, RSML dossier).
  CIRCUIT_MIN_SHARES: 500,
  CIRCUIT_MIN_SHARES_EXEMPT_AGE: 10,
  // vol_surge requires a 120d median volume ≥1,000 shares (baseline must be
  // a real tape, not odd-lot noise).
  VOL_SURGE_BASELINE_MEDIAN_MIN: 1000,
  // turnover_spike's signal day needs ≥2,000 shares (a "climax" on 1,100
  // shares is an artifact, not a climax).
  TURNOVER_SPIKE_DAY_MIN: 2000,
};

/* ----------------------------------------------------------------------------
 * Rule 6 — Recency decay (stale-window guard).
 * analyst-synthesis §4: f_circuit_n60 holds old circuits months after the last
 * one (MPFL, SKHL, JHAPA) — the window definition must be verified before
 * engine trust. If the most recent limit-up was >30 sessions ago, the circuit
 * exhaustion weight decays ×0.5.
 * ---------------------------------------------------------------------------- */
const RECENCY_DECAY = {
  STALE_AFTER_SESSIONS: 30,
  STALE_WEIGHT_MULT: 0.5,
};

/* ----------------------------------------------------------------------------
 * Rule 7 — Late-circuit fade.
 * analyst-synthesis §4: post-peak limit-ups during bleeds consistently failed
 * (SAIL, RFPL, CITY, SHIVM — SOHL the lone exception). Rule: limit-up within
 * the last 5 sessions AND 20d return < −15% → bearish flag (distribution into
 * weakness).
 * ---------------------------------------------------------------------------- */
const LATE_CIRCUIT_FADE = {
  WINDOW_SESSIONS: 5,
  RETURN_20D_LT: -0.15,
};

/* ----------------------------------------------------------------------------
 * Rule 8 — Hydro cliff note.
 * analyst-synthesis §4: limit-down cliffs on trivial volume (DORDI 4,637;
 * BHL 5,247; KKHC 26,118) — tops break from ABSENT BIDS, not selling
 * pressure. Limit-down on <0.5× median volume → "absent-bids" bearish
 * acceleration note (info-level, not a scored flag).
 * ---------------------------------------------------------------------------- */
const HYDRO_CLIFF = {
  MEDIAN_VOLUME_MULT: 0.5,
  WINDOW_FOR_LIMIT_DOWN: 5,   // limit-down within last 5 sessions
};

/* ----------------------------------------------------------------------------
 * Rule 9 — Event calendar suppressions.
 * analyst-synthesis §4: 2024-03-04 = market-wide dead-volume day (f_turnover_spike
 * minimum across dozens of dossiers — not stock signal); 2026-07-13/14 =
 * cross-debenture institutional rebalance (market-wide block crosses, not
 * single-name distribution). Volume-spike flags (vol_surge, turnover_spike)
 * are suppressed when asof falls on these dates.
 * ---------------------------------------------------------------------------- */
const EVENT_SUPPRESSIONS = [
  { ymd: 20240304, label: 'market-wide dead-volume day', suppress: ['vol_surge', 'turnover_spike'] },
  { ymd: 20260713, label: 'cross-debenture institutional rebalance', suppress: ['vol_surge', 'turnover_spike'] },
  { ymd: 20260714, label: 'cross-debenture institutional rebalance', suppress: ['vol_surge', 'turnover_spike'] },
];

/* ----------------------------------------------------------------------------
 * Rule 11 — Data-quality poison.
 * analyst-synthesis §5: JBLBP's two "+430%/+616% limit-up days" are impossible
 * under any circuit regime (promoter-share pegged scrip). Any |daily return|
 * > 25% → verdict UNRELIABLE; factors not scored.
 * ---------------------------------------------------------------------------- */
const DATA_QUALITY = {
  MAX_ABS_DAILY_RETURN: 0.25,
};

/* ----------------------------------------------------------------------------
 * BOUNCE_SETUP — R7/R8/R9, new-listing-lifecycle §7.
 * R8 (experimental): trough (≥30% drawdown) + first close back above the
 * 5-session high + volume ≥1.5× baseline (demanding the capitulation climax
 * most troughs lack — median trough volume was 0.96×). R9: depth past −50%
 * is a NEGATIVE signal (corr −0.244), scale expectations down, never up.
 * R7: always show base rates WITH the 45% failure rate. Target the median
 * +12% snap; never project 50% reclaims (9% base rate).
 * ---------------------------------------------------------------------------- */
const BOUNCE_SETUP = {
  DRAWDOWN_MIN: 0.30,          // ≥30% drawdown from the listing-run peak
  HIGH_LOOKBACK: 5,            // close back above the 5-session high
  VOLUME_MULT: 1.5,            // volume ≥1.5× baseline
  DEPTH_PENALTY_BEYOND: 0.50,  // past −50%: scale expectations down (R9)
  BASE_RATES: {                // new-listing-lifecycle §7.2 (n=53 new listings)
    BOUNCE_GT10: 0.55,         // 29/53 bounced >10% from trough
    BLEED_OUT: 0.45,           // 24/53 never bounced >10%
    RECLAIM50: 0.09,           // 5/53 reclaimed half the drawdown
    MEDIAN_BOUNCE: 0.12,       // median bounce from trough +12%
    MATURE_BOUNCE_GT10: 0.65,  // mature control (n=131): 65%
    MATURE_RECLAIM50: 0.34,    // mature control: 34%
  },
};

/* ----------------------------------------------------------------------------
 * WITHHELD_FLOAT (info-level note).
 * analyst-synthesis §4: all three 2026 new-listing ignitions (BJHL, SAIL,
 * SOHL) opened on sub-1,000-share days against large paid-up capital.
 * "Large" is engine-parameterized at Rs 1b+ paid-up [ENGINE CHOICE].
 * ---------------------------------------------------------------------------- */
const WITHHELD_FLOAT = {
  MAX_AGE: 60,
  SUB_SHARES: 1000,            // sub-1,000-share days
  PAIDUP_LARGE_MIN: 1.0,        // [ENGINE CHOICE] paidup_b ≥ 1.0 = "large"
};

/* ----------------------------------------------------------------------------
 * Rule 12 — Short-horizon volume lenses (NEW, EXPERIMENTAL).
 * universe-report §6 rule 7 (SYPNL warm-up blindness): turnover_spike (60d),
 * vol_surge (139d) and slowbleed_v2 (179d) were all null through SYPNL's
 * entire 31-session lifecycle — the engine was blind when it mattered most.
 * For age <60 listings: vol_surge_20 (20d turnover vs 60d baseline) and
 * turnover_spike_10 (1d vs 10d median). EXPERIMENTAL, NEVER in core score.
 * ---------------------------------------------------------------------------- */
const SHORT_HORIZON = {
  MAX_AGE: 60,
  VOL_SURGE_20: { RECENT: 20, BASELINE: 60 },   // sum(turnover[-20..]) vs sum([-80..-21])
  TURNOVER_SPIKE_10: { LOOKBACK: 10 },          // turnover_i vs median([-10..-1])
};

/* ----------------------------------------------------------------------------
 * CORNERED_FLOAT — NEW EXPERIMENTAL flag (float-gap closure, 2026-10-05).
 * traded_public_pct (lockin-table.json) measures withheld float directly:
 * SONA 0.62% of 12.3M float traded; VLUCL 0.03% (!). Criterion:
 * traded_public_pct < 1.0% + age ≤ 60 sessions + circuit ignition active →
 * strengthens the IGNITION read (the withheld-float ignition precondition
 * from analyst-synthesis §4, now MEASURED instead of proxied).
 * EXPERIMENTAL: the table is a single snapshot (2026-10-05), no history to
 * backtest against yet. Shown as evidence with "single-snapshot, unbacktested"
 * honesty. NOT in the core score until the daily pipeline gives it history.
 * ---------------------------------------------------------------------------- */
const CORNERED_FLOAT = {
  TRADED_PUBLIC_PCT_LT: 1.0,   // <1.0% of the public float has changed hands
  MAX_AGE: 60,                 // young listings only
  REQUIRES_IGNITION: true,     // tick-aware ignition must be active
};

/* ----------------------------------------------------------------------------
 * FUNDAMENTALS evidence block (rule 13) — point-in-time company-quality
 * context. Research (pump-fundamentals-report.md, 2026-10-05): pumped new
 * listings don't have weak fundamentals, they have ABSENT fundamentals
 * (75% no EPS vs 10% market). Missing earnings on a young listing with
 * ignition/pump activity is a first-class risk input ("no anchor") —
 * evidence only, NEVER scored. Where earnings exist, P/E >100 is flagged
 * as an extreme-multiple note (RSML precedent: P/E 128 at pump).
 * ---------------------------------------------------------------------------- */
const FUNDAMENTALS = {
  CORE_FIELDS: ['eps_ttm', 'roe_ttm', 'div_cash_pct', 'bvps', 'pe_ttm', 'netprofit_k'],
  NO_ANCHOR_MAX_AGE: 60,       // young listings only
  EXTREME_PE_TTM: 100,         // P/E TTM above this → extreme-multiple note
  EXPORT_PROVENANCE: 'capitalmax-export-2026-10-05',
  EXPORT_NOTE: 'point-in-time; historical quarterly fundamentals unavailable',
};

/* ----------------------------------------------------------------------------
 * VERIFIED TRUE LISTING DATES — the lock-in HARD RULE.
 * analyst-synthesis §2 (Shirjan's HATHY correction, 2026-10-05): the engine
 * must NEVER publish a lock-in expiry computed from the series-start proxy
 * as fact. Reference example: our 2026-10-11 HATHY estimate used series
 * start (2023-10-11) + 3y; Shirjan corrected — true listing ~2023-09-29/30,
 * lock-in EXPIRED 2026-09-29/30, nearly two weeks earlier. Consequence:
 * HATHY is in bottom capitulation WITH promoters free to sell (live supply
 * overhang), not "expiry approaching" (pending overhang) — verdict
 * semantics differ completely.
 *
 * A listing date counts as "verified" ONLY from a verified true-listing
 * source: Shirjan-supplied corrections (below), or a future true-listing
 * date pipeline. Dossier `listing_date` = price-series start for 750-session
 * symbols is a PROXY, never a fact.
 * ---------------------------------------------------------------------------- */
const VERIFIED_LISTINGS = {
  HATHY: {
    listing_date: '2023-09-29',   // Shirjan-verified 2026-10-05 (true listing ~2023-09-29/30)
    source: 'user-verified',
    note: 'Shirjan-verified 2026-10-05; lock-in expired 2026-09-29/30. ' +
          'Reference example for the series-start-proxy hard rule.',
  },
};

/* Two VERIFIED source tiers (both outrank the series-start proxy):
 *   'user-verified' — Shirjan-supplied corrections (VERIFIED_LISTINGS above).
 *   'lockin-table'  — lockin-table.json seed: Capital Max IPO Lock-in Period
 *                     table transcribed from the user's 2026-10-05 screenshot.
 *                     BS dates converted via bsdate.js (same table as the
 *                     site's bs-calendar.js). SONA correction example: the
 *                     2026-10-29 proxy estimate was ~18 days late; the table's
 *                     2083-06-24 BS → 2026-10-10 AD (screenshot "6 days left"
 *                     implied 2026-10-11 — ±1 day BS-conversion rounding, noted
 *                     honestly; engine uses the converted date).
 * LEGAL FLAG: Capital Max ToS on republication/automated extraction is
 * UNCHECKED (open since 2026-10-01). lockin-table.json is research
 * transcription (fine); production pipeline values stay OFF the site until
 * ToS clearance. Engine design must not assume republication rights. */
const LOCKIN_SOURCE_TIERS = ['user-verified', 'lockin-table', 'series_start_proxy'];
const LOCKIN_TABLE = require('./lockin-table.json').rows;
const LOCKIN_YEARS = 3;             // promoter lock-in term (SRIR 2073 Ch.9 Rule 38)
const LOCKIN_SESSIONS = 750;        // ≈3 trading years, proxy only
const LOCKIN_PROXY_NOTE =
  'computed from price-series start; true IPO date pending — see analyst-synthesis §2';

/* ----------------------------------------------------------------------------
 * Flag taxonomy: pump_score weights.
 * universe-report §6 rule 4: UPWEIGHT mom20-reversal and vol_surge (stronger
 * per-symbol than cross-sectional). Weights sum to 1.0 over the six scored
 * bearish flags. slowbleed_v2 is shown but NEVER scored (rule 3).
 * ---------------------------------------------------------------------------- */
const PUMP_WEIGHTS = {
  EXHAUSTION: 0.20,          // circuit clustering, age-gated ≥15
  PARABOLIC: 0.13,           // markup_asym
  DIST_VOLUME: 0.22,         // vol_surge — UPWEIGHTED (per-symbol IC −0.086)
  CLIMAX: 0.10,              // turnover_spike
  WINNER_FADE: 0.25,         // mom20 (inverted) — UPWEIGHTED (per-symbol IC −0.102)
  LATE_CIRCUIT_FADE: 0.10,   // rule 7 distribution-into-weakness
};
// 0.20+0.13+0.22+0.10+0.25+0.10 = 1.00

/* Opportunity score: IGNITION and BOUNCE_SETUP are the only scored bullish
 * flags. Weights sum to 1.0. [ENGINE CHOICE: ignition carries more because
 * it rests on the interaction test's bullish side; bounce setup is
 * experimental (R8) and carries the 45% failure rate.] */
const OPPORTUNITY_WEIGHTS = {
  IGNITION: 0.60,
  BOUNCE_SETUP: 0.40,
};

/* ----------------------------------------------------------------------------
 * Backtest stat strings — attached to every flag. Each is a measured
 * research result, not a claim about the future.
 * ---------------------------------------------------------------------------- */
const BACKTEST_STATS = {
  IGNITION:
    'age 0–10 ρ +0.287 (p<0.0001) — ignition continuation; crossover N≈13–15 ' +
    '(new-listing-lifecycle §3; 57 listings, both sides p<0.01 — needs OOS confirmation)',
  EXHAUSTION:
    'IC −0.076 cross-sectional; 16/16 episodes, 5.4× lift ' +
    '(universe-report §6; age-gated — inactive at age ≤14)',
  PARABOLIC:
    'IC −0.051; 14/16 episodes ' +
    '(verdict-data-spec; markup_asym needs no age gate — new-listing-lifecycle R6)',
  DIST_VOLUME:
    'cross-sectional IC −0.02..−0.03; per-symbol IC −0.086 — upweighted ' +
    '(universe-report §6 rule 4; P5)',
  CLIMAX:
    'IC −0.037; climax volume predicts 5–10 session weakness ' +
    '(factors.js P5; generic reversal — the T+2-lag variant was REJECTED)',
  WINNER_FADE:
    'per-symbol IC −0.102; 80% of symbols negative — upweighted ' +
    '(universe-report §6 rule 4; verdict-data-spec)',
  SLOW_BLEED:
    'IC −0.015; 42% contradict — experimental, NOT in score ' +
    '(verdict-data-spec; universe-report §6 rule 3)',
  LATE_CIRCUIT_FADE:
    'post-peak limit-ups during bleeds consistently failed (SAIL, RFPL, CITY, ' +
    'SHIVM); SOHL the lone exception (analyst-synthesis §4)',
  BOUNCE_SETUP:
    'base rates 55% bounce >10% / 45% bleed out / 9% reclaim50 (n=53 new ' +
    'listings; new-listing-lifecycle §7.2) — shown WITH the failure rate',
  WITHHELD_FLOAT:
    '3/3 2026 new-listing ignitions opened on sub-1,000-share days ' +
    '(analyst-synthesis §4) — ignition precondition note, not a scored flag',
  CORNERED_FLOAT:
    'traded_public_pct <1.0% of float traded + young listing + ignition — ' +
    'withheld-float ignition precondition, now MEASURED (lockin-source.md). ' +
    'Single snapshot 2026-10-05, UNBACKTESTED — evidence only, not scored',
  HYDRO_CLIFF:
    'tops break from absent bids, not selling pressure (DORDI 4,637; BHL ' +
    '5,247; KKHC 26,118 shares on limit-down cliffs — analyst-synthesis §4)',
};

/* ----------------------------------------------------------------------------
 * Calibration thresholds — pooled top-quintile readings over the universe.
 * "Elevated" = at/above the 80th percentile of pooled trailing values.
 *
 * Measured 2026-10-05 (/tmp/calibrate.js): 274 equity symbols (debentures,
 * mutual funds, promoter-share lines excluded by dossier sector), all
 * trailing factor values pooled (n=148k–181k per factor). Full table in
 * ENGINE.md. Rounded to 3dp here; p80 chosen per the brief ("top quintile").
 * ---------------------------------------------------------------------------- */
const CALIBRATED = {
  MARKUP_ASYM_ELEVATED: 1.119,   // pooled p80 = 1.1188 (n=169,967)
  MOM20_STRONG_POSITIVE: 0.070,  // pooled p80 = 0.0696 (n=180,653) — raw return, winners
  VOL_SURGE_ELEVATED: 0.524,     // pooled p80 = 0.5243 (n=148,137)
  TURNOVER_SPIKE_ELEVATED: 0.815,// pooled p80 = 0.8147 (n=169,693)
};

/* ----------------------------------------------------------------------------
 * Verdict labels and score cutoffs.
 * [ENGINE CHOICE — cutoffs are operational, not research-derived; see
 * ENGINE.md "known limitations".]
 * ---------------------------------------------------------------------------- */
const VERDICT_LABELS = {
  UNRELIABLE: 'UNRELIABLE',                    // data-quality poison (rule 11)
  EXCLUDED_NON_EQUITY: 'EXCLUDED_NON_EQUITY',  // rule 4
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',      // <30 sessions and no dossier
  EXHAUSTION_RISK: 'EXHAUSTION_RISK',          // EXHAUSTION flag active
  DISTRIBUTION_WARNING: 'DISTRIBUTION_WARNING',// pump_score ≥0.60 or ≥2 bearish flags
  ELEVATED_RISK: 'ELEVATED_RISK',              // pump_score ≥0.35
  IGNITION: 'IGNITION',                        // age ≤10 + tick-aware circuit run
  BOUNCE_SETUP: 'BOUNCE_SETUP',                // R8 bounce criteria met
  NEUTRAL: 'NEUTRAL',                          // clean
};
const SCORE_CUTOFFS = {
  DISTRIBUTION_WARNING: 0.60,
  ELEVATED_RISK: 0.35,
  MIN_BEARISH_FLAGS_FOR_DISTRIBUTION: 2,
};
// Confidence: 0.35 base + 0.10 per agreeing scored flag, capped at 0.90.
// Experimental flags never count. Always <1 — never overstated.
const CONFIDENCE = { BASE: 0.35, PER_FLAG: 0.10, CAP: 0.90 };

const METHODOLOGY_LINKS = [
  'universe-report.md#6',
  'new-listing-lifecycle.md#7.4',
  'analyst-synthesis.md#4',
  'analyst-synthesis.md#6',
];
const DISCLAIMER =
  'Educational analysis, not investment advice. Past patterns do not guarantee ' +
  'future results.';

module.exports = {
  CIRCUIT_CUTOVER,
  LIMIT_TOLERANCE_CANONICAL,
  LIMIT_TOLERANCE_IGNITION,
  AGE_GATE,
  REGIME_GATES,
  REGIMES,
  SECTOR_BEARISH_MULTIPLIER,
  CONTRADICTORY_SECTORS,
  CONTRADICTORY_SECTOR_NOTE,
  EXCLUDED_SECTORS,
  EXCLUDED_NON_EQUITY_REASON,
  VOLUME_FLOORS,
  RECENCY_DECAY,
  LATE_CIRCUIT_FADE,
  HYDRO_CLIFF,
  EVENT_SUPPRESSIONS,
  DATA_QUALITY,
  BOUNCE_SETUP,
  WITHHELD_FLOAT,
  SHORT_HORIZON,
  CORNERED_FLOAT,
  FUNDAMENTALS,
  VERIFIED_LISTINGS,
  LOCKIN_SOURCE_TIERS,
  LOCKIN_TABLE,
  LOCKIN_YEARS,
  LOCKIN_SESSIONS,
  LOCKIN_PROXY_NOTE,
  PUMP_WEIGHTS,
  OPPORTUNITY_WEIGHTS,
  BACKTEST_STATS,
  CALIBRATED,
  VERDICT_LABELS,
  SCORE_CUTOFFS,
  CONFIDENCE,
  METHODOLOGY_LINKS,
  DISCLAIMER,
};
