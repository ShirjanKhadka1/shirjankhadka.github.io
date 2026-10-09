#!/usr/bin/env node
/* NEPSE Alpha Lab — market news collector.
 *
 * Fetches Nepali business-news RSS feeds, matches headlines to listed
 * symbols (ticker or company name), and writes a rolling 7-day file:
 *   nepse-chart/data/news.json
 *
 * Headlines only — always attributed to the source with an outbound link.
 * Nothing is rewritten or presented as our own reporting.
 *
 * Matching (no ML, transparent rules):
 *   1. Whole-word ticker match (e.g. "NABIL") + a market keyword nearby,
 *      so common-word tickers like API don't false-positive.
 *   2. Company-name match: corporate suffixes stripped ("Nabil Bank
 *      Limited" -> "nabil"), matched as a phrase or as all core tokens.
 * Latin tickers also match inside Nepali-language headlines.
 *   5. Disambiguation: when several symbols match one headline via a single
 *      shared token, only the best-evidenced symbol(s) are kept; ties with
 *      < 2 distinctive tokens are dropped (the headline is about the theme,
 *      not a specific company).
 *
 * Node 18+, no npm dependencies. Run: node tools/build-nepse-news.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'nepse-chart', 'data', 'news.json');
const UNIVERSE = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (NEPSE-Alpha-Lab news collector)' };
const KEEP_DAYS = 30;
const MAX_ITEMS = 500;

const FEEDS = [
  { src: 'Arthasansar', url: 'https://arthasansar.com/feed' },
  { src: 'BizMandu', url: 'https://bizmandu.com/feed' },
  { src: 'OnlineKhabar', url: 'https://www.onlinekhabar.com/feed' },
  { src: 'OnlineKhabar EN', url: 'https://english.onlinekhabar.com/feed' },
  { src: 'MeroLagani', url: 'https://merolagani.com/feed' },
];

// English + Nepali market keywords that qualify a bare ticker mention.
const MARKET_KW = [
  'share', 'shares', 'stock', 'stocks', 'nepse', 'bonus', 'dividend', 'right',
  'agm', 'merger', 'acquisition', 'profit', 'loss', 'ipo', 'fpo', 'debenture',
  'price', 'circuit', 'turnover', 'eps', 'book closure', 'bookclose', 'auction',
  'promoter', 'lock-in', 'lockin', 'capital', 'general meeting',
  // Nepali
  'सेयर', 'शेयर', 'नेप्से', 'लाभांश', 'बोनस', 'हकप्रद', 'साधारण सभा',
  'मर्जर', 'मूल्य', 'नाफा', 'घाटा', 'आइपिओ', 'बन्द', 'सञ्चालन', 'उत्पादन',
  'सञ्चालक', 'नियुक्त', 'कारोबार', 'लगानीकर्ता', 'पुँजी', 'घट्यो', 'बढ्यो',
];

// Corporate suffixes stripped from the END of a company name to get its core.
const SUFFIX = new Set([
  'limited', 'ltd', 'bank', 'finance', 'bittiya', 'sanstha', 'laghubitta',
  'microfinance', 'hydropower', 'hydro', 'jalvidhyut', 'power', 'energy',
  'insurance', 'life', 'general', 'mutual', 'fund', 'yojana', 'scheme',
  'development', 'investment', 'securities', 'debenture', 'preference',
  'company', 'co', 'corporation', 'group', 'holding', 'merchant', 'capital',
  'leasing', 'credit', 'finance', 'bikas',
]);
// Tokens too generic to match on their own.
const GENERIC = new Set([...SUFFIX, 'nepal', 'nepali', 'national', 'everest',
  'himalayan', 'new', 'prime', 'global', 'united', 'standard',
  'and', 'the', 'of', 'construction', 'general',
  // Place names: a headline mentioning a city/district/landmark is usually
  // NOT about the company named after it (Butwal Chamber vs Butwal Power,
  // Pokhara flights vs Pokhara Finance, Dailekh politics vs Dolakha Hydro).
  // Companies that genuinely need a place-name match get a manual NE_ALIAS.
  'butwal', 'pokhara', 'biratnagar', 'birgunj', 'dharan', 'nepalgunj',
  'dhangadhi', 'mahendranagar', 'hetauda', 'itahari', 'janakpur',
  'kathmandu', 'lalitpur', 'bhaktapur', 'kirtipur', 'dolakha', 'dailekh',
  'lumbini', 'sagarmatha', 'manakamana', 'bandipur', 'kalinchowk',
  'chitwan', 'gorkha', 'lamjung', 'kaski', 'rupandehi', 'dang', 'banke',
  'bardiya', 'kailali', 'kanchanpur', 'saptari', 'siraha', 'dhanusha',
  'mahottari', 'sarlahi', 'rautahat', 'bara', 'parsa', 'makwanpur',
  'kavre', 'sindhuli', 'ramechhap', 'sindhupalchok', 'nuwakot', 'dhading',
  // Common nouns that don't identify a company on their own (Manakamana
  // cable-car news vs Bandipur Cablecar; temple "darshan" vs companies
  // named "... Darshan").
  'cablecar', 'cable', 'darshan', 'tourism', 'travels', 'holiday']);
// Common Nepali function words whose consonant skeletons collide with
// company aliases (मात्रै "mtr" vs MDB's मितेरी "mtr"). These tokens are
// never used for skeleton matching; the real alias token still matches.
// (2026-10-09: "मात्र" — the more common form — fired MDB on a branding
// interview headline, "उत्पादन मात्र पर्याप्त छैन ...".)
const DEVA_STOPWORDS = new Set(['मात्रै', 'मात्र']);

// Noise words that carry no identifying power when scoring how well a
// headline matches a company name. Corporate SUFFIX words (bank, insurance,
// hydropower...) are deliberately KEPT: "प्रभु बैंक" vs "प्रभु इन्स्योरेन्स"
// is exactly the distinction the disambiguation pass needs.
const EVIDENCE_NOISE = new Set(['limited', 'ltd', 'company', 'co', 'corp',
  'incorporated', 'inc', 'the', 'and', 'of']);
// GENERIC minus SUFFIX: "nepal"/"everest"/place-names stay excluded from
// evidence, but bank/insurance/hydropower-style words count.
const EVIDENCE_GENERIC = new Set([...GENERIC].filter((w) => !SUFFIX.has(w)));

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function stripTags(s) { return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

// Build per-symbol match aliases from the universe names.
// ---- Devanagari-aware fuzzy matching ----
// Nepali business headlines transliterate company names ("इस्टर्न हाइड्रोपावरले").
// We match on consonant skeletons: Devanagari consonants are mapped to Latin,
// vowels (and y) are dropped on both sides, so "sayapatri" <-> "सयपत्री"
// both become "sptr". Postpositions ("-ले", "-को") are handled by substring
// matching on headline tokens.
const DEVA_CONS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'k', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'र': 'r', 'ल': 'l', 'व': 'w',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ं': 'n', 'ँ': 'n',
};
// Skipped: vowel signs, virama, independent vowels, and य (dropped like Latin y,
// so "sayapatri" and "सयपत्री" both reduce to "sptr").
const DEVA_SKIP = new Set([...'ािीुूृॄेैोौःय', '्', 'अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'ऋ']);

function skeleton(tok) {
  tok = tok.toLowerCase();
  let out = '';
  const isDeva = /[\u0900-\u097F]/.test(tok);
  if (isDeva) {
    for (const ch of tok) {
      if (DEVA_CONS[ch]) out += DEVA_CONS[ch];
      // vowel signs, virama, independent vowels: skipped
    }
  } else {
    for (const ch of tok) {
      if (!/[a-z]/.test(ch)) continue;
      if ('aeiouy'.includes(ch)) continue;
      // x -> ksh: क्ष (लक्ष्मी/laxmi, महालक्ष्मी/mahalaxmi). (2026-10-07:
      // "mahalaxmi" reduced to "mhlxm" but महालक्ष्मी to "mhlkshm".)
      out += (ch === 'c' ? 'k' : ch === 'x' ? 'ksh' : ch);
    }
  }
  return out;
}

// Manual Nepali renderings for big names the press translates instead of
// transliterating (e.g. "कृषि विकास बैंक" for Agricultural Development Bank).
// Symbol -> list of Devanagari phrases/tokens commonly used in headlines.
const NE_ALIAS = {
  ADBL: ['कृषि विकास'],
  NABIL: ['नबिल'],
  NBL: ['नेपाल बैंक'],
  NICA: ['एनआईसी एसिया', 'एनआईसी एशिया'],
  HBL: ['हिमालयन'],
  HLBSL: ['हिमालयन लघुवित्त'],
  SCB: ['स्टान्डर्ड चार्टर्ड'],
  NIFRA: ['निफ्रा'],
  HIDCL: ['एचआईडीसीएल'],
  MDB: ['मितेरी'],
  RHGCL: ['राप्ती'],
  UAIL: ['युनाइटेड अजोड'],
  SPHL: ['सयपत्री'],
  SHINE: ['शाइन रेसुंगा', 'रेसुंगा'],
  SALICO: ['सगरमाथा लुम्बिनी'],
};

function buildAliases(symbols) {
  const out = [];
  for (const e of symbols) {
    const sym = e.s, name = e.n || sym;
    const words = name.toLowerCase().replace(/[^a-z0-9\s&]/g, ' ').split(/\s+/).filter(Boolean);
    let core = words.slice();
    while (core.length > 1 && SUFFIX.has(core[core.length - 1])) core.pop();
    const coreTokens = core.filter((w) => w.length > 2 && !GENERIC.has(w));
    let short = words.slice();
    while (short.length > 1 && (short[short.length - 1] === 'limited' || short[short.length - 1] === 'ltd')) short.pop();
    const skels = coreTokens.map(skeleton).filter((s) => s.length >= 4);
    // Manually vetted Nepali aliases match as a PHRASE: every token's
    // skeleton must be present (single-token aliases still match on that
    // one token). This stops e.g. ADBL's "कृषि विकास" firing on any
    // "विकास बैंक" headline — गरिमा विकास बैंक is not ADBL.
    const nePhrases = (NE_ALIAS[sym] || []).map((p) =>
      p.split(/\s+/).map(skeleton).filter((s) => s.length >= 3)).filter((a) => a.length);
    out.push({
      sym,
      tickerRe: new RegExp('(^|[^a-z0-9])' + sym.toLowerCase().replace(/[^a-z0-9]/g, '') + '([^a-z0-9]|$)', 'i'),
      phrase: short.join(' '),
      coreTokens,
      skels: [...new Set(skels)],
      nePhrases,
      // Full distinctive name tokens (suffixes kept: bank/insurance/
      // hydropower disambiguate sister companies). Used only by the
      // disambiguation pass below, never for the initial match.
      fullTokens: words.filter((w) => w.length > 2 && !/^\d+$/.test(w) &&
        !EVIDENCE_GENERIC.has(w) && !EVIDENCE_NOISE.has(w)),
    });
  }
  return out;
}

function matchSymbol(title, aliases) {
  const t = ' ' + title.toLowerCase() + ' ';
  // Keyword gate: 'बन्द' must not fire inside "बन्दै" (becoming) or similar
  // word stems — a Devanagari vowel sign right after it means a different
  // word, not a closure. (2026-10-07: a cricket headline "सन्तुलित बन्दै टोली"
  // wrongly gated CSY via this substring + the सन्तुलित/santulit skeleton.)
  const kwHit = (k) => (k === 'बन्द'
    ? /बन्द(?![\u093E-\u094C\u0962\u0963])/.test(t)
    : t.includes(k));
  const hasKw = MARKET_KW.some(kwHit);
  const tokens = title.toLowerCase().split(/[^\u0900-\u097Fa-z0-9]+/)
    .filter((w) => w.length >= 2 && !DEVA_STOPWORDS.has(w));
  const hs = tokens.map(skeleton);
  // Weak skeleton matches ignore generic corporate words: "corporation" must
  // not weakly match CORBL's "corporate" skeleton, "nepal" must not match, etc.
  const hsWeak = tokens
    .filter((w) => !SUFFIX.has(w) && !GENERIC.has(w))
    .map(skeleton);
  const hits = [];
  for (const a of aliases) {
    let strong = false, weak = false;
    // 1) English company-name phrase match.
    if (a.phrase.length >= 4 && t.includes(' ' + a.phrase + ' ')) strong = true;
    // 2) All English core tokens present as whole words (never substrings:
    //    "mandu" must not fire on "Kathmandu", "rawa" on "Betrawati").
    //    A single common-word token is weak on its own — it also needs a
    //    market keyword ("union" in an art headline is not Union Hydropower).
    if (!strong && a.coreTokens.length >= 1 &&
      a.coreTokens.every((w) => tokens.includes(w)) &&
      (a.coreTokens.length >= 2 || hasKw)) strong = true;
    // 3) Consonant-skeleton match (handles Nepali transliterations).
    //    Always needs a market keyword: short skeletons collide with common
    //    Nepali words (e.g. दलित "dlt" vs DOLTI). Auto-derived skeletons are
    //    all length >= 4; vetted manual aliases (>= 3) match as phrases.
    if (!strong && hasKw) {
      const autoHit = (minLen) => {
        for (const s of a.skels) {
          if (s.length < minLen) continue;
          for (const h of hs) {
            if (!h) continue;
            if (h === s) return 2;
          }
          // Weak: skeleton contained in a longer headline token's skeleton.
          // Generic corporate words are excluded (see hsWeak).
          if (s.length >= 5) {
            for (const h of hsWeak) {
              if (h && h.includes(s)) return 1;
            }
          }
        }
        return 0;
      };
      if (autoHit(4) === 2) strong = true;
      else if (autoHit(4) === 1) weak = true;
      if (!strong && !weak) {
        for (const phrase of a.nePhrases) {
          // Prefix match: postpositions attach to the last token
          // ("लघुवित्तकी", "बैंकको") — the alias still identifies the company.
          if (phrase.every((s) => hs.some((h) => h === s || h.startsWith(s)))) { strong = true; break; }
        }
      }
    }
    // 4) Bare ticker + market keyword (catches Nepali headlines too).
    // A ticker that is also a common English word (upper/lower) identifies
    // the company only with a market keyword or a distinctive co-token —
    // a bare whole-word "upper" is usually the adjective. (2026-10-09:
    // "Yeti Air suspends upper-class fares ..." was live tagged UPPER.)
    if (!strong && !weak && a.tickerRe.test(t)) {
      const distinctive = a.coreTokens.some(
        (w) => tokens.includes(w) && !COMMON_WORD_TOKENS.has(w));
      if (hasKw || distinctive) strong = true;
    }
    if (strong || (weak && hasKw)) hits.push(a);
  }
  return disambiguate(title, hits);
}

// How many of the company's distinctive name tokens actually appear in the
// headline (English whole-word or Devanagari skeleton). Suffixes count:
// "प्रभु बैंक" scores 2 for PRVU (prabhu+bank) but 1 for PRIN (prabhu only).
// An explicit ticker mention counts 2; each matched vetted Nepali phrase
// counts its tokens. Empty skeletons (digits, vowel-only tokens) are skipped
// so e.g. "2087" can never count as evidence.
function evidenceCount(title, a) {
  const t = ' ' + title.toLowerCase() + ' ';
  const toks = title.toLowerCase().split(/[^\u0900-\u097Fa-z0-9]+/)
    .filter((w) => w.length >= 2);
  const hs = toks.map(skeleton);
  let n = 0;
  if (a.tickerRe.test(t)) n += 2;
  for (const w of a.fullTokens) {
    const sk = skeleton(w);
    if (!sk) continue;
    // Prefix: postpositions attach ("बैंकको" still evidences bank).
    if (toks.includes(w) || hs.some((h) => h === sk || h.startsWith(sk))) n++;
  }
  for (const phrase of a.nePhrases) {
    if (phrase.length > 0 &&
        phrase.every((s) => hs.some((h) => h === s || h.startsWith(s)))) n += phrase.length;
  }
  return n;
}

// Drop wrong-company pile-ups. Several symbols routinely match one headline
// via a single shared token ("प्रभु" -> 7 Prabhu-group companies,
// "प्रमोटर" -> every promoter-share line, "बन्दसत्र" -> Ghorahi Cement via
// a skeleton substring). Keep every symbol with >= 2 distinctive tokens of
// evidence (genuine multi-company headlines keep all subjects); when the
// best evidence is < 2, the headline is about the shared token's theme —
// not a specific company — so emit nothing.
// (2026-10-07: PMLI promoter-sale story was live on 8 wrong symbols' tabs.)
function disambiguate(title, hits) {
  if (hits.length === 0) return [];
  const scored = hits.map((a) => ({ sym: a.sym, e: evidenceCount(title, a) }));
  const best = Math.max(...scored.map((s) => s.e));
  if (best === 0) return [];                     // no real evidence: drop
  if (hits.length === 1) return [scored[0].sym]; // unambiguous: keep
  if (best < 2) return [];                        // shared-token tie: drop
  return [...new Set(scored.filter((s) => s.e >= 2).sort((a, b) => b.e - a.e).map((s) => s.sym))];
}

// Company-name tokens that are also ordinary English words: they must not
// identify a company on their own in rule 4 (bare ticker). A distinctive
// co-token ("tamakoshi") or a market keyword ("dividend") still matches.
const COMMON_WORD_TOKENS = new Set(['upper', 'lower']);

// Market-wide headlines: NEPSE index moves, turnover, whole-market moves.
// Mirrors the page's own "Markets" newsCategory rule. A company symbol may
// sit on one only with EXPLICIT evidence (bare ticker or full company-name
// phrase) — skeleton/weak/core-token matches misfire on generic words.
// (2026-10-09: "NEPSE gains 11.96 points, turnover declines" was live with
// SAPIL; "Stock market falls double digits" with RFPL.)
const MARKET_INDEX = /nepse|stock market|share market|\bmarket\s+(falls|rises|gains|index)|index\s+(falls|rises|gains)|turnover\s+(tops|crosses|declines)|bullish|bearish/i;

// Commodity/macro price headlines: gold, silver, oil, forex moves are not
// company news. A symbol survives one only with explicit evidence, same as
// the market-index gate. (2026-10-09: "Gold price rises by Rs 500 per tola"
// was live tagged RFPL via the 'price' keyword + 'falls' skeleton.)
const COMMODITY = /gold|silver|crude\s*oil|\bpetrol\b|\bdiesel\b|forex|\bdollar\b|exchange\s*rate|remittance/i;

function hasExplicitEvidence(title, a) {
  const t = ' ' + String(title || '').toLowerCase() + ' ';
  if (a.tickerRe.test(t)) return true;
  return !!(a.phrase && a.phrase.length >= 4 && t.includes(' ' + a.phrase + ' '));
}

function explicitCompanySyms(title, syms, aliases) {
  return syms.filter((sym) => {
    const a = aliases.find((x) => x.sym === sym);
    return a && hasExplicitEvidence(title, a);
  });
}

async function fetchFeed(f) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(f.url, { headers: UA, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function parseItems(xml, src) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const get = (n) => {
      const m = b.match(new RegExp('<' + n + '[\\s>]([\\s\\S]*?)</' + n + '>', 'i'));
      if (!m) return '';
      return decodeEntities(stripTags(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')));
    };
    const title = get('title');
    const link = get('link') || (b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || '';
    if (!title || !link) continue;
    const dm = b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    let date = new Date().toISOString();
    if (dm) { const d = new Date(stripTags(dm[1])); if (!isNaN(d)) date = d.toISOString(); }
    items.push({ title, link: stripTags(link), src, date });
  }
  return items;
}

async function main() {
  console.log('> NEPSE news collector');
  const uni = JSON.parse(fs.readFileSync(UNIVERSE, 'utf8'));
  const aliases = buildAliases(uni.symbols || []);
  console.log('  symbols in dictionary:', aliases.length);

  let fetched = 0;
  const fresh = [];
  for (const f of FEEDS) {
    try {
      const xml = await fetchFeed(f);
      const items = parseItems(xml, f.src);
      fetched += items.length;
      console.log('  ' + f.src + ': ' + items.length + ' items');
      fresh.push(...items);
    } catch (e) {
      console.log('  !! ' + f.src + ' failed: ' + e.message);
    }
  }

  // One link = one row: a headline matched to several symbols keeps only
  // the best-evidenced symbol (disambiguate returns best-first). The old
  // sym|link key emitted the same story once per symbol (2026-10-08: the
  // Beni Hydropower registrar story lived on 8 symbols' rows).
  const matched = [];
  const seenLink = new Set();
  for (const it of fresh) {
    if (seenLink.has(it.link)) continue;
    seenLink.add(it.link);
    const syms0 = matchSymbol(it.title, aliases);
    // Market-wide or commodity story: keep a company symbol only with
    // explicit evidence; genuine market headlines with no company stay in
    // the feed as sym=null.
    const isMacro = MARKET_INDEX.test(it.title) || COMMODITY.test(it.title);
    const syms = (syms0.length && isMacro)
      ? explicitCompanySyms(it.title, syms0, aliases)
      : syms0;
    matched.push({ sym: syms.length ? syms[0] : null, syms, title: it.title, link: it.link, src: it.src, date: it.date.slice(0, 10) });
  }

  // Merge with the existing rolling file; drop items older than KEEP_DAYS.
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).items || []; } catch (e) { /* first run */ }
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const byLink = new Map();
  // Retroactive scrub: old rows merged from previous runs keep a company
  // symbol only if the current matcher still produces it for that title.
  // Covers the market-index/commodity explicit-evidence rule AND fossil
  // symbols from older matcher versions (2026-10-09: PBLD87 fossil rows on
  // the Prabhu Mahalaxmi Life promoter-sale and Beni Hydropower registrar
  // headlines; the current matcher says PMLI / nothing).
  const isMacro = (title) => MARKET_INDEX.test(title || '') || COMMODITY.test(title || '');
  for (const it of prev) {
    if (!it.sym) continue;
    const re = matchSymbol(it.title || '', aliases);
    const gated = (re.length && isMacro(it.title))
      ? explicitCompanySyms(it.title, re, aliases) : re;
    if (!gated.includes(it.sym)) { it.sym = null; it.syms = []; }
  }
  for (const it of matched.concat(prev)) {
    if (!byLink.has(it.link)) byLink.set(it.link, it);
  }
  const items = [...byLink.values()]
    .filter((it) => new Date(it.date + 'T00:00:00Z').getTime() >= cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, MAX_ITEMS);

  const symCount = new Set(items.map((i) => i.sym)).size;
  const out = {
    asof: new Date().toISOString().slice(0, 10),
    sources: FEEDS.map((f) => f.src),
    note: 'Headlines only, attributed to source publications with outbound links.',
    items,
    stats: { fetched, matched: matched.length, kept: items.length, symbols: symCount },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('  fetched=' + fetched + ' matched=' + matched.length +
    ' kept=' + items.length + ' symbols=' + symCount);
  console.log('> wrote ' + OUT);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
