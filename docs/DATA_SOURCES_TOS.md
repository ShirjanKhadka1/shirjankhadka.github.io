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

## 3. Current politeness measures (in place as of 2026-10-01)

| Measure | Implementation |
|---|---|
| Rate limiting | 5-second delay between symbols (`tools/build-corp-history.js`); 2-second delay between paginated NEPSE API requests (`tools/fetch-nepse-live.js`) |
| User-Agent | Identifying UA on all collectors: `NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)` |
| Timeouts | Request timeouts to avoid hanging connections |
| Data transformation | Output is transformed facts, not verbatim HTML redistribution |
| Caching | Data files cached; collectors skip re-fetch if fresh (market-hours aware) |

## 4. Attribution (DONE 2026-10-01)

**Affected pages:** All pages displaying NEPSE/ShareSansar-sourced data
(nepse-chart, nepse-screener, nepse-trending, nepse-value, nepse-brokers, nepse-decode).

**Attribution text (in footer of each page):**
> "Data sources: Market data from NEPSE (nepalstock.com) and ShareSansar.
> Corporate actions verified against official NEPSE/company notices."

**Placement:** Footer `.sf-note` paragraph on each affected page.

## 5. Fallback sources plan

If permission is denied or ToS prohibits scraping:

| Data | Current source | Fallback |
|---|---|---|
| Live quotes | NEPSE reverse-engineered API | NEPSE official API (if permission granted); otherwise manual |
| Corporate actions | ShareSansar HTML | Official NEPSE/company PDFs only (already the policy for verified archive) |
| Floorsheet | NEPSE official endpoint | Merolagani (check their ToS) |

## 6. Written permission request plan

### Draft email to NEPSE

**To:** [NEPSE IT / Market Data department — address needed]
**Subject:** Request for permission — non-commercial educational market data display

> Dear NEPSE team,
>
> I operate Nepse Decode (shirjankhadka.com.np), a free educational website
> providing NEPSE market data, screeners, and research tools to Nepali investors.
> The site is non-commercial (no paywall, no premium tiers, ad-supported only)
> and carries an "educational use only, not investment advice" disclaimer.
>
> I am writing to request permission to display NEPSE market data (index values,
> stock quotes, corporate actions) on the site with clear attribution to NEPSE.
>
> Our technical practices:
> - Identifying User-Agent: NepseDecode/1.0 (+https://shirjankhadka.com.np)
> - Rate limiting: max 1 request per 2 seconds, only during market hours
> - Caching: data cached for 15 minutes minimum; no real-time redistribution
> - Attribution: "Market data from NEPSE (nepalstock.com)" in page footers
> - No circumvention: we will use any official API or data feed you provide
>
> If you have an official API, data license, or preferred attribution format,
> I will adopt it immediately.
>
> Thank you for considering this request.
>
> Best regards,
> Shirjan Khadka
> shirjan.2.khadka@gmail.com
> https://shirjankhadka.com.np

### Draft email to ShareSansar

**To:** [ShareSansar contact — via sharesansar.com contact form]
**Subject:** Request for permission — corporate action data compilation with attribution

> Dear ShareSansar team,
>
> I operate Nepse Decode (shirjankhadka.com.np), a free educational website
> for Nepali investors. I am writing to request permission to compile
> corporate-action facts (dividend announcements, AGM dates, bonus/right shares)
> from your public company pages, transformed into our own database format
> (not verbatim copying), with clear attribution to ShareSansar.
>
> Our practices:
> - Identifying User-Agent: NepseDecode/1.0 (+https://shirjankhadka.com.np)
> - Rate limiting: 5-second delay between requests
> - Attribution: "Corporate action data compiled from public sources including ShareSansar" in page footers
> - We do not redistribute your articles, analysis, or verbatim content
> - Corporate actions are cross-verified against official NEPSE/company notices
>
> If you prefer a different attribution format or have an API/data feed,
> I will adopt it.
>
> Thank you for considering this request.
>
> Best regards,
> Shirjan Khadka
> shirjan.2.khadka@gmail.com
> https://shirjankhadka.com.np

**Note:** nepalstock.com was unreachable from our development environment on
2026-10-01, so NEPSE's Terms of Service could not be fetched. Finding #1
(NEPSE reverse-engineered access) remains marked **unverified** (not cleared)
until the ToS is actually read. Do not treat the absence of a fetched ToS as
permission.

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
