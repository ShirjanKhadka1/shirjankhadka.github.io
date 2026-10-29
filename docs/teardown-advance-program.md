# Advance program: repo teardowns + ranked fits (2026-10-29)

Goal (Shirjan's order 2026-10-29): make Nepse Decode's agents and
predictive tools the best and most advanced available, by tearing down
three external repos and implementing whatever fits — under strict honesty
and agent-split gates. This document is the durable record: teardown
summaries, the ranked fit list, the reject list, the adoptable brief
texts, and what was staged. NOTHING in this program changes a live engine
on arrival; every live-engine effect stays behind the forward paper-ledger
gate (see §5).

## 1. Method

Each repo was shallow-cloned fresh into /tmp (read-only analysis only) on
2026-10-29. No repo code was pushed, deployed, or scheduled anywhere, and
no running worker's worktree was touched. Our current state at teardown
time: rule-based verdict engine (main verdicts + separate v2 with a staged
HistGB model, OOS AUC 0.693, NOT live); signal pages (momentum /
trend-relay / reversal) with forward paper-trade ledgers since 2026-08-03
(Rs 10 lakh paper trades, Target 1 / stop / ratcheting trailing stop /
20-session exit, 0.5% charges, no lookahead; momentum 18 closed 66.67%
PF 3.8, trend-relay 9 closed 44.44% PF 0.88, reversal 5 closed 20%
PF 0.12); technical-signals board (11-indicator vote 0–100); screener;
broker pipeline from Chukul bydate tape (from 2026-10-26); agency-agents
program gaps 1–9 DONE. Archive starts 2026-07-15; free sources only;
honest ceiling ~5-min quotes, 15-min candles, 15–30-min provisional broker
flow; no tick feed; serve from our own DB, never proxy live.

## 2. Teardown summaries

### 2.1 msitarzewski/agency-agents — process discipline, not predictions

- Architecture: 18 divisions of Markdown role briefs (283 agent briefs +
  47 non-agent Markdown = 330 files), a `strategy/` NEXUS orchestration
  layer (docs only, no executing coordinator), `examples/` worked
  workflows, `scripts/` installer/converter/linter only, `integrations/`
  README stubs. Machine-readable rosters (`divisions.json`, `tools.json`
  for 15 agent tools) enforced by CI lint scripts.
- Role-brief format (lint-enforced): YAML frontmatter (`name`,
  `description`, `color`) + Identity & Memory (named persona) + Core
  Mission + Critical Rules + Technical Deliverables (often with output
  templates) + Workflow + Communication Style + Learning & Memory +
  Success Metrics + Works With. Activation is "copy the .md into your
  agent tool" — there is NO runtime, no `tools:`/`model:` field, no
  runner, no code execution.
- Orchestration (NEXUS): 7 phases (Discover → Strategize → Scaffold →
  Build → Harden → Launch → Operate) with a quality gate between every
  phase; core loop Dev ↔ QA (implement one task → Evidence Collector
  tests → PASS → next / FAIL → retry max 3, then escalate); handoff
  protocol carrying metadata, context, deliverable request with measurable
  acceptance criteria, and evidence required. NO debate/voting/consensus
  mechanism. NO backtest/eval engine ("backtest" appears once, as a bullet
  in the Investment Researcher brief). NO broker/trading agent. NO
  market-data pipeline code.
- Local-vs-upstream: LOCAL == UPSTREAM EXACTLY. Local remote is the
  upstream URL; HEAD `b37b5bb` (2026-10-24) identical; full tree diff
  empty; 330 files both sides. There is no upstream update to fetch.
  Count correction: "330 briefs" is the Markdown file count, not the
  agent count (283 agents; the README's "230+ agents" line is stale).
- What it does better than us: (1) roster + lint as enforced truth
  (we have guidance-only briefs, no lint/catalogue); (2) a reusable
  orchestration protocol with gates (generalises our acceptance gate);
  (3) brief depth/uniformity + a converter rendering one brief into 15
  tools; (4) Research Synthesist evidence discipline (trace every claim
  to its primary source, grade evidence tiers, flag circular citation —
  the closest upstream analogue to our portal-manipulation law);
  (5) worked playbooks/runbooks showing multi-agent sequences end to
  end. It adds process/audit discipline, NOT predictive power.

### 2.2 ramamoorthy07/Multi-Agent-Market-Research-and-Use-Case-Generation-System — a tiny demo, not a market system

- Architecture: strictly sequential CrewAI chain, no graph, no
  parallelism, no debate, no validation: Streamlit input (one string) →
  industry_researcher (6-section industry report) → use_case_generator
  (4–5 AI/ML use cases) → resource_collector (2–3 datasets/tools per
  use case) → concatenated text + FPDF dump. All agents
  `allow_delegation=False`. README/code mismatches (material): README
  advertises 4 agents incl. a Report Generation Agent — the code has 3;
  "report generation" is string concatenation. README says input is
  company + industry — the code passes only a company string; no ticker,
  exchange, or date input exists anywhere.
- Research pipeline: web search + scraping only (Serper search API,
  CrewAI scrape tool, a PDF RAG tool pointed at a hardcoded
  `.\report.pdf` that DOES NOT SHIP — effectively broken). NO price
  APIs, NO fundamentals APIs, NO filings feeds, NO exchange/broker data.
  Nothing mentions tickers, prices, OHLC, or earnings. LLM stack needs
  THREE keys (Together/Qwen for agents, Google Gemini for the PDF tool,
  Serper for search); requirements unpinned; no tests, no eval, no DB,
  no freshness loop. Output is free text, no JSON, no citations retained,
  no source list, no scoring, no dedup, no approval gate, no backtest,
  no forward tracking. The shipped example report (Micron) reads as
  template output that would fit any semiconductor firm.
- Grounding FAILS our rules outright: single-source by construction
  (one search API, snippets + scraped pages, no second source, no
  official-source hierarchy, no arbiter); paid APIs (not free sources);
  US/global-web only (no NEPSE official, Chukul, Capital Max, or
  Nepalytix source; web search cannot surface NEPSE disclosures,
  book-closes, or broker flow); non-deterministic LLM text with no run
  log and no reproducibility — the opposite of script-first, DB-served.
- What it does better than us (narrow, non-predictive): (1) a fixed
  use-case brief schema (description / objective / implementation with
  named frameworks / cross-functional benefits, capped at 4–5) — a
  tighter brief shape than anything we have for "what could be built /
  researched next"; (2) a resource-attachment discipline (2–3 real
  resources per idea, link ONLY if the search actually returned it,
  relevance judged from title/description, never bulk-download) — a
  provenance rule our factor work lacks; (3) a clean 3-stage separation
  with a fixed expected output per stage, as a prompting skeleton only.
  It does NOT beat us on grounding, verification, evaluation,
  backtesting, ledgers, freshness, structured data, or anything
  price-related — it has none of those.

### 2.3 tauricresearch/tradingagents (v0.7.1) — the strongest machinery, honestly graded

- Architecture: Python, LangGraph StateGraph, two LLM tiers (quick-think
  for analysts/debaters/trader, deep-think for Research Manager and
  Portfolio Manager), any major provider. Defaults: 1 debate round,
  1 risk-discuss round, 20 tool rounds, 100 recursion limit.
- Analyst team (parallel subgraphs, reports merged only when all
  finish): Market Analyst (fixed indicator menu: 50/200 SMA, 10 EMA,
  MACD, RSI, stochRSI, Bollinger, ATR, VWMA; tools include a VERIFIED
  market snapshot that price/indicator claims must ground in);
  Sentiment Analyst ("social": Yahoo news headlines 7d, StockTwits
  cashtag messages with Bullish/Bearish tags, Reddit 7d — no tools, all
  pre-fetched into the prompt); News Analyst (7d lookback, 10 macro
  articles, hard-coded US-centric queries: Fed, S&P 500/GDP, ECB/BoE/BoJ,
  oil; FRED macro indicators; Polymarket); Fundamentals Analyst (SEC
  EDGAR + Yahoo statements, balance sheet, cashflow, income, insider
  trades).
- Debate team (alternating, NOT voting): Bull ↔ Bear researchers, each
  turn appending to history + its own side-history, instructed to refute
  the opponent point-by-point; router stops at 2 × max_debate_rounds
  (default: 1 round each, 2 turns). Research Manager (deep LLM,
  structured output) synthesises the debate into an investment plan and
  is explicitly told: conflict alone is not a reason to Hold; commit to
  the stronger side, sized by decisiveness; Hold only if still balanced
  or evidence too thin. Output: 5-tier rating (Buy / Overweight / Hold /
  Underweight / Sell) + rationale + strategic actions.
- Trader: turns the plan (+ technical report for price grounding +
  portfolio context if supplied) into a structured TraderProposal:
  Action (Buy/Hold/Sell), reasoning, optional ABSOLUTE entry_price,
  stop_loss, position_sizing. Entry/stop must be absolute prices, never
  percentages/ranges; a validator drops absurd stops. No tools, no
  market access at this step.
- Risk team + final decision (persuasive debate, NO hard constraint):
  fixed rotation Aggressive → Conservative → Neutral → …, 1 turn each
  by default, then Portfolio Manager (deep LLM, structured
  PortfolioDecision) synthesises risk debate + research plan + trader
  plan + past-decision lessons into final_trade_decision + final_rating.
  Unparseable → REVIEW, never silently mapped to Hold. CORRECTION to
  its README: the code contains NO order execution, NO fill, NO cash
  ledger, NO simulated exchange — the "final decision" is a text rating
  + plan. Portfolio context is caller-supplied text only, and the code
  is explicit that "not provided" ≠ flat (it never invents a book).
- State: AgentState (ticker, asset type, trade date, 4 reports, debate
  states, investment plan, trader plan, risk debate state, final
  decision/rating, past context, portfolio context). A Memory Log step
  runs in parallel with the analysts: it settles every due past decision
  and loads same-ticker + cross-ticker lessons — but ONLY the Portfolio
  Manager reads them.
- Backtest/eval (`backtest.py`): runs the full graph over a ticker ×
  date grid into a SEPARATE memory log (live log untouched), skips
  already-run cells (resumable), then settles each ticker. Metrics:
  ONLY raw return + alpha vs regional benchmark over a fixed window,
  grouped by rating (n, directional hit rate, mean alpha). Hit rate =
  share of directional calls (Buy/Overweight = +1, Sell/Underweight =
  −1; Hold = no direction, unscored) whose alpha has the called sign.
  REVIEW reported as unscored. Alpha stored rounded to 0.1pp.
- Genuinely good guards: entry at the FIRST CLOSE AFTER the analysis
  date (a run reads news published after that day's close); today's
  still-trading bar excluded; the full window must have traded or the
  entry stays pending; benchmark valued by `asof` at the same entry/exit
  dates; default holding window 5 trading days. Every dated tool clamps
  its request to the run's trade_date (model-requested future dates are
  clamped, not served); SEC EDGAR fundamentals served AS FILED (a fiscal
  year ended but not yet filed is withheld; later restatements do not
  rewrite the past); Yahoo-dated statements and insider trades are
  WITHHELD entirely for historical dates (Yahoo dates by period, not
  publication); past-context lessons filtered to those resolved by the
  trade date.
- Honesty FAILS as a predictive claim, PASSES as a decision-logging
  scaffold (by our walk-forward + OOS + realistic-costs standard):
  NO costs/slippage/commission/spread/tax/position sizing anywhere (the
  module docstring is explicit it is NOT a portfolio simulator and "must
  not grow one"); NO Sharpe/Sortino/volatility/drawdown/win-rate-as-
  portfolio-metric/profit-factor/expectancy/per-trade P&L; NO
  walk-forward, NO train/test or out-of-sample split, NO expanding-window
  re-fit (the grid is retrospective scoring of one fixed pipeline);
  NO multiple-testing control; live social/news feeds are NOT archived
  (a historical run's price window is pinned but its news/Reddit/
  StockTwits inputs still reflect "now" — contamination on exactly the
  sentiment/news leg); ONE LLM sample per cell, and reasoning models
  largely ignore temperature, so results are explicitly "indicative
  rather than repeatable". Our ledgers (fixed 20-session exit, stops,
  0.5% charges, PF/win-rate) are strictly more honest as TRADE
  evaluation.
- What it does better than us (concrete): (1) point-in-time tool
  clamping as a reusable pattern + explicit withhold messages (never
  silent empty data) — we have no equivalent named guard; (2) verified
  snapshot grounding (one deterministic OHLCV+indicator snapshot that
  claims must match) — our 11-indicator board vote has no "claims must
  match snapshot" check; (3) structured output + REVIEW sentinel
  (unparseable quarantined, never defaulted to Hold) — our verdict
  engine has no equivalent; (4) settlement + reflection loop (every
  decision logged pending, auto-settled when its window trades, scored
  vs benchmark, turned into a 2–4 sentence lesson re-injected ONLY into
  the Portfolio Manager's context on later same-ticker runs) — our
  ledgers track outcomes but do not feed a written lesson back into the
  next decision; (5) backtest-by-rating reporting (hit rate + mean alpha
  PER TIER, not just aggregate) — exposes whether "Buy" actually beats
  "Hold", a calibration view our aggregate PF/win-rate lacks;
  (6) debate as forced counter-argument (bull/bear and
  aggressive/conservative/neutral must rebut specific points from the
  same reports; judge prompt forbids "conflict → Hold" laziness) — our
  rule-based engine has no adversarial check; (7) parallel analyst
  subgraphs with a tool-round cap + forced wrap-up (isolated histories,
  no cross-contamination); (8) deterministic instrument identity
  (ticker resolved once, cached, injected into every agent's context to
  stop agents hallucinating a different company from the chart).
  What it does WORSE: no costs, no risk metrics, no position/cash
  accounting, no walk-forward, non-reproducible, and its "risk manager"
  cannot actually veto, cap, or resize anything.

## 3. Licenses (verified 2026-10-29 from the clones)

| Repo | License | Adoption consequence |
|---|---|---|
| msitarzewski/agency-agents | MIT, Copyright (c) 2025 AgentLand Contributors | MAY copy/adapt briefs into our repo PROVIDED the copyright + permission notice travels with the adapted material (see attribution block in §8). No copyleft, no restriction on internal/commercial use, no requirement to open-source our engines. |
| tauricresearch/tradingagents | Apache-2.0 (no NOTICE file) | MAY adopt/adapt code PROVIDED a copy of the license travels with adapted code, modified files carry prominent "changed" notices, and attribution notices are retained. No trademark grant; never present adapted work as Tauric's. The staged helpers in this program are REWRITES from pattern descriptions, not verbatim code — attribution notes name the source + license anyway. |
| ramamoorthy07/Multi-Agent-Market-Research-… | NONE (no LICENSE file, no header, no SPDX, no README statement) | Default copyright applies — all rights reserved, NO permission to copy, adapt, or redistribute code or prompt wording. Do NOT copy its files' text. SAFE: reimplementing general IDEAS from scratch in our own words (a 4-field brief schema and a "found-links-only" rule are patterns, not copyrightable expression). Verbatim adoption needs author permission first. |

## 4. Ranked fit list

### Tier A — adoptable now (process / validation / docs; NO live-engine effect)

| # | Fit | Landing spot | Gate status |
|---|---|---|---|
| A1 | Point-in-time guard pattern (as_of / as_of_window + withhold messages), rewritten for our archive | `tools/nd_asof.py` (STAGED this program) + future script-first runners | Adoptable now — correctness guard, no trade output |
| A2 | Verified snapshot grounding (one deterministic OHLCV+indicator snapshot that generated claims must match) | Internal validation step for verdict/signal inputs (future builder work, not staged) | Adoptable now as validation only |
| A3 | Structured rating + REVIEW sentinel (unparseable → REVIEW, excluded from scoring, never defaulted to Hold) | `tools/nd_rating.py` (STAGED this program) + future eval helpers | Adoptable now — prevents a fake Hold entering any ledger |
| A4 | By-rating summary (hit rate + mean alpha PER TIER, pending/unscored reported separately) | `tools/nd_rating.py:summarize_by_rating` (STAGED) | Adoptable now as REPORTING only; any performance CLAIM from it needs forward-gate proof + re-scoring under our ledger rules (0.5% charges, 20-session/stop exits, NEPSE-index alpha) |
| A5 | Benchmark-relative settlement entry rule (first close after decision date, full-window-or-pending, benchmark asof) | Metric extension of existing forward ledgers (add NEPSE-index alpha alongside raw return/PF; future work, not staged) | Adoptable now as a METRIC; engine changes from it need forward proof |
| A6 | NEXUS Dev↔QA loop + phase gates + handoff template (acceptance criteria + evidence required) | §7.1 brief (STAGED in this doc); standard subagent brief going forward | Adoptable now — process only |
| A7 | Model QA audit checklist (independence, data reconstruction, leakage check, replication, challenger benchmarks, calibration, PSI, severity grading) | §7.2 checklist (STAGED); applied as an AUDIT of the staged v2 HistGB model | Adoptable now as audit; the model itself stays staged — live use needs forward-gate proof |
| A8 | Research Synthesist discipline (primary-source tracing, evidence tiers, circular-citation flag, "state what wasn't found") | §7.3 brief (STAGED); strengthens portal-manipulation law + news/announcement verification briefs | Adoptable now — verification process, not a signal |
| A9 | Experiment Tracker registry format (hypothesis, design, sample-size/power, significance, go/no-go, learning capture) | §7.4 registry (STAGED); format for forward paper-trade experiments (momentum/trend-relay/reversal ledgers since 2026-08-03) | Adoptable now as registry; any new experiment's LIVE adoption needs its forward ledger to clear gates |
| A10 | QA briefs (evidence-based PASS/FAIL, spec-vs-implementation checks) | §7.1/§7.5 (STAGED); page-build QA brief (matches screenshots-read-as-pictures) | Adoptable now |
| A11 | Research-brief schema, REIMPLEMENTED (description / objective / implementation with named methods / cross-functional benefits, capped at 4–5 per brief) | §7.5 template (STAGED, own wording — no copied prompt text); internal research-brief template feeding factor/verdict research, never a public page | Adoptable now — internal only, no predictive claim, human review before any public use |
| A12 | Resource-attachment rule, REIMPLEMENTED (2–3 resources per idea, links only if a real search returned them, relevance from title/description, no bulk downloads) | §7.5 rule (STAGED); provenance standard for internal factor/model research notes | Adoptable now — strengthens honesty |
| A13 | 3-stage brief skeleton, REIMPLEMENTED (research → ideation → resourcing, fixed expected output per stage), executed as deterministic scripts + human check, NOT as an LLM chain | §7.5 skeleton (STAGED); internal brief generator feeding later agency-agents gaps | Adoptable now as scaffolding only; any brief that becomes a public claim still needs independent-source verification |
| A14 | Finance-analyst/researcher discipline, ADAPTED (assumptions-before-conclusions, base/upside/downside, facts vs projections, sensitivity tests; bull AND bear equally rigorous, falsifiable thesis, thesis-breakers, quantified downside, disclosed conviction) — with its Buy/Hold/Sell + price-target template STRIPPED and replaced by our educational verdict framing | §7.6 brief (STAGED) | Adoptable now as writing/audit discipline; any new signal derived from it needs forward-gate proof before live use |
| A15 | Statistician + data-engineer methodology (walk-forward/OOS checklist; validation, reconciliation, lineage) | §7.7 checklist (STAGED); methodology for future factor work + data-quality brief for the Chukul broker pipeline | Adoptable now (methodology/process) |

### Tier B — needs forward-gate proof first (internal-only until gates clear)

| # | Fit | Landing spot | Gate + reframing |
|---|---|---|---|
| B1 | Settlement → reflection loop (pending → settled → short written lesson re-injected into the NEXT decision's context) | Internal lesson store for verdict-engine review notes, NOT published | An LLM lesson that changes future decisions IS a live-engine input: must clear walk-forward + forward-ledger gates before influencing anything user-facing. A lesson's prose is never citable as proof a thesis worked. |
| B2 | Bull/bear + risk debate as an internal research brief (debate prompts + judge prompts, rounds capped, run on OUR data) | New internal pipeline producing a BRIEF for the strategist's review (not a page, not a verdict) | LLM debate is non-repeatable and token-heavy (a full TradingAgents-style run is ~10+ LLM calls per ticker vs deterministic scripts — violates script-first if made the daily pipeline). Must be scored on our forward ledger over a stated window with costs before any user-facing use. Any extracted rating → paper-ledger entry only (first-close-after entry, 0.5% charges, stated stop/exit, NEPSE-index alpha); debate text, if ever published, labelled educational bull/bear cases with the disclaimer, never a call. |
| B3 | Trader proposal schema (action + ABSOLUTE entry/stop/sizing) as the FORMAT for a paper-trade entry | Paper-ledger entry format extension (extends existing ledger schema) | Directly reframed: the "proposal" IS the paper-ledger entry — Rs 10 lakh notional, entry at first close after decision, our stop/trailing/20-session exit, 0.5% charges; no real order, no published "Buy". Live use needs its own forward ledger to clear gates. |
| B4 | Full-graph adoption (LangGraph + multi-LLM debate per ticker per day) | — (no landing spot yet) | Admissible ONLY as a bounded, internal, explicitly budgeted experiment, never as the daily pipeline. Separate gated project. |

## 5. What was staged in this program (NOT pushed, NOT deployed)

Worktree `~/workspace/wt-teardown-fits`, detached at tip `76ef5688`
(midnight-rollover retry twin). Two staged commits; the parent rebases
them onto the then-tip and deploys one at a time with proof, behind the
running MF build. No cron was created or modified (library helpers need
no scheduled job; a future B1/B2 experiment would need its own spec +
explicit approval).

- Commit 1 (`328852a26`): `tools/nd_asof.py` (point-in-time guards:
  as_of, as_of_window, first_close_after, settle_window — all with
  withhold/pending reasons, never silent empties), `tools/nd_rating.py`
  (Rating enum, parse_rating with REVIEW sentinel, direction,
  summarize_by_rating with per-tier hit rate + mean alpha and separate
  unscored buckets for hold/review/pending/unverified_costs/
  missing_alpha), `tools/nd_advance_proof.py` (executed proof).
- Proof executed 2026-10-29: 21 PASS / 0 FAIL. Part 1 ran against REAL
  published data (NABIL history, 3554 bars 2011-03-20..2026-10-28):
  as_of(2026-10-29) = 2026-10-28; Sunday 2026-10-25 and holiday
  2026-10-23 both clamp back to 2026-10-16 (the last session before the
  holiday block); pre-archive dates withhold with a reason; first close
  after 2026-10-27 = 2026-10-28; untraded 5-session window from
  2026-10-28 stays pending; a traded 5-session window settles on the
  5th session (2026-10-08 → 2026-10-15); a requested window spanning
  holidays clamps with a note naming the covered range (3 sessions
  2026-10-26..28 for a 2026-10-20..28 request). Part 2 scored FIXTURE
  ledger rows (invented numbers, proof only, never shipped as data):
  BUY 2/1/0.5/0.5, OVERWEIGHT 1/1/1.0/0.5, SELL 2/1/0.5/−0.25,
  UNDERWEIGHT 1/1/1.0/−0.5, directional 6/4/0.6667, unscored buckets
  exactly {hold 1, review 1, pending 1, unverified_costs 1,
  missing_alpha 1}.
- Commit 2 (this document): teardown record + ranked fits + rejects +
  adoptable brief texts (§7). Screenshots do not apply (no page); the
  acceptance gate's executed-run leg is the proof above, and the
  independent-source leg is the real-data Part 1 (not the helpers' own
  inputs — the helpers take the repo's published bars as given).

## 6. Reject list (consolidated, with reasons)

- Verbatim CrewAI + Qwen/Together chain (market-research repo) — no
  license; paid APIs; non-deterministic text; no audit trail; violates
  script-first/token-frugality.
- Serper paid search as grounding — paid; single-source snippets; no
  citation retention; fails no-single-source + official-source rules.
- PDFSearchTool as shipped — broken hardcoded `.\report.pdf` path, no
  file in repo, Windows-only path, Google embedding dependency; no
  NEPSE document corpus exists to point it at.
- The "Report Generation Agent" — does not exist in code (concatenation
  + FPDF); adds nothing over existing builders.
- Streamlit app as a live product — no DB, no freshness, no auth, no
  structured output, no update loop; contradicts serve-from-our-own-DB.
- Any price prediction / buy-call use of the market-research system —
  no market data, no evaluation; prompting it for calls would be
  hallucinated output packaged as advice — REJECTED under honesty law.
- Company/industry research as stock-page fundamentals — Muse's
  fundamentals lane under the agent split; internal briefs only.
- Blog/content/Facebook repurposing of market-research reports —
  crosses the agent split (Muse owns blog/content/Facebook).
- Kaggle/HuggingFace/GitHub dataset recommendations as trading inputs —
  global datasets judged by title only, no NEPSE coverage, no
  validation; irrelevant to the 2026-07-15 archive and 5/15/30-min
  ceilings.
- Unpinned requirements.txt / three-API-key setup — not adoptable as a
  dependency pattern; reimplementations pin versions and use free
  sources only.
- Live LLM Trader / Portfolio Manager as a verdict or signal engine —
  non-repeatable (one sample per decision, reasoning models ignore
  temperature), no costs, no risk metrics, no walk-forward. Violates
  honesty law as a live engine. Only admissible via B2/B3 after
  forward-gate proof.
- All data vendors as-is: Yahoo Finance, Alpha Vantage, SEC EDGAR, FRED,
  Reddit, StockTwits, Polymarket — US/global-only. NEPSE symbols are not
  on Yahoo; EDGAR covers US filers only; FRED is US/euro macro;
  Reddit/StockTwits have no NEPSE retail flow; Polymarket is US/global
  event markets. None survives a swap to NEPSE-only free data except as
  an architectural pattern (vendor-chain routing). Yahoo/Alpha Vantage
  are also the wrong freshness story (daily closes vs our 5/15-min
  ceilings).
- Fundamentals Analyst adaptation as our work — fundamentals is Muse's
  lane; do not build it here. (The SEC-as-filed PATTERN in A1 is a
  data-integrity idea, not a fundamentals build.)
- "Simulated exchange execution" / Portfolio Manager approve-reject —
  does not exist in code; do not adopt the claim, and never present any
  TradingAgents rating as an executed or executable order.
- 5-day benchmark alpha as a performance claim — no costs, no
  drawdown/Sharpe, fixed short window, rounded to 0.1pp, non-archived
  text inputs. Quoting it would be a single-source, cost-free
  performance claim; rejected until re-scored under our ledger rules.
- LLM reflection prose as evidence — a 2–4 sentence model-written
  lesson is not a backtest; usable internally (B1) but never citable as
  proof a thesis worked.
- Paid/login-walled paths: Alpha Vantage paid tiers, TypeSafe/Jev
  screening, ChatGPT Plus/Pro plan auth, Bedrock/Azure enterprise
  setups — paid or login-walled; the settled exception is MF/NAV only.
- Crypto asset mode (BTC-USD etc.) — no NEPSE relevance; no tick feed,
  no venue.
- Full-graph adoption (LangGraph + multi-LLM debate per ticker per
  day) — token-cost violation of script-first (~10+ LLM calls per
  ticker vs deterministic scripts). Only a bounded internal experiment.
- News/macro analyst queries and global-news framing — hard-coded
  Fed/S&P/ECB/BoJ/oil queries; a NEPSE news analyst would need
  Nepal-specific sources, which is news-data work under the existing
  split and must not be built here as a side effect of this teardown.
- All design-lane briefs (design/*) — Muse owns page design.
- All marketing/SEO/social briefs (marketing/*, paid-media/*) —
  Muse owns blog/content/SEO/Facebook; several are China-platform-
  specific (Douyin, Weibo, Xiaohongshu, Baidu) with no NEPSE relevance.
- Sales, game-development, GIS, healthcare, spatial-computing,
  academic-humanities briefs — no fit to a NEPSE data site.
- finance-tax-strategist (US/multi-jurisdiction corporate tax law) —
  wrong jurisdiction; Nepal tax treatment of NEPSE gains is not in it.
- finance-bookkeeper-controller (GAAP month-end close) — not
  market-data work. CFO / business-strategist briefs as strategy advice
  — board-governance framing, not a market-research input.
- strategy-duel-agent (game-theory "duels", Nash-equilibrium verdicts,
  dramatic recommendations) — entertainment format that would package
  simulated conflict as a verdict; fails honesty law if applied to
  stocks.
- Unadapted investment-researcher output template (Buy/Hold/Sell +
  price target) — rejected as-is (a packaged call). Only its discipline
  (both sides, falsifiable thesis, thesis-breakers) is adoptable (A14).
- Any brief whose tooling assumes paid/login-walled data (Investment
  Researcher cites Bloomberg/FactSet/S&P Capital IQ; several
  engineering briefs assume enterprise SaaS) — rejected for data
  sourcing; methods may be borrowed, data sources may not.
- Execution/loan/property/HR briefs — no NEPSE fit; no brokerage-
  execution agent exists in the repo to adopt or reject on execution
  grounds.
- Whole-repo "install all agents" adoption — rejected. Bulk import
  would drag in split-crossing lanes and 283 personas with no
  activation, scheduling, or evaluation harness. Adopt the §4 items
  individually, with attribution, and nothing else.

## 7. Adoptable brief texts (staged here; use as written)

### 7.1 Build workflow — NEXUS-adapted Dev↔QA loop + phase gates

(Adapted from agency-agents `strategy/nexus-strategy.md`,
`strategy/coordination/handoff-templates.md`, and
`strategy/coordination/agent-activation-prompts.md`. MIT attribution in
§8. Our acceptance gate already implements the substance; this text
formalises it as the standard subagent brief.)

- Phases for any build: Discover (locate + scope, state what exists or
  its absence) → Design (scope decisions stated, never silent cuts) →
  Build (full build only where peer sets exist; never single-symbol) →
  Prove (four legs below) → Deploy (parallel pusher, lease-checked
  fast-forward, authenticated ref read, live bytes on the custom domain
  only, propagation wait before requesting any new URL) → Operate
  (automation proven by an executed run, not by a schedule's existence).
- Gate between EVERY phase: the next phase does not start until the
  current phase's evidence is on file. No phase is skipped for speed.
- Core loop Dev ↔ QA: builder implements one unit → independent checker
  verifies (recomputation from a source other than the builder's inputs;
  screenshots read as pictures with visible numbers matched) → PASS →
  next unit / FAIL → fix and re-verify (max 3 retries on the same unit,
  then escalate to the strategist with the failure attached — never a
  fourth blind retry, never a silent scope cut).
- Handoff template (every delegated build carries): task + outcome +
  non-obvious constraints + every fact the worker needs (base tip,
  worktree rules, deploy pattern, what NOT to touch) + measurable
  acceptance criteria + evidence required (proof log, screenshots,
  ref check, live verification). A handoff without acceptance criteria
  is not a handoff.
- The four proof legs (our acceptance gate, unchanged): (1) headline
  numbers cross-checked against an INDEPENDENT source; (2) completeness
  sweep — every payload field displayed or explicitly dropped with a
  reason; (3) automation proven by an EXECUTED run (log +
  byte-stability); (4) screenshots read as pictures WITH visible numbers
  matched against the payload. A report missing any leg is not a "done"
  report.

### 7.2 Model QA audit checklist — for the staged v2 HistGB model

(Adapted from agency-agents
`specialized/specialized-model-qa.md`. MIT attribution in §8. AUDIT
ONLY — the model stays staged; live use needs forward-gate proof.)

1. Independence: the audit recomputes from raw bars, never from the
   model's own intermediate files. 2. Data reconstruction: rebuild one
   training window from the archive and diff it against the model's
   training input, bar for bar. 3. Leakage check: every feature at index
   i must depend on bars ≤ i ONLY (trailing-only); any feature that
   peeks at i+1 fails the audit outright. 4. Replication: re-run the
   training with the stated seed/config and reproduce the stated OOS
   AUC (0.693) within tolerance; a non-reproducing number is withdrawn,
   not quoted. 5. Challenger benchmarks: the model must beat a trivial
   baseline (prior-rate + last-return sign) on the SAME out-of-sample
   window, or it has no claim. 6. Calibration: predicted probabilities
   binned against realised frequencies; an uncalibrated score is never
   presented as a probability. 7. PSI (population stability): feature
   distributions on the forward window vs training window; drift above
   threshold pauses any live consideration, it does not get averaged
   away. 8. Severity grading: a leakage or replication failure is
   SEV-1 (blocks everything); a calibration drift is SEV-2 (blocks live
   use, allows continued paper tracking); a documentation gap is SEV-3.
   The audit's verdict is a grade, never a "looks good".

### 7.3 Verification strengthening — Research Synthesist discipline

(Adapted from agency-agents `research/research-synthesist.md`. MIT
attribution in §8. This strengthens, never replaces, the
portal-manipulation law and the official-source hierarchy.)

- Trace every claim to its PRIMARY source (company notice, NEPSE/SEBON
  filing). A claim whose chain ends at a republisher is labelled with
  the republisher, never laundered into a primary claim.
- Grade evidence tiers on the page/brief: TIER 1 primary document;
  TIER 2 independent bylined corroboration; TIER 3 republisher agreement
  (corroboration only, never verification). Portal agreement alone is
  NEVER verification — identical copy-paste across portals is ONE
  source, not many.
- Flag circular citation explicitly: "a hundred citations pointing the
  same direction is still one piece of evidence if they all trace back
  to the same study" — when sources share one origin, say so and count
  them once.
- State what was NOT found: a verification brief that searched for the
  official notice and did not find it must say that, with the search
  performed, and carry the verification-status disclaimer while the
  hunt continues. Absence of a search is not evidence of absence.

### 7.4 Experiment registry — for forward paper-trade experiments

(Adapted from agency-agents
`project-management/project-management-experiment-tracker.md`. MIT
attribution in §8. Registry only; a registered experiment earns live
consideration ONLY when its forward ledger clears the gates.)

Each experiment gets one registry entry: hypothesis (one sentence, falsifiable);
design (entry rule, exit rule, stop, trailing rule, session cap, charges,
notional — stated BEFORE the window starts, never fitted after);
sample-size/power (minimum closed trades before any claim — 20 is the
floor used by the signal ledgers, and a smaller sample is reported as
"too small to judge", never as a rate); significance (reported as a
confidence interval on the hit rate / profit factor, not a bare
percentage); go/no-go criteria (stated in advance: e.g. PF ≥ 1.5 AND
hit rate ≥ 50% over ≥ 20 closed trades, else NO-GO); learning capture
(what the window taught, including what failed, in one paragraph).
A registry entry with its design written AFTER its window is void.

### 7.5 Internal research-brief template + provenance rules

(REIMPLEMENTED in our own wording from the PATTERNS in the
market-research repo. That repo has NO license: no prompt text, code,
or wording is copied here. The schema and rules below are original
expression of general ideas.)

- Brief schema (max 4–5 items per brief): per item — Description (2–3
  lines, what the idea is); Objective (one sentence, what success
  looks like, measurable); Implementation (named methods / libraries /
  data the idea needs — our own archive and free sources only, never a
  paid API); Cross-functional benefit (which existing engine, page, or
  pipeline it improves, and how). A brief is an INTERNAL research
  input: it proposes work, it never publishes a call, and it becomes a
  public claim only after independent-source verification.
- Resource-attachment rule: at most 2–3 resources per idea; a link is
  attached ONLY if a real search actually returned it (title +
  description judged relevant); never invent a URL, never attach a
  dataset judged by title alone when its coverage is unknown, never
  bulk-download. Our own archive references (with file + date) outrank
  external links for NEPSE questions.
- 3-stage skeleton (deterministic scripts + human check, NOT an LLM
  chain): Stage 1 research (collect from our own DB + official sources,
  with the §7.3 evidence tiers attached); Stage 2 ideation (fill the
  schema above, capped at 4–5); Stage 3 resourcing (attach resources
  under the rule above). Each stage has a fixed expected output; a
  stage whose output is missing stops the brief — the next stage never
  improvises it.

### 7.6 Verdict/signal writing discipline — finance-analyst adaptation

(Adapted from agency-agents `finance/finance-financial-analyst.md` and
`finance/finance-investment-researcher.md`. MIT attribution in §8. The
source templates' Buy/Hold/Sell + price-target output is STRIPPED —
our educational verdict framing replaces it. Writing/audit discipline
only; any new signal derived from it needs forward-gate proof.)

- Assumptions before conclusions: every write-up states its assumptions
  (data window, adjustment basis, charges) BEFORE its verdict.
- Base / upside / downside: a verdict names what would confirm it and
  what would break it (thesis-breakers), with the downside quantified
  in the same units as the upside — never an upside without a downside.
- Facts vs projections, separated on the page: realised figures and
  projected figures are never blended into one number.
- Sensitivity: a recommendation that flips when one input moves within
  its plausible range is labelled fragile, not published as firm.
- Both sides equally rigorous: a bull case and a bear case are argued
  from the SAME reports; the stronger side wins on evidence, and
  "conflict" alone is never a reason to sit on the fence — but a
  balanced-evidence outcome is reported as balanced, not forced.

### 7.7 Methodology checklists — statistician + data-engineer

(Adapted from agency-agents `academic/academic-statistician.md` and
`engineering/engineering-data-engineer.md`. MIT attribution in §8.)

- Walk-forward / OOS checklist for any factor or model: in-sample fit
  is never quoted as performance; the OOS window is fixed BEFORE
  fitting; the window is walked forward (never re-fit on the test
  window); costs are realistic (our 0.5% charges + stated slippage
  assumption, never zero); multiple-testing is disclosed (how many
  variants were tried before the reported one).
- Data-quality brief for the broker pipeline: every collector run
  asserts row counts, unmapped rates, and turnover reconciliation
  against the published broker 1D total (the floorsheet/matching gates);
  a failed assertion stops the publish and reports loudly; lineage is
  recorded (source + fetch date + builder version) on every published
  file; a re-run must be byte-identical or the difference is explained.

## 8. Attribution

- Agency-agents adaptations (§7.1–§7.4, §7.6–§7.7) derive from
  msitarzewski/agency-agents, MIT License, Copyright (c) 2025 AgentLand
  Contributors. The MIT permission notice: "Permission is hereby
  granted, free of charge, to any person obtaining a copy of this
  software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the
  rights to use, copy, modify, merge, publish, distribute, sublicense,
  and/or sell copies of the Software, and to permit persons to whom the
  Software is furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software. THE
  SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE." The adapted
  texts above are original expression of the source briefs' ideas and
  structure, not verbatim copies; the notice travels with them per the
  license.
- TradingAgents patterns (§5 A1–A5, the staged helpers' design) derive
  from tauricresearch/tradingagents, Apache License 2.0. The staged
  helpers are rewrites from pattern descriptions; no upstream code is
  copied, and no adapted work is presented as Tauric's. If verbatim
  upstream code is ever adopted in future, the Apache license copy,
  "changed" notices on modified files, and retained attributions must
  accompany it.
- Market-research patterns (§7.5) are reimplementations in original
  wording. That repo has no license; no text, code, or prompt wording
  from it appears in this repo.

## 9. What needs a parent deploy turn (and what does not)

- The two staged commits in `~/workspace/wt-teardown-fits` (helpers +
  proof; this document) are STAGED ONLY. The parent rebases them onto
  the then-tip, re-runs `python3 tools/nd_advance_proof.py` (must still
  print RESULT: PASS), and deploys one at a time with proof — behind
  the running MF build, never in parallel with another deploy.
- No new cron job is created by this program. The helpers are library
  code for future builders; a future Tier B experiment (debate briefs,
  reflection loop) needs its own cron spec + explicit approval, and its
  own forward ledger, before it touches anything user-facing.
- Next in queue after this program (unchanged): MF build deploy →
  audit 3f performance implementation → warehouse-durability follow-up.
  Tier B experiments queue behind those, as separate gated projects.
