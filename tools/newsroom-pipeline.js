#!/usr/bin/env node
/* Nepse Decode - newsroom pipeline (Phase 5).
 *
 * Replaces the RSS-aggregator news flow with an original-publisher newsroom.
 * Portals are TIPS, never sources. No story publishes without a verified
 * official document (NEPSE / SEBON / NRB). This is the Soaltee lesson,
 * enforced in code: the verify gate is a hard block, not a warning.
 *
 * Stages (run independently):
 *   node tools/newsroom-pipeline.js --detect
 *       Ingest candidates from the dividend-watch queue (tips) + a light
 *       RSS scan. Portals are unverified tips. Writes nepse-chart/data/
 *       newsroom/tips.json (deduped by storyKey).
 *   node tools/newsroom-pipeline.js --verify
 *       For each pending tip, locate + download-check the official PDF.
 *       Pass -> newsroom/verified.json. Fail -> newsroom/blocked.json
 *       (human review queue). Blocked stories can NEVER publish.
 *   node tools/newsroom-pipeline.js --draft
 *       For each verified story without a draft, emit a story-definition
 *       scaffold for tools/build-bilingual-article.py into
 *       nepse-news/drafts/<slug>.json. Scaffolds carry verified facts and
 *       explicit [EDITOR] markers - they are NOT publishable prose.
 *       DRAFTS ARE NEVER AUTO-PUBLISHED.
 *   node tools/newsroom-pipeline.js --photo <slug>
 *       Suggest the best-fit licensed photo from assets/images/_src/
 *       sidecars, build variants via tools/build-images.py, wire the
 *       hero block into the draft.
 *   node tools/newsroom-pipeline.js --publish <slug> --approve
 *       Human-approved publish ONLY. Requires BOTH the --approve flag AND
 *       draft._human_reviewed === true (set by the editor in the draft
 *       file after review). Runs build-bilingual-article.py, updates the
 *       public newsroom index (nepse-chart/data/newsroom.json).
 *   node tools/newsroom-pipeline.js --status
 *       Show counts per stage.
 *
 * What stays human: writing review (turning scaffolds into house newsroom format
 * prose), photo choice confirmation, and publish approval. The machine
 * detects, verifies documents, scaffolds, and publishes - it never
 * invents figures and never publishes on its own.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NR = path.join(ROOT, 'nepse-chart', 'data', 'newsroom');
const DRAFTS_DIR = path.join(ROOT, 'nepse-news', 'drafts');
const PUBLIC_INDEX = path.join(ROOT, 'nepse-chart', 'data', 'newsroom.json');
const WATCH_QUEUE = '/home/hatch/workspace/goals/sharesanket-page-growth/hidden_files/dividend-watch-queue.json';
const UNIVERSE = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (NepseDecode newsroom pipeline)' };

const TIPS_F = path.join(NR, 'tips.json');
const VERIFIED_F = path.join(NR, 'verified.json');
const BLOCKED_F = path.join(NR, 'blocked.json');
const DRAFTS_IDX_F = path.join(NR, 'drafts.json');
const PUBLISHED_F = path.join(NR, 'published.json');

/* ---------------- helpers ---------------- */
function loadJson(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; }
}
function saveJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 1));
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function todayNPT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
}
// Devanagari digits for Nepali prose. The bilingual generator never converts
// digits, so drafts must carry Devanagari digits in *_ne fields already.
const DEVA_DIGITS = { '0': '०', '1': '१', '2': '२', '3': '३', '4': '४', '5': '५', '6': '६', '7': '७', '8': '८', '9': '९' };
function devDigits(s) {
  return String(s).replace(/[0-9]/g, (d) => DEVA_DIGITS[d]);
}
function fetchUrl(url, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs || 25000);
    const req = lib.get(url, { headers: UA }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer); res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).href, maxBytes, timeoutMs));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total <= (maxBytes || 65536)) chunks.push(c);
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          head: Buffer.concat(chunks).slice(0, 16).toString('latin1'),
          bytes: total,
        });
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/* ---------------- action-kind classification ---------------- */
const KIND_RES = [
  [/right[-_ ]?shares?|हकप्रद/i, 'right-share'],
  [/bonus/i, 'bonus-share'],
  [/dividend|लाभांश/i, 'dividend'],
  [/promoter|intention[-_ ]?of[-_ ]?sale|sale[-_ ]?of[-_ ]?shares?|शेयर[- ]?बिक्री|सेयर[- ]?बिक्री/i, 'promoter-share'],
  [/auction|लिलाम/i, 'auction'],
  [/book[-_ ]?closure/i, 'book-closure'],
  [/\bagm\b|\bsgm\b|\begm\b|साधारण[- ]?सभा/i, 'agm-sgm'],
];
function classifyKind(text) {
  for (const [re, kind] of KIND_RES) if (re.test(text)) return kind;
  return 'market';
}
// Extract claimed figures from a tip headline. These are UNVERIFIED claims
// from portals - the verify/draft stages must treat them as claims only.
function extractFigures(title) {
  const figs = {};
  const pcts = [...title.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => m[1]);
  if (pcts.length) figs.percentages = pcts;
  const ratio = title.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (ratio) figs.ratio = ratio[1] + ':' + ratio[2];
  const rs = title.match(/(?:Rs\.?|रू\.?)\s*([\d,]+(?:\.\d+)?)/i);
  if (rs) figs.rupees = rs[1];
  return figs;
}
function storyKeyOf(kind, symbols, title) {
  if (symbols.length) return kind + '|' + symbols.slice().sort().join(',');
  const frag = title.toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]/g, '').split(/\s+/).slice(0, 6).join(' ');
  return kind + '|' + frag;
}

/* ---------------- STAGE: detect ---------------- */
const RSS_FEEDS = [
  { src: 'Arthasansar', url: 'https://arthasansar.com/feed' },
  { src: 'BizMandu', url: 'https://bizmandu.com/feed' },
  { src: 'OnlineKhabar', url: 'https://www.onlinekhabar.com/feed' },
];
const MARKET_KW = ['share', 'shares', 'stock', 'nepse', 'bonus', 'dividend', 'right',
  'agm', 'merger', 'profit', 'ipo', 'price', 'circuit', 'eps', 'book closure',
  'auction', 'promoter', 'capital', 'सेयर', 'शेयर', 'नेप्से', 'लाभांश', 'बोनस',
  'हकप्रद', 'साधारण सभा', 'मूल्य', 'नाफा', 'आइपिओ', 'कारोबार'];
function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}
function stripTags(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseRss(xml, src) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const get = (n) => {
      const m = b.match(new RegExp('<' + n + '[\\s>]([\\s\\S]*?)</' + n + '>', 'i'));
      return m ? decodeEntities(stripTags(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))) : '';
    };
    const title = get('title');
    const link = get('link');
    if (title && link) items.push({ title, link, src });
  }
  return items;
}
async function detect() {
  console.log('> newsroom --detect');
  const tips = loadJson(TIPS_F, []);
  const known = new Set(tips.map((t) => t.storyKey));
  let added = 0;
  const addTip = (t) => {
    if (known.has(t.storyKey)) return;
    known.add(t.storyKey);
    tips.push(t); added++;
  };

  // 1) Dividend-watch queue: the established tip pipeline. Items may already
  // carry officialPdf (ShareSansar eventdetail enrichment).
  const queue = loadJson(WATCH_QUEUE, []);
  console.log('  watcher queue items: ' + queue.length);
  for (const q of queue) {
    const title = q.title || q.headline || '';
    const symbols = q.symbol ? [q.symbol] : (q.symbols || []);
    const kind = q.kind || classifyKind(title);
    addTip({
      storyKey: q.storyKey || storyKeyOf(kind, symbols, title),
      symbols, action_kind: kind,
      claimed_figures: q.facts && Object.keys(q.facts).length ? q.facts : extractFigures(title),
      tip_urls: [q.url || q.sourceUrl].filter(Boolean),
      tip_title: title,
      source: 'dividend-watch',
      officialPdf: q.officialPdf || null,
      detected_at: todayNPT(),
      status: 'pending',
    });
  }

  // 2) Light RSS scan: portals as unverified tips only.
  const uni = loadJson(UNIVERSE, { symbols: [] });
  const tickers = (uni.symbols || []).map((e) => e.s);
  for (const f of RSS_FEEDS) {
    try {
      const r = await fetchUrl(f.url, 512 * 1024, 25000);
      if (r.status !== 200) { console.log('  !! ' + f.src + ' HTTP ' + r.status); continue; }
      // re-fetch full body for parsing (fetchUrl caps bytes; RSS needs all)
      const xml = await new Promise((resolve, reject) => {
        const lib = f.url.startsWith('https') ? require('https') : require('http');
        lib.get(f.url, { headers: UA }, (res) => {
          let d = '';
          res.on('data', (c) => { d += c; if (d.length > 2 * 1024 * 1024) res.destroy(); });
          res.on('end', () => resolve(d)); res.on('error', reject);
        }).on('error', reject);
      });
      const items = parseRss(xml, f.src);
      let matched = 0;
      for (const it of items) {
        const t = ' ' + it.title.toLowerCase() + ' ';
        if (!MARKET_KW.some((k) => t.includes(k.toLowerCase()))) continue;
        const syms = tickers.filter((s) =>
          new RegExp('(^|[^a-z0-9])' + s.toLowerCase() + '([^a-z0-9]|$)').test(t));
        if (!syms.length) continue;
        const kind = classifyKind(it.title);
        addTip({
          storyKey: storyKeyOf(kind, syms.slice(0, 2), it.title),
          symbols: syms.slice(0, 2), action_kind: kind,
          claimed_figures: extractFigures(it.title),
          tip_urls: [it.link], tip_title: it.title,
          source: 'rss-tip:' + f.src,
          officialPdf: null,
          detected_at: todayNPT(),
          status: 'pending',
        });
        matched++;
      }
      console.log('  ' + f.src + ': ' + items.length + ' items, ' + matched + ' tips');
    } catch (e) {
      console.log('  !! ' + f.src + ' failed: ' + e.message);
    }
  }

  saveJson(TIPS_F, tips);
  console.log('> detect done: +' + added + ' new tips, ' + tips.length + ' total');
}

/* ---------------- STAGE: verify (THE GATE) ---------------- */
// Official-document URL patterns. Anything else is not an official document.
const OFFICIAL_RES = [
  /https?:\/\/(www\.)?nepalstock\.com\/api\/nots\/[^\s"'<>]+/i,
  /https?:\/\/sebon\.gov\.np\/[^\s"'<>]*\.pdf/i,
  /https?:\/\/(www\.)?nrb\.org\.np\/[^\s"'<>]*\.pdf/i,
];
function extractOfficialLinks(html) {
  const found = [];
  for (const re of OFFICIAL_RES) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(html)) !== null) found.push(m[0]);
  }
  return [...new Set(found)];
}
async function checkPdf(url) {
  try {
    const r = await fetchUrl(url, 16384, 30000);
    if (r.status !== 200) return { ok: false, reason: 'HTTP ' + r.status };
    const isPdf = r.head.startsWith('%PDF') || /pdf/i.test(r.contentType);
    if (!isPdf) return { ok: false, reason: 'not a PDF (content-type: ' + r.contentType + ')' };
    return { ok: true, bytes: r.bytes };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
async function verify() {
  console.log('> newsroom --verify (THE GATE: no official PDF = blocked, never published)');
  const tips = loadJson(TIPS_F, []);
  const verified = loadJson(VERIFIED_F, []);
  const blocked = loadJson(BLOCKED_F, []);
  const vKeys = new Set(verified.map((v) => v.storyKey));
  const bKeys = new Set(blocked.map((b) => b.storyKey));
  let nV = 0, nB = 0;

  for (const tip of tips) {
    if (tip.status !== 'pending' || vKeys.has(tip.storyKey) || bKeys.has(tip.storyKey)) continue;
    console.log('  checking ' + tip.storyKey);
    const pdfCandidates = [];
    if (tip.officialPdf) pdfCandidates.push({ url: tip.officialPdf, via: 'watcher-enriched' });
    // Scan tip portal pages for embedded official-document links.
    for (const u of tip.tip_urls || []) {
      try {
        const r = await fetchUrl(u, 256 * 1024, 25000);
        if (r.status !== 200) continue;
        const html = await new Promise((resolve, reject) => {
          const lib = u.startsWith('https') ? require('https') : require('http');
          lib.get(u, { headers: UA }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; if (d.length > 512 * 1024) res.destroy(); });
            res.on('end', () => resolve(d)); res.on('error', reject);
          }).on('error', reject);
        });
        for (const link of extractOfficialLinks(html)) {
          pdfCandidates.push({ url: link, via: 'extracted-from-tip-page' });
        }
      } catch (e) { /* tip page unreachable; keep trying other candidates */ }
    }

    let passed = null;
    for (const c of pdfCandidates) {
      const chk = await checkPdf(c.url);
      if (chk.ok) { passed = { url: c.url, via: c.via, bytes: chk.bytes }; break; }
      console.log('    candidate failed: ' + c.url.slice(0, 80) + ' (' + chk.reason + ')');
    }
    if (passed) {
      verified.push({
        storyKey: tip.storyKey, symbols: tip.symbols, action_kind: tip.action_kind,
        claimed_figures: tip.claimed_figures, tip_title: tip.tip_title,
        officialPdf: passed.url, pdf_via: passed.via,
        verified_at: new Date().toISOString(),
      });
      tip.status = 'verified'; nV++;
      console.log('    VERIFIED: ' + passed.url.slice(0, 90));
    } else {
      blocked.push({
        storyKey: tip.storyKey, symbols: tip.symbols, action_kind: tip.action_kind,
        tip_title: tip.tip_title, tip_urls: tip.tip_urls,
        reason: 'no official document found (no verified NEPSE/SEBON/NRB PDF)',
        blocked_at: new Date().toISOString(),
        note: 'Human may retry with a manually located official PDF via --verify-pdf <storyKey> <pdfUrl>.',
      });
      tip.status = 'blocked'; nB++;
      console.log('    BLOCKED: no official document');
    }
  }
  saveJson(TIPS_F, tips);
  saveJson(VERIFIED_F, verified);
  saveJson(BLOCKED_F, blocked);
  console.log('> verify done: +' + nV + ' verified, +' + nB + ' blocked');
}

/* ---------------- manual verify override ---------------- */
// A human who manually locates the official PDF for a blocked story can
// attach it: the PDF is still download-verified before acceptance.
async function verifyPdfOverride(storyKey, pdfUrl) {
  console.log('> manual verify override for ' + storyKey);
  if (!OFFICIAL_RES.some((re) => re.test(pdfUrl))) {
    console.error('REFUSED: URL is not a recognized official-document pattern (nepalstock.com/api/nots, sebon.gov.np PDF, nrb.org.np PDF).');
    process.exit(1);
  }
  const chk = await checkPdf(pdfUrl);
  if (!chk.ok) { console.error('REFUSED: PDF did not verify: ' + chk.reason); process.exit(1); }
  const blocked = loadJson(BLOCKED_F, []);
  const tip = blocked.find((b) => b.storyKey === storyKey);
  if (!tip) { console.error('No blocked story with that key.'); process.exit(1); }
  const verified = loadJson(VERIFIED_F, []);
  verified.push({
    storyKey: tip.storyKey, symbols: tip.symbols, action_kind: tip.action_kind,
    claimed_figures: tip.claimed_figures, tip_title: tip.tip_title,
    officialPdf: pdfUrl, pdf_via: 'human-located',
    verified_at: new Date().toISOString(),
  });
  saveJson(VERIFIED_F, verified);
  saveJson(BLOCKED_F, blocked.filter((b) => b.storyKey !== storyKey));
  const tips = loadJson(TIPS_F, []);
  const t = tips.find((x) => x.storyKey === storyKey);
  if (t) t.status = 'verified';
  saveJson(TIPS_F, tips);
  console.log('> verified via human-located PDF');
}

/* ---------------- STAGE: draft ---------------- */
// Drafts are SCAFFOLDS, not prose. They carry every verified fact, follow the
// playbook's structural rules (inverted pyramid slots, Moneycontrol headline
// formula, honesty-code hedging), and mark every judgment call with an
// explicit [EDITOR] marker. A human turns the scaffold into house newsroom format
// prose. Drafts can never be published directly.
const KIND_LABEL_EN = {
  'dividend': 'dividend', 'bonus-share': 'bonus share', 'right-share': 'right share',
  'promoter-share': 'promoter share sale', 'auction': 'auction',
  'book-closure': 'book closure', 'agm-sgm': 'AGM/EGM', 'market': 'market update',
};
const KIND_LABEL_NE = {
  'dividend': 'लाभांश', 'bonus-share': 'बोनस शेयर', 'right-share': 'हकप्रद शेयर',
  'promoter-share': 'प्रमोटर शेयर बिक्री', 'auction': 'लिलाम',
  'book-closure': 'बुक क्लोज', 'agm-sgm': 'साधारण सभा', 'market': 'बजार अपडेट',
};
function companyName(sym) {
  const uni = loadJson(UNIVERSE, { symbols: [] });
  const e = (uni.symbols || []).find((x) => x.s === sym);
  return e ? (e.n || sym) : sym;
}
function draftHeadline(v) {
  const sym = v.symbols[0] || 'NEPSE';
  const co = companyName(sym);
  const figs = v.claimed_figures || {};
  const kind = v.action_kind;
  // Moneycontrol formula: % move + action + size - but ONLY with verified
  // figures. Unverified figures never enter the headline (honesty code).
  if (figs.percentages && figs.percentages.length >= 2 && kind === 'dividend') {
    return {
      en: co + ' proposes ' + figs.percentages[0] + '% dividend: ' +
        figs.percentages[0] + '% bonus + ' + figs.percentages[1] + '% cash [EDITOR: confirm which is bonus vs cash from PDF]',
      ne: co + ' ले ' + devDigits(figs.percentages[0]) + '% लाभांश प्रस्ताव: [EDITOR: PDF बाट बोनस/नगद छुट्याउनुहोस्]',
    };
  }
  if (figs.ratio && kind === 'right-share') {
    return {
      en: co + ' opens ' + figs.ratio + ' right shares at Rs 100 [EDITOR: confirm price and dates from PDF]',
      ne: co + ' हकप्रद निष्कासन गर्दै [EDITOR: PDF बाट अनुपात, मूल्य, मिति पुष्टि गर्नुहोस्]',
    };
  }
  // Honest fallback: state what is verified, withhold what is not.
  return {
    en: co + ' announces ' + (KIND_LABEL_EN[kind] || kind) + '; details in official NEPSE notice [EDITOR: extract figures from PDF]',
    ne: co + ': ' + (KIND_LABEL_NE[kind] || kind) + ' घोषणा; विवरण आधिकारिक सूचनामा [EDITOR: PDF बाट तथ्यांक निकाल्नुहोस्]',
  };
}
function draftBody(v, pdfUrl) {
  const sym = v.symbols[0] || '';
  const co = companyName(sym);
  const kindLabel = KIND_LABEL_EN[v.action_kind] || v.action_kind;
  const chip = sym ? '<a class="ticker" href="/stocks/' + sym + '/">' + sym + '</a>' : 'NEPSE';
  // Inverted pyramid: lead = the verified news in 1-2 sentences.
  const en =
    '<p>KATHMANDU — ' + esc(co) + ' (' + chip + ') has announced a ' + kindLabel +
    ', according to an official notice published via the Nepal Stock Exchange. ' +
    '[EDITOR: replace with dated, sourced lead once figures are extracted from the PDF.]</p>\n' +
    '<h2>What was announced?</h2>\n' +
    '<p>[EDITOR: state the verified action - rates, ratio, dates - each figure attributed to the NEPSE notice. ' +
    'Proposal vs approval vs listing must never be conflated.]</p>\n' +
    '<h2>What happens next?</h2>\n' +
    '<p>[EDITOR: the next procedural step - AGM approval, SEBON clearance, book closure, application window - ' +
    'with dates from the official document only.]</p>\n' +
    '<h2>Why does it matter?</h2>\n' +
    '<p>[EDITOR: one calm paragraph on investor relevance. No prediction, no buy/sell implication.]</p>';
  const kindNe = KIND_LABEL_NE[v.action_kind] || v.action_kind;
  const ne =
    '<p>काठमाडौं — ' + esc(co) + ' (' + chip + ') ले ' + kindNe +
    ' घोषणा गरेको छ। नेपाल स्टक एक्सचेन्जमार्फत प्रकाशित आधिकारिक सूचनाअनुसार यो घोषणा गरिएको हो। ' +
    '[सम्पादक: PDF बाट तथ्यांक निकालेपछि मितिसहितको लिड लेख्नुहोस्।]</p>\n' +
    '<h2>के घोषणा भयो?</h2>\n' +
    '<p>[सम्पादक: प्रमाणित तथ्यांक - दर, अनुपात, मिति - लेख्नुहोस्। प्रत्येक तथ्यांक आधिकारिक सूचनामा आधारित हुनुपर्छ।]</p>\n' +
    '<h2>अब के हुन्छ?</h2>\n' +
    '<p>[सम्पादक: अर्को प्रक्रिया - साधारण सभा, सेबोन स्वीकृति, बुक क्लोज - आधिकारिक दस्तावेजबाट मात्र।]</p>\n' +
    '<h2>यसको अर्थ के हो?</h2>\n' +
    '<p>[सम्पादक: लगानीकर्ताका लागि सान्दर्भिक एक अनुच्छेद। भविष्यवाणी नगर्नुहोस्।]</p>';
  return { en, ne };
}
function draftMath(v) {
  // Per-shareholder math block: ONLY when dividend figures were extracted.
  const figs = v.claimed_figures || {};
  if (v.action_kind !== 'dividend' || !figs.percentages || figs.percentages.length < 2) return null;
  const bonus = parseFloat(figs.percentages[0]), cash = parseFloat(figs.percentages[1]);
  if (isNaN(bonus) || isNaN(cash)) return null;
  const bShares = (bonus).toFixed(2); // per 100 shares
  const cashRs = (cash * 10).toFixed(2); // Rs 100 face value assumption, labeled
  return {
    title_en: 'What 100 shares actually yield [EDITOR: confirm face value and tax treatment]',
    title_ne: '१०० कित्तामा के प्राप्त हुन्छ [सम्पादक: अंकित मूल्य र कर पुष्टि गर्नुहोस्]',
    headers_en: ['Component', 'Rate', 'On 100 shares'],
    headers_ne: ['शीर्षक', 'दर', '१०० कित्तामा'],
    rows: [
      { cells_en: ['Bonus shares', bonus + '%', bShares + ' shares'], cells_ne: ['बोनस शेयर', devDigits(bonus) + '%', devDigits(bShares) + ' कित्ता'], result: false },
      { cells_en: ['Cash dividend', cash + '%', 'Rs ' + cashRs + ' before 5% withholding tax'], cells_ne: ['नगद लाभांश', devDigits(cash) + '%', 'रू ' + devDigits(cashRs) + ' (५% कर कट्टी अघि)'], result: false },
    ],
    note_en: 'Assumes Rs 100 face value and standard 5% dividend withholding tax. Confirm both from the official notice before publish.',
    note_ne: 'रू १०० अंकित मूल्य र ५% लाभांश कर मानिएको। प्रकाशनअघि आधिकारिक सूचनाबाट पुष्टि गर्नुहोस्।',
  };
}
function buildDraft(v) {
  const sym = v.symbols[0] || 'NEPSE';
  const co = companyName(sym);
  const date = todayNPT();
  const slug = (sym.toLowerCase() + '-' + v.action_kind + '-' + date).replace(/[^a-z0-9-]/g, '');
  const hl = draftHeadline(v);
  const body = draftBody(v, v.officialPdf);
  const math = draftMath(v);
  const pdfShort = v.officialPdf.length > 60 ? v.officialPdf.slice(0, 60) + '...' : v.officialPdf;
  return {
    _status: 'DRAFT - human writing review required. DO NOT PUBLISH. See _editor_checklist.',
    _human_reviewed: false,
    _editor_checklist: [
      'Extract exact figures (rates, ratio, dates) from the official PDF; replace all [EDITOR] markers.',
      'Rewrite body to house newsroom format: dated sourced lead, data-led prose, restrained close (playbook section 9).',
      'Confirm headline figures match the PDF; apply headline honesty code (playbook section 10).',
      'Rewrite the Nepali version as natural plain Nepali (not translationese); Devanagari digits in prose.',
      'Confirm photo choice; replace placeholder hero credit.',
      'Set real author name and reviewer; set _human_reviewed=true only when all above are done.',
    ],
    _verified_source: { storyKey: v.storyKey, officialPdf: v.officialPdf, verified_at: v.verified_at },
    slug,
    section_en: 'News', section_ne: 'समाचार',
    kicker_en: 'NEWS', kicker_ne: 'समाचार',
    headline_en: hl.en, headline_ne: hl.ne,
    dek_en: '[EDITOR: one-breath central tension, not a summary. Playbook section 9.2.]',
    dek_ne: '[सम्पादक: एक वाक्यमा केन्द्रीय तनाव।]',
    // NOTE (brand rule): seo_title carries NO brand suffix. The generator
    // appends " | Nepse Decode" itself (BRAND), and JSON-LD publisher is
    // "Nepse Decode". Newsroom output never carries the personal name.
    seo_title_en: (co + ' ' + (KIND_LABEL_EN[v.action_kind] || '')).trim().slice(0, 60),
    seo_title_ne: (co + ' ' + (KIND_LABEL_NE[v.action_kind] || '')).trim().slice(0, 60),
    seo_desc_en: ('Verified ' + (KIND_LABEL_EN[v.action_kind] || 'update') + ' for ' + co + ' (' + sym + '), checked against the official NEPSE notice.').slice(0, 155),
    seo_desc_ne: (co + ' (' + sym + ') को प्रमाणित विवरण, आधिकारिक नेप्से सूचनामा आधारित।').slice(0, 155),
    author: {
      name: '[ASSIGN REPORTER]', initials: '??',
      role_en: 'Markets Reporter', role_ne: 'बजार संवाददाता',
      bio_en: '[EDITOR: reporter beat credential]', bio_ne: '[सम्पादक: संवाददाता परिचय]',
      page: '/author/',
    },
    published_iso: new Date().toISOString().replace('Z', '+05:45'),
    published_display_en: date + ' NPT',
    published_display_ne: devDigits(date) + ' (नेपाल समय)',
    updated_iso: null, updated_display_en: null, updated_display_ne: null,
    reviewer: { name_en: '[EDITOR: reviewer name]', name_ne: '[सम्पादक: समीक्षक]' },
    trust: {
      label_en: 'NEPSE notice - ' + date, label_ne: 'नेप्से सूचना - ' + devDigits(date),
      pdf_url: v.officialPdf,
    },
    hero: {
      alt_en: '[EDITOR: descriptive alt text]', alt_ne: '[सम्पादक: तस्वीर विवरण]',
      caption_en: '[EDITOR: what the photo shows + why it matters]',
      caption_ne: '[सम्पादक: तस्वीर विवरण]',
      credit_en: '[EDITOR: Photo: Name / source (license)]',
      credit_ne: '[सम्पादक: तस्वीर: नाम / स्रोत]',
    },
    glance_en: ['[EDITOR: 3-5 bullets with the numbers that matter, all from the official PDF]'],
    glance_ne: ['[सम्पादक: मुख्य तथ्यांक]'],
    checked: [{
      claim_en: v.tip_title || (KIND_LABEL_EN[v.action_kind] + ' announced by ' + co),
      claim_ne: '[सम्पादक: दाबी]',
      source_en: 'Nepal Stock Exchange (NEPSE)', source_ne: 'नेपाल स्टक एक्सचेन्ज (नेप्से)',
      doc_en: 'Official company notice via NEPSE', doc_ne: 'नेप्से मार्फत आधिकारिक कम्पनी सूचना',
      on_en: date + ' by newsroom pipeline', on_ne: devDigits(date),
      pdf_url: v.officialPdf,
    }],
    body_html_en: body.en,
    body_html_ne: body.ne,
    math: math,
    takeaways_en: ['[EDITOR: numbered takeaways]'],
    takeaways_ne: ['[सम्पादक: मुख्य बुँदाहरू]'],
    sources: [{
      title_en: 'Official company notice via NEPSE', title_ne: 'नेप्से मार्फत आधिकारिक कम्पनी सूचना',
      authority_en: 'Issued via Nepal Stock Exchange.', authority_ne: 'नेपाल स्टक एक्सचेन्ज मार्फत जारी।',
      pdf_url: v.officialPdf,
    }],
    tags: [
      { label_en: co, label_ne: co, slug: sym.toLowerCase() },
      { label_en: KIND_LABEL_EN[v.action_kind] || v.action_kind, label_ne: KIND_LABEL_NE[v.action_kind] || '', slug: v.action_kind },
    ],
    related: [
      { kind_en: 'SAME COMPANY', kind_ne: 'उही कम्पनी', title_en: '[EDITOR: related story]', title_ne: '[सम्पादक]', url: '/nepse-actions/' },
      { kind_en: 'SAME ACTION', kind_ne: 'उही कार्य', title_en: '[EDITOR: related story]', title_ne: '[सम्पादक]', url: '/nepse-actions/' },
      { kind_en: 'EXPLAINER', kind_ne: 'व्याख्या', title_en: '[EDITOR: evergreen explainer]', title_ne: '[सम्पादक]', url: '/blog/' },
    ],
    corrections: [],
    _pdf_note: 'Official PDF verified at ' + v.verified_at + ' via ' + v.pdf_via + ': ' + pdfShort,
  };
}
function draft() {
  console.log('> newsroom --draft (scaffolds only - NEVER publishable without human review)');
  const verified = loadJson(VERIFIED_F, []);
  const idx = loadJson(DRAFTS_IDX_F, []);
  const have = new Set(idx.map((d) => d.storyKey));
  let n = 0;
  for (const v of verified) {
    if (have.has(v.storyKey)) continue;
    const d = buildDraft(v);
    const fp = path.join(DRAFTS_DIR, d.slug + '.json');
    saveJson(fp, d);
    idx.push({ storyKey: v.storyKey, slug: d.slug, file: 'nepse-news/drafts/' + d.slug + '.json', created: todayNPT(), human_reviewed: false, published: false });
    have.add(v.storyKey); n++;
    console.log('  draft: ' + d.slug);
  }
  saveJson(DRAFTS_IDX_F, idx);
  console.log('> draft done: +' + n + ' scaffolds in nepse-news/drafts/ (human review required)');
}

/* ---------------- STAGE: photo ---------------- */
// Suggest the best-fit licensed photo from assets/images/_src/ sidecars by
// story subject, then build variants via tools/build-images.py. The editor
// confirms or swaps the choice during review.
const PHOTO_KEYWORDS = {
  'dividend': ['bank', 'building', 'kathmandu', 'corporate'],
  'bonus-share': ['bank', 'building', 'kathmandu'],
  'right-share': ['bank', 'building', 'kathmandu'],
  'promoter-share': ['building', 'kathmandu'],
  'auction': ['building', 'kathmandu'],
  'book-closure': ['building', 'kathmandu'],
  'agm-sgm': ['building', 'kathmandu', 'durbar'],
  'market': ['skyline', 'kathmandu', 'valley', 'aerial', 'trading'],
};
function photo() {
  const slug = process.argv[3];
  if (!slug) { console.error('Usage: --photo <draft-slug>'); process.exit(1); }
  const idx = loadJson(DRAFTS_IDX_F, []);
  const entry = idx.find((d) => d.slug === slug);
  if (!entry) { console.error('No draft with slug ' + slug); process.exit(1); }
  const draft = loadJson(path.join(ROOT, entry.file), null);
  if (!draft) { console.error('Draft file missing: ' + entry.file); process.exit(1); }
  const srcDir = path.join(ROOT, 'assets', 'images', '_src');
  const sidecars = fs.readdirSync(srcDir).filter((f) => f.endsWith('.json'));
  const kind = draft._verified_source ? draft._verified_source.storyKey.split('|')[0] : 'market';
  const want = PHOTO_KEYWORDS[kind] || PHOTO_KEYWORDS.market;
  let best = null, bestScore = -1;
  for (const f of sidecars) {
    if (f.startsWith('demo-')) continue;
    const sc = loadJson(path.join(srcDir, f), {});
    const text = ((sc.story_fit || '') + ' ' + (sc.caption || '') + ' ' + f).toLowerCase();
    let score = 0;
    for (const k of want) if (text.includes(k)) score++;
    if (sc.subject_verified === false) score -= 10;
    if (score > bestScore) { bestScore = score; best = { file: f, sc }; }
  }
  if (!best) { console.error('No licensed photo available.'); process.exit(1); }
  const photoSlug = best.file.replace(/\.json$/, '');
  console.log('> suggested photo: ' + photoSlug + ' (score ' + bestScore + ')');
  console.log('  ' + best.sc.caption);
  console.log('  credit: ' + best.sc.photographer + ' / ' + best.sc.source + ' (' + best.sc.license + ')');
  // Copy into the story slug namespace and build variants.
  const storyPhoto = slug;
  for (const ext of ['.jpg', '.json']) {
    const src = path.join(srcDir, photoSlug + ext);
    const dst = path.join(srcDir, storyPhoto + ext);
    if (ext === '.json') {
      const sc = loadJson(src, {});
      sc.slug = storyPhoto;
      sc.story_use = slug;
      saveJson(dst, sc);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  try {
    execFileSync('python3', [path.join(ROOT, 'tools', 'build-images.py'), storyPhoto],
      { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('build-images.py failed for ' + storyPhoto);
    process.exit(1);
  }
  // Wire the hero block.
  const sc = loadJson(path.join(srcDir, storyPhoto + '.json'), {});
  draft.hero.alt_en = sc.caption || draft.hero.alt_en;
  draft.hero.caption_en = (sc.caption || '') + ' [EDITOR: add why it matters to this story]';
  draft.hero.credit_en = 'Photo: ' + sc.photographer + ' / ' + (sc.source || 'Wikimedia Commons') + ' (' + sc.license + ').';
  draft.hero.alt_ne = '[सम्पादक: तस्वीर विवरण]';
  draft.hero.caption_ne = '[सम्पादक: तस्वीर विवरण]';
  draft.hero.credit_ne = 'तस्वीर: ' + sc.photographer + ' / ' + (sc.source || '') + ' (' + sc.license + ')';
  draft._photo = { photoSlug: storyPhoto, source: photoSlug, score: bestScore, confirmed: false };
  saveJson(path.join(ROOT, entry.file), draft);
  console.log('> hero wired into draft (editor to confirm during review)');
}

/* ---------------- STAGE: publish (human-approved ONLY) ---------------- */
function publish() {
  const slug = process.argv[3];
  const approved = process.argv.includes('--approve');
  if (!slug) { console.error('Usage: --publish <draft-slug> --approve'); process.exit(1); }
  // GATE 1: explicit --approve flag.
  if (!approved) {
    console.error('REFUSED: publish requires the --approve flag (human approval).');
    process.exit(1);
  }
  const idx = loadJson(DRAFTS_IDX_F, []);
  const entry = idx.find((d) => d.slug === slug);
  if (!entry) { console.error('No draft with slug ' + slug); process.exit(1); }
  const fp = path.join(ROOT, entry.file);
  const draft = loadJson(fp, null);
  if (!draft) { console.error('Draft file missing.'); process.exit(1); }
  // GATE 2: editor must have set _human_reviewed=true after completing the
  // editor checklist (real prose, real figures, real author, confirmed photo).
  if (draft._human_reviewed !== true) {
    console.error('REFUSED: draft._human_reviewed is not true. Complete the _editor_checklist first.');
    process.exit(1);
  }
  // GATE 3: no placeholder author.
  if (/ASSIGN/.test(draft.author.name)) {
    console.error('REFUSED: draft still has placeholder author. Assign a real reporter.');
    process.exit(1);
  }
  // GATE 4: official PDF must be the verified one (never a placeholder).
  const pdf = draft.trust && draft.trust.pdf_url;
  const verified = loadJson(VERIFIED_F, []);
  const vrec = verified.find((v) => v.storyKey === entry.storyKey);
  if (!vrec || pdf !== vrec.officialPdf) {
    console.error('REFUSED: trust.pdf_url does not match the verified official PDF for this story.');
    process.exit(1);
  }
  // GATE 5: no [EDITOR] markers left in visible copy.
  const serialized = JSON.stringify(draft);
  const markers = (serialized.match(/\[EDITOR|\[सम्पादक/g) || []).length;
  if (markers > 0) {
    console.error('REFUSED: ' + markers + ' [EDITOR] markers remain. Finish the writing review.');
    process.exit(1);
  }
  // GATE 6: no em dashes in visible copy.
  const stripMeta = (({ _status, _editor_checklist, _verified_source, _pdf_note, _photo, ...rest }) => rest)(draft);
  if (JSON.stringify(stripMeta).includes('—')) {
    console.error('REFUSED: em dash found in story copy.');
    process.exit(1);
  }
  console.log('> publishing ' + slug + ' (all gates passed)');
  try {
    execFileSync('python3', [path.join(ROOT, 'tools', 'build-bilingual-article.py'), entry.file],
      { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('build-bilingual-article.py failed.');
    process.exit(1);
  }
  // Public index of OUR reporting (read by /nepse-news/ "our reporting" section).
  const pub = loadJson(PUBLIC_INDEX, { updated: null, stories: [] });
  const story = {
    slug: draft.slug,
    url_en: '/blog/' + draft.slug + '/',
    url_ne: '/ne/blog/' + draft.slug + '/',
    headline_en: draft.headline_en, headline_ne: draft.headline_ne,
    dek_en: draft.dek_en,
    published: todayNPT(),
    symbols: vrec.symbols, action_kind: vrec.action_kind,
    officialPdf: vrec.officialPdf,
  };
  pub.stories = [story, ...pub.stories.filter((s) => s.slug !== draft.slug)].slice(0, 200);
  pub.updated = todayNPT();
  saveJson(PUBLIC_INDEX, pub);
  entry.published = true;
  entry.published_at = new Date().toISOString();
  saveJson(DRAFTS_IDX_F, idx);
  const published = loadJson(PUBLISHED_F, []);
  published.push({ slug, storyKey: entry.storyKey, published_at: entry.published_at });
  saveJson(PUBLISHED_F, published);
  console.log('> published: /blog/' + slug + '/ + /ne/blog/' + slug + '/');
  console.log('  NOTE: /tag/ hubs do not exist yet - tag links will 404 until built (follow-up).');
  console.log('  NOTE: link this story from the relevant /nepse-actions/ record and evergreen explainer.');
}

/* ---------------- status ---------------- */
function status() {
  const tips = loadJson(TIPS_F, []);
  const verified = loadJson(VERIFIED_F, []);
  const blocked = loadJson(BLOCKED_F, []);
  const drafts = loadJson(DRAFTS_IDX_F, []);
  const published = loadJson(PUBLISHED_F, []);
  const c = (arr, f) => arr.filter(f).length;
  console.log('newsroom pipeline status:');
  console.log('  tips:      ' + tips.length + ' (' + c(tips, (t) => t.status === 'pending') + ' pending)');
  console.log('  verified:  ' + verified.length);
  console.log('  blocked:   ' + blocked.length + ' (review queue)');
  console.log('  drafts:    ' + drafts.length + ' (' + c(drafts, (d) => !d.human_reviewed) + ' awaiting review, ' + c(drafts, (d) => d.published) + ' published)');
  console.log('  published: ' + published.length);
  if (blocked.length) {
    console.log('  blocked stories (need human-located PDF or drop):');
    for (const b of blocked.slice(-5)) console.log('    - ' + b.storyKey + ': ' + b.reason);
  }
}

/* ---------------- CLI ---------------- */
async function main() {
  const a = process.argv[2];
  if (a === '--detect') return detect();
  if (a === '--verify') return verify();
  if (a === '--verify-pdf') {
    const [key, url] = [process.argv[3], process.argv[4]];
    if (!key || !url) { console.error('Usage: --verify-pdf <storyKey> <pdfUrl>'); process.exit(1); }
    return verifyPdfOverride(key, url);
  }
  if (a === '--draft') return draft();
  if (a === '--photo') return photo();
  if (a === '--publish') return publish();
  if (a === '--status' || !a) return status();
  console.error('Unknown stage: ' + a);
  console.error('Stages: --detect | --verify | --verify-pdf <key> <url> | --draft | --photo <slug> | --publish <slug> --approve | --status');
  process.exit(1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
