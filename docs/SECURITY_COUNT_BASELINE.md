# Security count baseline — security-count-stable gate

## What it does
`tools/validate-build.js` gate `security-count-stable` compares the current
build's quoted-security count against the **previous manifest's**
`nepse-chart/data/live.json` row count. It fails the build if the count
drifts beyond the allowed band.

## Baseline (updated 2026-10-01)
- **Current baseline:** 308 quotes (session 2026-09-30).
- Stored in `data/manifest.json` → `files['nepse-chart/data/live.json'].rows`.
- The baseline updates automatically: every successful deploy writes a new
  manifest, so the next run compares against the latest good data.
- **No manual baseline update is needed.** Do not hardcode a number.

## Why ±5% (not ±3%)
The earlier spec said ±3%. The band was widened to **±5%** because:
- NEPSE legitimately suspends securities and halts trading. A suspension
  wave can remove several percent of quoted symbols in one session.
- New listings also add symbols. The gate must tolerate normal market
  structure changes without blocking deploys.
- ±3% on ~308 quotes = ±9 symbols. A single suspension batch can exceed
  this. ±5% = ±15 symbols, which absorbs normal suspension/listing
  activity while still catching a broken fetcher (which would drop far
  more, e.g. 50%+ on auth failure).

The band is a tripwire for **fetcher breakage**, not a precision check on
listings. Legitimate large changes use the manual override below.

## Absolute floor
If no previous manifest exists (first-ever run), the gate requires at
least **300** quotes. This is a hardcoded fallback floor, not a baseline.

## Manual override
If a legitimate listing change (mass delisting, market restructuring)
trips the gate and would block deploys indefinitely:

1. Dispatch `nepse-market-close.yml` manually.
2. Set `override_count_gate: true`.
3. Set `override_count_reason:` to a plain-language reason
   (e.g. "NEPSE delisted 12 hydropower companies per notice 2026-10-05").
4. The reason is **required** — the workflow fails without it.
5. The override is **logged** in the run output (`OVERRIDE security-count-stable`)
   and **emailed** to the alert address with the reason and run URL.

The override applies to **one run only**. It does not change the band or
the baseline. The next scheduled run uses the normal gate against the new
manifest.
