# NEPSE & ShareSansar — ToS Review, Attribution & Permission Plan

**Date:** 2026-10-01 | **S0 findings 1 & 2**

## 1. ShareSansar Terms (fetched 2026-10-01)

**Source:** https://www.sharesansar.com/terms-and-conditions

**Relevant clauses (quoted):**

> "Sharesansar reminds the user that the data contained in its app and website is not
> necessarily real-time or accurate. All stock market data is provided by a third party."

> "Sharesansar or anyone involved with Sharesansar will not accept any liability for loss
> or damage as a result of reliance on the information including data, quotes, charts,
> and buy/sell signals contained within the platform."

**What I did NOT find:** No explicit clause prohibiting automated access, scraping, or
republication was found in the extracted terms text. The terms focus on data-accuracy
disclaimers and privacy policy. (The full page includes a privacy policy; no anti-bot
clause was located.)

**Interpretation:** The absence of an explicit anti-scraping clause does NOT mean scraping
is permitted. The data is provided "by a third party" (likely NEPSE), and republication
rights are unclear. The safe posture is to treat this as "permission not granted."

## 2. NEPSE Terms (unreachable from dev network)

**Status:** nepalstock.com is unreachable from this network (connection fails).
I could not fetch NEPSE's Terms of Service.

**What we know about the access pattern:**
- `tools/fetch-nepse-live.js` re-implements NEPSE's `Authorization: Salter <derived>` token
  derivation (reverse-engineered from yonepse's WASM/auth logic).
- No API key is stored; the token is derived at runtime.
- This circumvents NEPSE's access controls. NEPSE's ToS almost certainly prohibits
  automated scraping (standard for exchange websites).

**Action required:** Shirjan (or someone with NEPSE access) must read NEPSE's ToS at
https://www.nepalstock.com and confirm the scraping prohibition clause.

## 3. Current politeness measures (already in place)

| Measure | Implementation |
|---|---|
| Rate limiting | 5-second delay between symbols (`tools/build-corp-history.js:62`) |
| User-Agent | Honest identifying UA (`NepseDecode … collector`) |
| Timeouts | Request timeouts to avoid hanging connections |
| Data transformation | Output is transformed facts, not verbatim HTML redistribution |

## 4. Attribution (to add)

**Affected pages:** Any page displaying data sourced from ShareSansar HTML scraping
(corporate-action history, per-scrip dividend/AGM data).

**Proposed attribution text:**
> "Corporate action data compiled from public sources including ShareSansar.
> Verify against official NEPSE/company notices."

**Placement:** Footer of affected pages + `docs/DATA_SOURCES.md`.

## 5. Fallback sources plan

If permission is denied or ToS prohibits scraping:

| Data | Current source | Fallback |
|---|---|---|
| Live quotes | NEPSE reverse-engineered API | NEPSE official API (if permission granted); otherwise manual |
| Corporate actions | ShareSansar HTML | Official NEPSE/company PDFs only (already the policy for verified archive) |
| Floorsheet | NEPSE official endpoint | Merolagani (check their ToS) |

## 6. Written permission request plan

**For NEPSE:**
- Recipient: NEPSE IT / Market Data department
- Request: Permission for non-commercial, educational market-data display with attribution
- Include: Rate limits we'll respect, caching policy, attribution placement

**For ShareSansar (IMS Investment Management Services Pvt. Ltd.):**
- Recipient: Contact via sharesansar.com
- Request: Permission to compile transformed corporate-action facts with attribution
- Note: We do not redistribute their articles or verbatim content

## 7. Options for Shirjan

**Option A — Status quo + documentation (recommended short-term):**
Keep current scraping with existing politeness measures. Add attribution (Section 4).
Document ToS review (this file). Do not expand to new endpoints. Pursue written
permission in parallel.

**Option B — Official sources only:**
Stop all ShareSansar HTML scraping immediately. Corporate-action history falls back
to official NEPSE/company PDFs only. This reduces coverage but eliminates ToS risk.

**Option C — Pause and seek permission first:**
Halt the scrapers until written permission is obtained from both NEPSE and ShareSansar.
Safest legally, but data goes stale.

**My recommendation:** Option A. The scrapers are polite (5s delays, honest UA),
the output is transformed facts (not verbatim copying), and attribution will be added.
Pursue written permission without halting the pipeline.
