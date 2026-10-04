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
 *
 * Node 18+, no npm dependencies. Run: node tools/build-nepse-news.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'nepse-chart', 'data', 'news.json');
const UNIVERSE = path.join(ROOT, 'nepse-chart', 'data', 'universe.json');
const UA = { 'User-Agent': 'NepseDecode/1.0 (+https://shirjankhadka.com.np; contact: shirjan.2.khadka@gmail.com)' };
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
  // named "... Darshan"). "panel" as in committee/government panel vs
  // SY Panel Nepal; "house" as in parliament vs companies with House.
  'cablecar', 'cable', 'darshan', 'tourism', 'travels', 'holiday',
  'panel', 'house', 'committee', 'subcommittee', 'minister',
  'ministry', 'government', 'election', 'police', 'uniform', 'procurement',
  // 'city' — "Manchester City" (football) vs CITY the NEPSE company.
  // Ticker-only match now requires a market keyword (rule 4).
  'city']);
// Companies named after places (JHAPA/Jhapa Energy, MANDU/Mandu Hydro).
// A headline mentioning only the place (wildlife, district news) is NOT
// about the company — require company-context keywords for these.
const PLACE_COMPANIES = {
  'JHAPA': ['energy', 'hydropower', 'power', 'electricity'],
  'MANDU': ['hydropower', 'hydro', 'power', 'energy'],
  'PFL': ['finance', 'banking', 'loan'],
  'BPCL': ['power', 'energy', 'hydropower', 'electricity'],
};
// Words indicating the headline is about the PLACE, not the company.
const PLACE_CONTEXT = new Set([
  'elephant', 'wildlife', 'wild', 'animal', 'forest', 'jungle',
  'district', 'municipality', 'rural', 'village', 'farmer', 'agriculture',
  'land', 'issues', 'urges', 'magar', 'mp', // "MP Rana Magar urges..." is politics
  // "Kathmandu" the city vs MANDU the hydro — "mandu" substring must not match.
  'kathmandu', 'valley', 'urban', 'transport', 'master', 'plan',
]);
// Common Nepali function words whose consonant skeletons collide with
// company aliases (मात्रै "mtr" vs MDB's मितेरी "mtr"). These tokens are
// never used for skeleton matching; the real alias token still matches.
const DEVA_STOPWORDS = new Set(['मात्रै']);

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
      out += (ch === 'c' ? 'k' : ch); // nic <-> निक
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
  NICA: ['एनआईसी एसिया', 'एनआईसी एशिया'],
  HBL: ['हिमालयन'],
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
    });
  }
  return out;
}

function matchSymbol(title, aliases) {
  const t = ' ' + title.toLowerCase() + ' ';
  const hasKw = MARKET_KW.some((k) => t.includes(k));
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
          if (phrase.every((s) => hs.includes(s))) { strong = true; break; }
        }
      }
    }
    // 4) Bare ticker + market keyword (catches Nepali headlines too).
    if (!strong && !weak && a.tickerRe.test(t) &&
      (hasKw || a.coreTokens.some((w) => tokens.includes(w)))) strong = true;
    // 5) Place-named companies: "Jhapa" the district vs JHAPA the energy company.
    //    If headline has place-context words (wildlife, district, MP urges...)
    //    but no company-context words (energy, power, hydro...), it's about
    //    the place — reject the match.
    if ((strong || weak) && PLACE_COMPANIES[a.sym]) {
      const companyCtx = PLACE_COMPANIES[a.sym].some((w) => t.includes(' ' + w));
      const placeCtx = [...PLACE_CONTEXT].some((w) => tokens.includes(w));
      // Full company phrase ("jhapa energy") always counts as company context.
      const fullPhrase = t.includes(' ' + a.phrase + ' ');
      if (placeCtx && !companyCtx && !fullPhrase && !hasKw) {
        strong = false; weak = false;
      }
    }
    if (strong || (weak && hasKw)) hits.push(a.sym);
  }
  return hits;
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

  const matched = [];
  const seen = new Set();
  for (const it of fresh) {
    const syms = matchSymbol(it.title, aliases);
    for (const sym of syms) {
      const key = sym + '|' + it.link;
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push({ sym, title: it.title, link: it.link, src: it.src, date: it.date.slice(0, 10) });
    }
  }

  // Merge with the existing rolling file; drop items older than KEEP_DAYS.
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).items || []; } catch (e) { /* first run */ }
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const byKey = new Map();
  for (const it of prev.concat(matched)) {
    const key = it.sym + '|' + it.link;
    if (!byKey.has(key)) byKey.set(key, it);
  }
  const items = [...byKey.values()]
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
