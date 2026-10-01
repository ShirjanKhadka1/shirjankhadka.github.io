# Cloudflare Front + CSP (Report-Only) — Migration Plan

**Status:** Planned for separate PR after Phase 1 merges. Do not start until Shirjan approves.
**S0 finding 9:** Live site has no security headers (GitHub Pages cannot set custom headers).

## Goal
Front `shirjankhadka.com.np` with Cloudflare (free tier) to add security headers.
Start with Content-Security-Policy in **report-only** mode to avoid breaking the site.

## Prerequisites
- [ ] Phase 1 PR merged
- [ ] Access to domain registrar (DNS control for shirjankhadka.com.np)
- [ ] Cloudflare account (free)

## Step 1: Add domain to Cloudflare (15 min)
1. Sign up at cloudflare.com (free plan).
2. "Add a domain" → enter `shirjankhadka.com.np`.
3. Cloudflare scans existing DNS records. Verify they match:
   - `A` records for `@` → GitHub Pages IPs (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153)
   - `CNAME` for `www` → `shirjankhadka.github.io` (or your current www target)
4. For each DNS record, ensure the cloud (proxy) is **orange** (proxied), not grey (DNS only).
   Proxied = traffic goes through Cloudflare (headers applied). DNS-only = bypasses Cloudflare.

## Step 2: Change nameservers at registrar (5 min + propagation)
1. Cloudflare provides 2 nameservers (e.g. `xxx.ns.cloudflare.com`).
2. At your domain registrar, replace the current nameservers with Cloudflare's.
3. **Propagation:** 5 minutes to 24 hours. During this time, some visitors hit old DNS, some hit Cloudflare. This is normal.
4. Verify: `dig NS shirjankhadka.com.np` should show Cloudflare nameservers.

## Step 3: SSL/TLS settings (5 min)
1. Cloudflare Dashboard → SSL/TLS → Overview.
2. Set encryption mode to **Full (strict)**.
   - GitHub Pages provides a valid cert for your domain, so Full (strict) works.
   - Do NOT use "Flexible" (it breaks HTTPS to origin).
3. Enable "Always Use HTTPS" (SSL/TLS → Edge Certificates).

## Step 4: Add security headers via Transform Rules (10 min)
Cloudflare Dashboard → Rules → Transform Rules → Modify Response Header → Create rule:

**Rule name:** `Security headers`

**When:** `Hostname equals shirjankhadka.com.np` (or `*.shirjankhadka.com.np` if using www)

**Headers to add:**

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Content-Security-Policy-Report-Only` | See below |

**CSP Report-Only (initial — permissive, to avoid breakage):**
```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; report-uri https://your-report-endpoint.com/csp
```

**Why report-only first:** The site uses inline scripts and Google Fonts. A strict CSP would break it.
Report-only logs violations without blocking. After 1-2 weeks of clean reports, tighten to enforcing.

**Report endpoint:** Use a free service like `https://report-uri.com/` (free tier) or Cloudflare's
own logging. Set this up BEFORE enabling the header.

## Step 5: Verify (10 min)
1. `curl -I https://shirjankhadka.com.np/` — confirm headers present.
2. Visit the site in a browser — confirm no visual breakage.
3. Check CSP reports for violations (should be minimal with the permissive policy).
4. Test key pages: `/nepse-chart/`, `/nepse-decode/`, `/kundali/`.

## Rollback plan (if anything breaks)

**Immediate (2 min):**
1. Cloudflare Dashboard → DNS → for each record, click the orange cloud to make it **grey** (DNS only).
   - This bypasses Cloudflare instantly. Traffic goes directly to GitHub Pages.
   - Headers disappear, but the site works.

**Full (if needed):**
1. At the domain registrar, change nameservers back to the original values.
2. Wait for propagation (up to 24h, but usually faster).
3. Delete the domain from Cloudflare.

**What does NOT break during rollback:**
- GitHub Pages keeps serving the site (it always has).
- No data loss. DNS change is the only dependency.

## After 2 weeks (separate task)
- Review CSP violation reports.
- If clean, switch from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` (enforcing).
- Tighten `script-src` and `style-src` by removing `'unsafe-inline'` (requires moving inline scripts to external files — significant work, separate PR).
