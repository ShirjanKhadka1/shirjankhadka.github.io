# Nepse Decode — Derived Metrics Registry (V2)

Every computed figure on the site, its formula, its inputs with dates, and the
rule that it is never computed from a stale or unverified input without an
UNVERIFIED label. Private working document; the methodology pages link here.

## Honesty rule

A metric whose input is beyond its freshness SLA or is unverified is either
withheld or labelled UNVERIFIED. Never mix definitions across sources
(Capital Max EPS is TTM; never blend with annualized-quarter EPS).

## Price & market structure

| Metric | Formula | Inputs (with dates) | Where shown |
|---|---|---|---|
| LTP | last traded price, NPR | live.json quotes[].ltp (asof = data_asof) | everywhere |
| Change / % change | ltp − previous_close; % = change ÷ previous_close × 100 | same session | dashboard, screener, stock pages |
| Market cap | LTP × listed shares outstanding | ltp (session) × shares (company filings, as of filing date) | live.json market_cap; stock pages |
| 52-week high/low | max/min close over trailing 52 weeks | community OHLC archive (S3) | screener, stock pages |

## Valuation (value.json, fundamentals.json)

| Metric | Formula | Inputs |
|---|---|---|
| EPS (TTM) | trailing-twelve-months net profit ÷ weighted shares | Capital Max XLSX export (manual); NEVER mixed with eps_ann |
| EPS (annualized) | latest quarter × 4 ÷ shares | same export; kept separate from eps_ttm |
| P/E | LTP ÷ EPS (TTM) | ltp (session) + eps_ttm (report date) |
| P/B | LTP ÷ book value per share | book value = (paid-up capital + reserves) ÷ shares |
| Dividend yield | cash dividend per share ÷ LTP × 100 | verified dividend notices |
| Value score 0–100 | 50% earnings-yield rank + 50% price-to-book rank, **within sector only**; quality gate: positive TTM EPS and positive net worth; sectors < 4 members not scored | build_trending_value.py |

## Risk framing (screener, verdicts.json)

| Metric | Formula | Notes |
|---|---|---|
| Stop-loss | close − 2 × ATR(14) | displayed SL/TP columns |
| Take-profit | close + 4 × ATR(14) | displayed; the **track-record replay** uses a 2.5× ATR target instead (recalibrated — 4× was unrealistically ambitious for NEPSE). Do not confuse the two. |
| Hit rate | 250-session replay: wins ÷ decided, WIN = +target touched before −2×ATR stop | verdicts.json track-record |
| RSI(14) | Wilder's RSI on closes | verdicts.json rsi |

## Verdict engine (build-nepse-universe.js)

10-factor rule-based verdict (Strong Buy … Strong Exit) from trend, RSI, MACD,
turnover, 52-week position, patterns, divergences, market regime. All inputs
transparent; no black box. Backtest horizon and regime notes on the methodology page.

## Signal systems (build-signals.js)

- Momentum / Trend-relay / Reversal: fully mechanical rules published on
  /nepse-signals/methodology/.
- Costs: 0.5% round-trip (broker + SEBON + DP, simplified), half at entry, half at exit.
- Position sizing: fixed Rs 10,00,000 notional per position, max 10 positions, not compounded.
- No-lookahead rule: signals use only data available at the signal date.
- Corporate-action adjustments: applied from the verified archive only; the count of
  adjustments is recorded per build (`corporate_action_adjustments`).

## Trending score (build_trending_value.py)

Score 0–100 = 35% turnover acceleration (vs 20-day avg, capped 5×) +
20% volume spike (capped 5×) + 20% 5-day momentum (capped +15%) +
15% broker-flow concentration (top single-broker 5-day net bought ÷ 5-day turnover, capped 25%) +
10% news mentions. Liquid common equities only in the main ranking.

## Sector rules

- **Banks/finance:** Q4 = the annual figure, so the trend's YoY comparison on Q4 is the
  annual comparison. NPL %, CD ratio, spreads from filings.
- **Hydropower:** revenue recognition follows generation; dry-season quarters are
  structurally weaker — compare YoY, not QoQ.
- **Insurance:** premium growth and claim ratios; solvency margin where disclosed.

## Change log

- 2026-10-04: registry created (V2 PR-D). Source: code audit of build-nepse-universe.js,
  build_trending_value.py, build-signals.js, merge-quarterly.js.
