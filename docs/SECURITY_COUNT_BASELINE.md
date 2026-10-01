# security-count-stable Gate — Baseline Explanation

**Gate location:** `tools/validate-build.js:102`

## What it does
Compares the current build's `live.json` quote count against the **previous** build's
manifest (from `git show HEAD:data/manifest.json`). If the count drifts more than ±5%,
the gate fails. This catches data-pipeline breakage (e.g. fetcher returning partial data).

If no previous manifest exists (first run), it uses an absolute floor of 300 quotes.

## The 326 vs 300

**300** is the hardcoded absolute floor in `tools/validate-build.js:104`:
```javascript
gate('security-count-stable', q >= 300, `quotes=${q} (no baseline yet; absolute floor 300)`);
```
This is used when there is no previous manifest to compare against (first pipeline run).
It is NOT from a manifest file.

**326** was the actual quote count from the `live.json` dataset generated on
2026-09-30 (session date 2026-09-30, NEPSE trading day). This reflects the number
of securities with live quotes at that time.

NEPSE lists 330+ securities. The count varies by trading day (suspensions, new listings,
non-traded securities). 326 is within the expected range.

## Why the gate is correct (do not weaken)
The ±5% band is intentional. A sudden drift indicates either:
1. The baseline was missing/stale (first run) — the floor ensures minimum coverage.
2. Real data loss — the gate correctly blocks deployment.

## Resolution
The baseline updates automatically: once a build with N quotes is committed, the next
build compares against N. The gate is self-healing for legitimate growth.

**Do not** change the ±5% band. **Do not** hardcode a new baseline. Let the manifest
history establish it.

## If this recurs
1. Check if the quote count change is legitimate (new listings, suspensions lifted).
2. If legitimate, the next build's baseline will be correct.
3. If the count DROPS significantly (>5%), investigate the fetcher before merging —
   the gate is doing its job.
