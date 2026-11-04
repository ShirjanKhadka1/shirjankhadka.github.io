/**
 * tests/smoke.spec.ts — hard quality gates (no failure masking).
 *
 * - HTTP 200 on every in-scope page
 * - zero pageerrors / console errors / failed SAME-ORIGIN requests
 * - no residual "Loading..." text after the page settles
 * - no horizontal overflow at 320/360/390/768/1024/1440/1920 px
 * - every page date marker matches the data file(s) THAT PAGE RENDERS
 *   (see 'page date markers match their own rendered components').
 *   Pages without a mapped marker are REPORTED, not failed.
 *
 * PER-COMPONENT DOCTRINE (Charter v4.2 item 2): a page is compared only
 * to the component files it actually renders, fetched from the SAME
 * served tree. The manifest is NOT a page component and is never read
 * by this gate, so a manifest-only PR cannot fail it, and a
 * page+component PR passes whenever the page and its components were
 * baked together. A page whose markers disagree with its own
 * components fails: that is a genuine desync (page rebuilt without its
 * component, or component advanced without its page), and the fix is
 * to rebuild the two together — never to re-run hoping for a pass,
 * never to merge on red (see docs/deploy-procedure.md §6).
 * Stale-but-consistent pages pass here: a page showing an older
 * session whose components carry that same older session is not this
 * gate's failure — staleness labelling is the live gate's + the
 * freshness badges' job (Charter §C).
 *
 * Any failure fails the test run. A JSON report is always written for the
 * CI artifact upload.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';

const PAGES = [
  '/', '/nepse-decode/', '/nepse-chart/', '/nepse-screener/', '/nepse-trending/',
  '/nepse-value/', '/nepse-brokers/', '/nepse-sectors/', '/nepse-news/',
  '/nepse-watchlist/', '/nepse-portfolio/', '/nepse-simulator/', '/nepse-reports/',
  '/nepse-actions/', '/nepse-signals/momentum/', '/nepse-signals/trend-relay/',
  '/nepse-signals/reversal/', '/nepse-signals/methodology/',
  '/stocks/', '/stocks/NBL/',
  '/blog/', '/blog/nepse-three-day-slide-explained/', '/blog/nepal-bank-nbl-company-analysis/',
  '/status/',
];
const WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];

const report: Record<string, any> = { base: BASE, pages: {} };

function pageReport(p: string) {
  if (!report.pages[p]) report.pages[p] = { errors: [], warnings: [] };
  return report.pages[p];
}

function writeReport() {
  fs.writeFileSync(path.join(__dirname, 'smoke-report.json'), JSON.stringify(report, null, 2));
}

test.afterAll(() => writeReport());

test('all in-scope pages return HTTP 200', async ({ request }) => {
  for (const p of PAGES) {
    const res = await request.get(p);
    expect(res.status(), `${p} HTTP status`).toBe(200);
  }
});

test('zero pageerrors, console errors and failed same-origin requests', async ({ browser }) => {
  test.setTimeout(300000); // 24 pages x (networkidle + 2s settle); 60s default is too small
  const page = await browser.newPage();
  const failures: string[] = [];
  for (const p of PAGES) {
    const errors: string[] = [];
    page.removeAllListeners('console');
    page.removeAllListeners('pageerror');
    page.removeAllListeners('requestfailed');
    page.removeAllListeners('response');
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const loc = msg.location();
        const url = loc && loc.url ? loc.url : '';
        // Ignore 404 console noise for optional data files (handled gracefully by the page)
        if (/404/.test(text) && /(intraday\.json|jobs\.json)/.test(url)) return;
        // Ignore third-party resource load failures (fonts, CDNs) — environmental, not site defects.
        if (/Failed to load resource/.test(text)) {
          if (url && !url.startsWith(BASE) && !url.includes('localhost') && !url.includes('127.0.0.1')) return;
          if (!url && /fonts\.googleapis|fonts\.gstatic|jsdelivr|unpkg|cloudflare/i.test(text)) return;
        }
        errors.push('console.error: ' + text.slice(0, 300));
      }
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 300)));
    page.on('requestfailed', (req) => {
      const u = req.url();
      if (u.startsWith(BASE)) errors.push('requestfailed: ' + u.slice(0, 200));
      else pageReport(p).warnings.push('third-party requestfailed: ' + u.slice(0, 120));
    });
    page.on('response', (res) => {
      const u = res.url();
      // Optional data files (e.g. intraday.json before the market-hours poller runs,
      // jobs.json pipeline status) 404 gracefully with user-friendly messages; not defects.
      if (u.startsWith(BASE) && res.status() >= 400 && !/\/(data\/intraday\.json|data\/jobs\.json)$/.test(u)) {
        errors.push(`HTTP ${res.status()}: ` + u.slice(0, 200));
      }
    });
    await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    pageReport(p).errors.push(...errors);
    if (errors.length) failures.push(`${p}:\n  - ` + errors.join('\n  - '));
  }
  await page.close();
  expect(failures, 'pages with JS/network errors').toEqual([]);
});

test('no residual "Loading..." text after settle', async ({ browser }) => {
  test.setTimeout(300000); // 24 pages x (networkidle + 2s settle)
  const page = await browser.newPage();
  const stuck: string[] = [];
  for (const p of PAGES) {
    await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText || '');
    // "Loading…" / "Loading..." left visible means client JS never resolved data
    if (/Loading[….]{1,3}/.test(text)) stuck.push(p);
  }
  await page.close();
  expect(stuck, 'pages with residual Loading text').toEqual([]);
});

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px`, async ({ browser }) => {
    test.setTimeout(300000); // 24 pages x (networkidle + 1.2s settle)
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const bad: string[] = [];
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1200);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > width + 1) bad.push(`${p}: scrollWidth=${sw}`);
    }
    await page.close();
    expect(bad, `horizontal overflow at ${width}px`).toEqual([]);
  });
}

// Per-component date gate (Charter v4.2 item 2, replaces the old
// 'SSR session dates match the manifest session date' gate).
//
// PAGE → COMPONENT MAPPING (each component fetched from the SAME served
// tree as the page; the manifest file is never fetched here):
// - /nepse-decode/ baked wrap block ("Data as of Mon, 2 Nov 2026" +
//   day range) → nepse-chart/data/wrap-archive.json: when the entry for
//   that session exists, its index high/low must round to the baked
//   range. When the entry is missing, the baked range is verified
//   against data/index-history.json for the same session instead —
//   the archive lane's lag must not fail a correct bake (Charter v5
//   item 5; Oct-30 #206 cross-dataset precedent). A present entry with
//   wrong figures still fails, and a session missing from BOTH the
//   archive and index-history fails as unverifiable.
// - /nepse-decode/ rendered freshline ("Session 2 Nov 2026 · tape
//   15:00 …") → nepse-chart/data/live.json, via the same priority as
//   js/nd-home.js getSessionDate (session_date, else data_asof, else
//   latest indices last_updated, all read in Asia/Kathmandu).
// - /nepse-decode/ rendered news line ("Feed as of D · newest story N
//   · C stories") → nepse-chart/data/news.json asof / items[0].date /
//   items.length. (The baked fallback text is JS-overwritten on load,
//   so only the rendered line is gated — same rule the old gate applied
//   to the freshness badge, #coverage, #pf-bench-note, #nl-session.)
// - /nepse-screener/ baked track-record text ("batch as of D", every
//   occurrence) → nepse-chart/data/track-record.json asof.
// - /nepse-screener/ rendered signals line ("Signals as of D · N
//   securities ranked") → nepse-chart/data/verdicts.json asof and
//   Object.keys(verdicts.verdicts).length (js/nepse-screener.js sets
//   #sc-asof from vj.asof; the baked Oct-30 fallback is JS-overwritten
//   and is NOT gated — see the known screener-fallback note).
// - /nepse-signals/{momentum,trend-relay,reversal}/ rendered freshness
//   line ("Signals as of D …") → nepse-chart/data/signals/<sys>.json
//   asof (the page's inline script renders d.asof into #sig-fresh-text).
// - /stocks/ directory ("N instruments · data as of D") → the stock-page
//   bake formula in tools/build-symbol-pages.js: D must equal
//   max(live-tape session date, verdicts asof).
// - /stocks/NBL/ baked session stamps → their bake inputs, same file:
//   Session header == max(live date, verdicts asof); tape line == live
//   date; Data-as-of header == Prices session == About as-of (all the
//   page's asofD); verdict-pill as-ofs == verdicts asof; news foot ==
//   news asof. DELIBERATELY NOT GATED: the "manifest session" span.
//   It is a manifest echo (baked from the manifest at build time), and
//   requiring it to equal its siblings would reintroduce the exact
//   coupling this item removes: a page+component PR would fail whenever
//   the manifest rollover lagged the component bake (the old #329
//   failure mode). It is logged, not failed. Also deliberately NOT
//   gated: the shareholding "data as of 2026-10-28" note (a different
//   vintage component), quarterly "as of Q4 FY" labels, and corporate-
//   action event dates — none of them are session markers.
// - /status/ is NOT gated: its noscript health line ("last session D,
//   manifest vN") is a manifest echo by construction; comparing it to
//   anything here would either reintroduce the manifest coupling or
//   compare it to itself. Staleness there is the live gate's job.
// - Every other page in PAGES has no mapped date marker and is
//   REPORTED, not failed (same as the old gate's noMarker behaviour).
//
// Baked markers are read from raw served HTML (request.get), never from
// a JS-mutated DOM, so a client fill can neither hide nor fake them.
// Rendered markers are read from the settled DOM (networkidle + 2s),
// because those elements' baked text is a fallback the page JS replaces.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};
function humanToIso(s: string): string | null {
  const m = s.trim().match(/^(?:[A-Za-z]{3}, )?(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`;
}
function nptDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function liveSessionDate(live: any): string | null {
  if (live && typeof live.session_date === 'string' && DATE_RE.test(live.session_date)) return live.session_date;
  if (live && typeof live.data_asof === 'string') return live.data_asof.slice(0, 10);
  if (live && Array.isArray(live.indices)) {
    let latest = 0;
    for (const ix of live.indices) {
      const t = ix && ix.last_updated ? new Date(ix.last_updated).getTime() : NaN;
      if (isFinite(t) && t > latest) latest = t;
    }
    if (latest) return nptDate(new Date(latest));
  }
  return null;
}
function nptTime(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

test('page date markers match their own rendered components', async ({ request, browser }) => {
  test.setTimeout(180000);
  const failures: string[] = [];
  const noted: string[] = [];
  const fail = (msg: string) => { failures.push(msg); };
  const get = async (p: string, what: string) => {
    const r = await request.get(p);
    expect(r.status(), `${what} reachable`).toBe(200);
    return r;
  };
  const getJson = async (p: string, what: string): Promise<any> => (await get(p, what)).json();
  const getHtml = async (p: string, what: string): Promise<string> => (await get(p, what)).text();
  const first = (html: string, re: RegExp, what: string): string | null => {
    const m = html.match(re);
    if (!m) { fail(`${what}: marker not found`); return null; }
    return m[1];
  };
  const all = (html: string, re: RegExp): string[] => [...html.matchAll(re)].map((m) => m[1]);
  const eq = (page: string, what: string, got: string | null, want: string | null) => {
    if (got === null || want === null) { if (got === null) fail(`${page}: ${what} missing`); return; }
    if (got !== want) fail(`${page}: ${what} ${got} != component ${want}`);
  };

  // Component files from the SAME served tree as the pages.
  const live = await getJson('/nepse-chart/data/live.json', 'live tape');
  const verdicts = await getJson('/nepse-chart/data/verdicts.json', 'verdicts batch');
  const trackRecord = await getJson('/nepse-chart/data/track-record.json', 'track-record batch');
  const news = await getJson('/nepse-chart/data/news.json', 'news feed');
  const wrapArchive = await getJson('/nepse-chart/data/wrap-archive.json', 'wrap archive');
  const idxHist = await getJson('/data/index-history.json', 'index-history');
  // Index-history day ranges by session (rows: [YYYYMMDD, ?, high, low,
  // close, ?]) — the fallback source for the wrap leg when the archive
  // entry is missing (see below). Rows with non-positive high/low are
  // unusable and skipped.
  const liveDate = liveSessionDate(live);
  const verdictsAsof: string | null = typeof verdicts.asof === 'string' ? verdicts.asof : null;
  if (!liveDate || !DATE_RE.test(liveDate)) fail(`live tape: no usable session date (asof=${live && live.asof})`);
  if (!verdictsAsof || !DATE_RE.test(verdictsAsof)) fail('verdicts batch: no asof');
  if (typeof trackRecord.asof !== 'string' || !DATE_RE.test(trackRecord.asof)) fail('track-record batch: no asof');
  if (typeof news.asof !== 'string' || !DATE_RE.test(news.asof)) fail('news feed: no asof');
  if (!Array.isArray(wrapArchive)) fail('wrap archive: not a list');
  const bakeSession = liveDate && verdictsAsof ? (liveDate >= verdictsAsof ? liveDate : verdictsAsof) : null;
  const idxRange = new Map<string, [string, string]>();
  for (const row of (idxHist.rows || [])) {
    if (Array.isArray(row) && row.length >= 5 && Number(row[2]) > 0 && Number(row[3]) > 0) {
      const ymd = String(row[0]);
      idxRange.set(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
        [Number(row[2]).toFixed(2), Number(row[3]).toFixed(2)]);
    }
  }

  // ---- Baked markers (raw served HTML) ----
  // Decode: baked wrap block vs its wrap-archive entry.
  const decodeHtml = await getHtml('/nepse-decode/', 'decode page');
  const wrapHuman = first(decodeHtml, /Data as of ((?:[A-Za-z]{3}, )?\d{1,2} [A-Za-z]{3} \d{4}) · Source: NEPSE/, '/nepse-decode/ wrap date');
  const wrapDate = wrapHuman ? humanToIso(wrapHuman) : null;
  if (wrapHuman && !wrapDate) fail(`/nepse-decode/ wrap date unparseable: ${wrapHuman}`);
  const range = decodeHtml.match(/Day range<\/span><span>([\d,]+\.\d+) – ([\d,]+\.\d+)<\/span>/);
  if (!range) fail('/nepse-decode/ wrap day range not found');
  if (wrapDate && Array.isArray(wrapArchive)) {
    const entry = wrapArchive.find((e: any) => e && e.session_date === wrapDate);
    if (!entry) {
      // Archive-lane lag, not a bake error (Charter v5 item 5; Oct-30 #206
      // cross-dataset precedent): verify the baked range against
      // index-history for the same session instead of failing on the
      // missing archive entry. A session missing from both fails.
      const ih = idxRange.get(wrapDate);
      if (!ih) fail(`/nepse-decode/ wrap date ${wrapDate} has no wrap-archive entry and no index-history row (unverifiable)`);
      else if (range && (ih[0] !== range[2].replace(/,/g, '') || ih[1] !== range[1].replace(/,/g, ''))) {
        fail(`/nepse-decode/ wrap range ${range[1]} – ${range[2]} != index-history ${wrapDate} range ${ih[1]} – ${ih[0]}`);
      }
    }
    else if (!entry.index || entry.index.high == null || entry.index.low == null) fail(`/nepse-decode/ wrap-archive entry ${wrapDate} lacks index high/low`);
    else if (range) {
      const hi = Number(entry.index.high).toFixed(2);
      const lo = Number(entry.index.low).toFixed(2);
      if (hi !== range[2].replace(/,/g, '') || lo !== range[1].replace(/,/g, '')) {
        fail(`/nepse-decode/ wrap range ${range[1]} – ${range[2]} != wrap-archive ${wrapDate} range ${lo} – ${hi}`);
      }
    }
  }

  // Screener: baked track-record batch date vs track-record.json.
  const screenerHtml = await getHtml('/nepse-screener/', 'screener page');
  const batchDates = all(screenerHtml, /batch as of (\d{4}-\d{2}-\d{2})/g);
  if (!batchDates.length) fail('/nepse-screener/ track-record batch date not found');
  else {
    if (new Set(batchDates).size !== 1) fail(`/nepse-screener/ baked batch dates disagree with each other: ${[...new Set(batchDates)].join(', ')}`);
    eq('/nepse-screener/', 'baked batch date', batchDates[0], trackRecord.asof);
  }

  // Stocks directory: bake formula max(live date, verdicts asof).
  const stocksHtml = await getHtml('/stocks/', 'stocks directory');
  const dirDate = first(stocksHtml, /instruments · data as of (\d{4}-\d{2}-\d{2})/, '/stocks/ directory date');
  eq('/stocks/', 'directory date', dirDate, bakeSession);

  // Stock page NBL: baked stamps vs their bake inputs.
  const stockHtml = await getHtml('/stocks/NBL/', 'stock page NBL');
  const header = first(stockHtml, /<span class="sp-session-l">Session (\d{4}-\d{2}-\d{2})<\/span>/, '/stocks/NBL/ session header');
  const tape = first(stockHtml, /<span class="sp-session-t">tape (\d{4}-\d{2}-\d{2})/, '/stocks/NBL/ tape line');
  const dataAsOf = first(stockHtml, /<p class="sig-sub">Data as of (\d{4}-\d{2}-\d{2})/, '/stocks/NBL/ data-as-of');
  const prices = first(stockHtml, /Prices: session (\d{4}-\d{2}-\d{2})/, '/stocks/NBL/ prices session');
  const about = first(stockHtml, /As of (\d{4}-\d{2}-\d{2}), [A-Z0-9]+ last traded/, '/stocks/NBL/ about as-of');
  const stamps = [header, tape, dataAsOf, prices, about];
  if (stamps.every((s) => s !== null) && new Set(stamps).size !== 1) {
    fail(`/stocks/NBL/ baked session stamps disagree with each other: header=${header} tape=${tape} data-as-of=${dataAsOf} prices=${prices} about=${about}`);
  }
  eq('/stocks/NBL/', 'session header', header, bakeSession);
  eq('/stocks/NBL/', 'tape line', tape, liveDate);
  // Data-as-of follows the builder's useLive rule: live quote with finite
  // ltp, and live date at/after the verdicts batch date → live date.
  const nblQuote = live && Array.isArray(live.quotes) ? live.quotes.find((q: any) => q && q.symbol === 'NBL') : null;
  const useLive = !!(nblQuote && liveDate && verdictsAsof && liveDate >= verdictsAsof && Number.isFinite(Number(nblQuote.ltp)));
  eq('/stocks/NBL/', 'data-as-of', dataAsOf, useLive ? liveDate : verdictsAsof);
  const pillDates = all(stockHtml, /<span class="vpill-meta">[^<]*as of (\d{4}-\d{2}-\d{2})/g);
  if (!pillDates.length) fail('/stocks/NBL/ verdict-pill as-of not found');
  else for (const d of new Set(pillDates)) eq('/stocks/NBL/', 'verdict-pill as-of', d, verdictsAsof);
  const newsFoot = first(stockHtml, /<p class="sp-news-foot">Feed as of (\d{4}-\d{2}-\d{2})/, '/stocks/NBL/ news foot');
  eq('/stocks/NBL/', 'news foot', newsFoot, news.asof);
  // Manifest echo: logged, deliberately NOT gated (see mapping comment).
  const mspan = stockHtml.match(/manifest session (\d{4}-\d{2}-\d{2})/);
  noted.push(`/stocks/NBL/ manifest-session span (manifest echo, not gated): ${mspan ? mspan[1] : 'absent'}`);

  // ---- Rendered markers (settled DOM; baked text here is a fallback) ----
  const page = await browser.newPage();
  const elText = async (sel: string): Promise<string | null> => {
    const el = await page.$(sel);
    if (!el) return null;
    return page.evaluate((e: any) => (e.textContent || '').trim(), el);
  };
  const rendered = async (url: string, sel: string, re: RegExp, what: string): Promise<RegExpMatchArray | null> => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const text = await elText(sel);
    if (text === null) { fail(`${url}: element ${sel} missing`); return null; }
    const m = text.match(re);
    if (!m) { fail(`${url}: ${what} not parseable from rendered text: ${text.slice(0, 160)}`); return null; }
    return m;
  };

  // Decode rendered: freshline vs live tape; news line vs news feed.
  const fresh = await rendered('/nepse-decode/', '#ndFreshlineText', /Session (\d{1,2} [A-Za-z]{3} \d{4}) · tape (\d{2}:\d{2})/, 'freshline');
  if (fresh) {
    const d = humanToIso(fresh[1]);
    if (!d) fail(`/nepse-decode/ freshline session unparseable: ${fresh[1]}`);
    else eq('/nepse-decode/', 'rendered session', d, liveDate);
    if (live && typeof live.asof === 'string') eq('/nepse-decode/', 'rendered tape time', fresh[2], nptTime(live.asof));
  }
  const newsLine = await rendered('/nepse-decode/', '#ndNewsFresh', /Feed as of (\d{4}-\d{2}-\d{2}) · newest story (\d{4}-\d{2}-\d{2}) · (\d+) stories/, 'news line');
  if (newsLine) {
    eq('/nepse-decode/', 'rendered feed date', newsLine[1], news.asof);
    if (Array.isArray(news.items)) {
      eq('/nepse-decode/', 'rendered story count', newsLine[3], String(news.items.length));
      if (news.items.length && news.items[0].date) eq('/nepse-decode/', 'rendered newest story', newsLine[2], news.items[0].date);
    }
  }

  // Screener rendered: signals line vs verdicts batch.
  const scLine = await rendered('/nepse-screener/', '#sc-asof', /Signals as of (\d{4}-\d{2}-\d{2}) · (\d+)/, 'signals line');
  if (scLine) {
    eq('/nepse-screener/', 'rendered signals date', scLine[1], verdictsAsof);
    if (verdicts.verdicts && typeof verdicts.verdicts === 'object') {
      eq('/nepse-screener/', 'rendered ranked count', scLine[2], String(Object.keys(verdicts.verdicts).length));
    }
  }

  // Signals pages rendered: freshness line vs each system's own file.
  for (const sys of ['momentum', 'trend-relay', 'reversal']) {
    const sig = await getJson(`/nepse-chart/data/signals/${sys}.json`, `signals ${sys}`);
    const line = await rendered(`/nepse-signals/${sys}/`, '#sig-fresh-text', /Signals as of (\d{4}-\d{2}-\d{2})/, 'signals freshness line');
    if (line) eq(`/nepse-signals/${sys}/`, 'rendered signals date', line[1], sig.asof);
  }
  await page.close();

  const mapped = ['/nepse-decode/', '/nepse-screener/', '/nepse-signals/momentum/', '/nepse-signals/trend-relay/', '/nepse-signals/reversal/', '/stocks/', '/stocks/NBL/'];
  const noMarker = PAGES.filter((p) => !mapped.includes(p));
  console.log('pages without a mapped component date marker (reported, not failed):', noMarker);
  console.log('noted, not gated:', noted);
  expect(failures, 'page date markers disagreeing with their own rendered components — each page is compared only to the data file(s) it renders, never to the manifest; a mismatch means the page and its component were not rebuilt together, so rebuild the page from the same component (or the component from the same bake) and re-run; never merge on red').toEqual([]);
});

// Close-integrity regression (2026-11-03): every reports-archive entry's
// market block must be its OWN session's close — never the next session's.
// Root cause was the archive builder copying wave1.json's market block at
// snapshot-build time (wave asof != batch asof) with only a printed note.
// This test pins the tree's own files against each other: ledger index vs
// index-history close AND vs the wrap-archive index value for the session.
// It runs on the PR tree (main's ledger copy); the served data-branch
// ledger is covered by the live gate's matching check.
// Archive leg: a session missing from wrap-archive skips that leg (the
// archive lane's lag must not fail the ledger lane — Charter v5 item 5);
// a present entry with a disagreeing value still fails.
test('ledger market blocks match their sessions', async ({ request }) => {
  test.setTimeout(60000);
  const get = async (p: string, what: string) => {
    const r = await request.get(p);
    expect(r.status(), `${what} reachable`).toBe(200);
    return r.json();
  };
  const ledger = await get('/data/reports-archive.json', 'reports-archive');
  const idxHist = await get('/data/index-history.json', 'index-history');
  const wrap = await get('/nepse-chart/data/wrap-archive.json', 'wrap-archive');
  const closes = new Map<string, number>();
  const rows = idxHist.rows || [];
  for (const row of rows) {
    if (Array.isArray(row) && row.length >= 5) {
      const ymd = String(row[0]);
      closes.set(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`, Number(row[4]));
    }
  }
  const wrapIdx = new Map<string, number>();
  for (const e of wrap) wrapIdx.set(e.session_date, Number(e.index && e.index.value));
  const entries = Array.isArray(ledger) ? ledger : ledger.entries;
  expect(Array.isArray(entries) && entries.length > 0, 'ledger has entries').toBe(true);
  const bad: string[] = [];
  for (const e of entries) {
    const s = e.session_date;
    const v = e.market && e.market.index;
    if (typeof v !== 'number' || !isFinite(v)) { bad.push(`${s}: market.index not finite`); continue; }
    const ih = closes.get(s);
    if (ih === undefined) bad.push(`${s}: session missing from index-history`);
    else if (ih !== v) bad.push(`${s}: ledger ${v} != index-history ${ih}`);
    const wv = wrapIdx.get(s);
    // Archive-lane lag (Charter v5 item 5): a missing archive entry skips
    // the archive leg for that session; the index-history leg above still
    // enforces it. A present entry with a disagreeing value still fails.
    if (wv !== undefined && wv !== v) bad.push(`${s}: ledger ${v} != wrap-archive ${wv}`);
  }
  expect(bad, 'ledger market blocks disagreeing with their sessions').toEqual([]);
});
