# security-count-stable Gate — Baseline Explanation

**Gate location:** `tools/validate-build.js:102`

## What it does
Compares the current build's `live.json` quote count against the **previous** build's
manifest (from `git show HEAD:data/manifest.json`). If the count drifts more than ±5%,
the gate fails. This catches data-pipeline breakage (e.g. fetcher returning partial data).

## The failure
```
security-count-stable — quotes=326 baseline=300 drift=8.7% band=±5%
```

## Root cause
The baseline of **300** came from an early/test manifest committed before the pipeline
was fetching the full universe. The current count of **326** reflects the actual number
of securities with quotes in `live.json`.

NEPSE lists 330+ securities (equities, debentures, mutual funds). The `live.json` only
includes securities with actual quotes (traded). 326 is within the expected range.

## Why the gate is correct (do not weaken)
The ±5% band is intentional. A sudden 8.7% jump indicates either:
1. The baseline was stale/wrong (this case) — baseline needs updating, not the band.
2. Real data loss — the gate correctly blocks deployment.

## Resolution
The baseline updates automatically: once a build with 326 quotes is committed, the next
build compares against 326. The gate is self-healing for legitimate growth.

**Do not** change the ±5% band. **Do not** hardcode a new baseline. Let the manifest
history establish it.

## If this recurs
1. Check if the quote count change is legitimate (new listings, suspensions lifted).
2. If legitimate, the next build's baseline will be correct.
3. If the count DROPS significantly (>5%), investigate the fetcher before merging —
   the gate is doing its job.
