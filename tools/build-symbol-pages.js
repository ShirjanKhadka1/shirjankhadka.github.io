#!/usr/bin/env node
/* Nepse Decode — per-symbol indexable company pages.
 *
 * Reads universe.json, verdicts.json (with d/w/m verdicts) and news.json
 * from the daily batch and emits one static, fully indexable page per
 * instrument at stocks/{SYM}/index.html (slash in symbol becomes "-").
 * Also emits stocks/index.html, a plain alphabetical directory of all pages.
 *
 * Everything on the page comes from the batch data. No invented figures,
 * no valuations, no price targets, no buy/sell calls. Verdict pills are
 * the transparent rule-based Engine Verdict readings with their asof
 * dates; timeframes without enough history say so honestly.
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'nepse-chart', 'data');
const OUT = path.join(ROOT, 'stocks');
const SITE = 'https://shirjankhadka.com.np';

const loadJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const slugOf = (sym) => String(sym).replace(/\//g, '-');

/* NEPSE sector classifier — kept identical to js/nepse-sectors.js and
 * js/nepse-screener.js. Verified symbol overrides are checked FIRST,
 * then NEPSE-official symbol overrides (NIFRA must precede the 'bank'
 * keyword; HIDCLP must precede the Promoter-share instrument check).
 * Anything left over falls into "Others" — never "Unclassified". */
const DEB_SYM_RE = /D\d{2,4}(\/\d{2})?(KA)?$/i;
const SECTOR_OVERRIDES = {
  GVL:'Hydropower', SNORL:'Hydropower',
  BNL:'Manufacturing And Processing', UNL:'Manufacturing And Processing',
  SAIL:'Manufacturing And Processing',
  CGH:'Hotels And Tourism', KDL:'Hotels And Tourism',
  SAGF:'Mutual Funds', H8020:'Mutual Funds', NMB50:'Mutual Funds',
  CMF2:'Mutual Funds', NICBF:'Mutual Funds', LSH12:'Mutual Funds',
  RBBF40:'Mutual Funds',
  JBLBP:'Promoter Shares', KBLPO:'Promoter Shares', MLBLPO:'Promoter Shares',
  SCBD:'Debentures', SHINED:'Debentures',
  SFCL:'Finance',
  WNLB:'Microfinance',
  NTC:'Others', NRM:'Others', NWCL:'Others', TTL:'Others', MKCL:'Others'
};
const INVESTMENT_SYMBOLS = { CIT:1, HIDCL:1, HIDCLP:1, NIFRA:1, NRN:1, CHDC:1, ENL:1, HATHY:1 };
const TRADING_SYMBOLS = { BBC:1, STC:1 };
function classifySymbol(sym, name, type) {
  const symU = String(sym || '').toUpperCase();
  if (SECTOR_OVERRIDES[symU]) return SECTOR_OVERRIDES[symU];
  if (INVESTMENT_SYMBOLS[symU]) return 'Investment';
  if (TRADING_SYMBOLS[symU]) return 'Trading';
  const n = String(name || '').toLowerCase().replace(/lagubitta/g, 'laghubitta');
  if (type === 'Debenture' || DEB_SYM_RE.test(String(sym || '')) ||
      n.indexOf('bond') >= 0 || n.indexOf('rinpatra') >= 0) return 'Debentures';
  if (type === 'Mutual fund' || n.indexOf('fund') >= 0 || /\bkosh\b/.test(n)) return 'Mutual Funds';
  if (type === 'Promoter share') return 'Promoter Shares';
  if (type && type !== 'Equity') return 'Others';
  const has = (...ws) => ws.some((w) => n.indexOf(w) >= 0);
  if (has('laghu', 'microfinance')) return 'Microfinance';
  if (has('hydropower', 'hydro', 'power', 'urja', 'dhyut', 'dyut', 'energy')) return 'Hydropower';
  if (has('development bank')) return 'Development Bank';
  if (has('bank')) return 'Banking';
  if (has('life insurance')) return 'Life Insurance';
  if (has('reinsurance', 'insurance', 'beema')) return 'Non Life Insurance';
  if (has('finance')) return 'Finance';
  if (has('hotel', 'tourism', 'cablecar')) return 'Hotels And Tourism';
  if (has('investment')) return 'Investment';
  if (has('trading')) return 'Trading';
  if (has('manufacturing', 'cement', 'bottler', 'distiller', 'spinning', 'pharmaceut',
    'paints', 'colour', 'panel', 'mineral', 'lube')) return 'Manufacturing And Processing';
  return 'Others';
}

/* Sector group for choosing sector-appropriate fundamental metrics.
 * bank: deposit-taking lenders (bank-specific balance-sheet metrics apply).
 * ins: insurers (premium-driven; no deposits/loans/NPL).
 * inst: fund/debt instruments, not operating companies.
 * corp: everyone else (hydropower, manufacturing, hotels, investment, trading). */
function sectorGroup(sec) {
  if (sec === 'Banking' || sec === 'Development Bank' ||
      sec === 'Finance' || sec === 'Microfinance') return 'bank';
  if (sec === 'Life Insurance' || sec === 'Non Life Insurance') return 'ins';
  if (sec === 'Mutual Funds' || sec === 'Debentures' ||
      sec === 'Promoter Shares') return 'inst';
  return 'corp';
}

/* Company block styles (Wave E SEO): the static per-company profile +
 * key-stats list emitted by companyBlock(). Kept as a separate const so
 * tools/apply-stock-seo.js can inject the identical rules into legacy
 * baked pages that predate the inline SP_STYLES block. */
const SP_ABOUT_CSS =
'/* company block: static profile + key stats */\n' +
'.sp-about{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:var(--nd-s4) var(--nd-s5);margin:var(--nd-s5) 0;box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-about h2{margin-top:0}\n' +
'.sp-about p{color:var(--nd-muted,#B8C0CE);line-height:1.7;font-size:.95rem}\n' +
'.sp-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--nd-s3);margin:var(--nd-s4) 0 0}\n' +
'@media(min-width:700px){.sp-stats{grid-template-columns:repeat(3,1fr)}}\n' +
'.sp-stats div{background:rgba(255,255,255,.02);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);padding:var(--nd-s3)}\n' +
'.sp-stats dt{font-size:.72rem;color:var(--nd-dim,#8E98A8);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}\n' +
'.sp-stats dd{margin:0;font-size:.98rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n';

/* Stock pages: new design system (sig-pro) component styles.
 * Maps the template's existing class names to the dark/lime 3D design.
 * All element IDs and JS hooks are unchanged. */
const SP_STYLES =
'<style>\n' +
'/* price snapshot: hero card — nd-card depth language, token spacing scale */\n' +
'.sp-snap{margin:var(--nd-s6) 0}\n' +
'.sp-price-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 38%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);padding:var(--nd-s5) var(--nd-s6);box-shadow:var(--nd-rim),var(--nd-e2);display:flex;gap:var(--nd-s6);flex-wrap:wrap;align-items:flex-start;justify-content:space-between}\n' +
'.sp-price-main{min-width:200px}\n' +
'.sp-price{font-family:var(--nd-font-display,Georgia,serif);font-size:var(--step-4);font-weight:700;color:var(--nd-text,#fff);letter-spacing:-.01em}\n' +
'.sp-chg{font-size:.95rem;font-weight:700;margin-top:6px}\n' +
'.sp-chg.pos{color:var(--nd-up,#4ADE80)}\n' +
'.sp-chg.neg{color:var(--nd-down,#F87171)}\n' +
'.sp-live-badge{display:inline-block;margin-top:8px;padding:3px var(--nd-s3);border-radius:var(--nd-r-pill);font-size:.72rem;font-weight:700;background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10)}\n' +
'.sp-price-side{display:flex;gap:var(--nd-s6);flex-wrap:wrap}\n' +
'.sp-stat{display:flex;flex-direction:column;gap:var(--nd-s1)}\n' +
'.sp-stat-v{font-size:1.05rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n' +
'.sp-stat-l{font-size:.75rem;color:var(--nd-dim,#8E98A8);text-transform:uppercase;letter-spacing:.05em;font-weight:600}\n' +
'/* tabs: nd-tabs--pill language (contract in css/nd-chrome.css); the JS\n' +
'   contract is unchanged — .active class + aria-selected stay in sync,\n' +
'   roving tabindex + Arrow/Home/End keys per the APG tabs pattern */\n' +
'.sp-tabs{display:flex;gap:var(--nd-s2);margin:var(--nd-s2) 0 var(--nd-s6);flex-wrap:wrap}\n' +
'.sp-tab{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;font-family:var(--nd-font-sans);font-weight:600;font-size:.8125rem;color:var(--nd-muted,#B8C0CE);cursor:pointer;background:var(--nd-panel,#12141A);border:1px solid var(--nd-border-strong,#2A3140);border-radius:var(--nd-r-pill);box-shadow:var(--nd-rim),var(--nd-e1);transition:color var(--nd-t-fast) var(--nd-ease),background var(--nd-t-fast) var(--nd-ease),border-color var(--nd-t-fast) var(--nd-ease),box-shadow var(--nd-t-fast) var(--nd-ease)}\n' +
'.sp-tab:hover{color:var(--nd-text,#fff)}\n' +
'.sp-tab:focus-visible{outline:none;box-shadow:var(--nd-focus-ring)}\n' +
'.sp-tab.active{background:linear-gradient(180deg,color-mix(in srgb,var(--nd-lime,#B8E62E) 88%,#fff),var(--nd-lime,#B8E62E));color:var(--nd-on-lime,#0A0C10);border-color:transparent}\n' +
'.sp-tabpanel{margin-bottom:var(--nd-s2)}\n' +
'/* notes */\n' +
'.sp-note{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-left:4px solid var(--nd-lime,#B8E62E);border-radius:var(--nd-r-lg);padding:var(--nd-s4) var(--nd-s5);margin:var(--nd-s5) 0;font-size:.9rem;color:var(--nd-muted,#B8C0CE);line-height:1.65;box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-note strong{color:var(--nd-text,#fff)}\n' +
'/* overview links */\n' +
'.sp-links{list-style:none;margin:var(--nd-s5) 0;padding:0;display:grid;gap:var(--nd-s3)}\n' +
'.sp-links a{display:block;padding:var(--nd-s3) var(--nd-s5);border-radius:var(--nd-r-lg);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-weight:600;box-shadow:var(--nd-rim),var(--nd-e1);transition:border-color var(--nd-t-fast) var(--nd-ease),background var(--nd-t-fast) var(--nd-ease)}\n' +
'.sp-links a:hover{border-color:var(--nd-lime,#B8E62E);background:var(--nd-lime-faint)}\n' +
'/* verdict pills */\n' +
'.vpill{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:var(--nd-s4) var(--nd-s5);margin:var(--nd-s4) 0;box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.vpill-tf{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nd-dim,#8E98A8);margin-right:12px}\n' +
'.vpill-v{display:inline-block;padding:4px 14px;border-radius:999px;font-weight:700;font-size:.85rem}\n' +
'.vpill-v.vg-sb{background:var(--nd-up-soft);color:var(--nd-up,#4ADE80);border:1px solid rgba(74,222,128,.4)}\n' +
'.vpill-v.vg-b{background:var(--nd-lime-soft);color:var(--nd-lime,#B8E62E);border:1px solid rgba(184,230,46,.35)}\n' +
'.vpill-v.vg-h{background:rgba(255,255,255,.06);color:var(--nd-muted,#B8C0CE);border:1px solid var(--nd-border,#1E2430)}\n' +
'.vpill-v.vg-e{background:var(--nd-down-soft);color:var(--nd-down,#F87171);border:1px solid rgba(248,113,113,.35)}\n' +
'.vpill-v.vg-se{background:rgba(248,113,113,.2);color:#FCA5A5;border:1px solid rgba(248,113,113,.5)}\n' +
'.vpill-v.vg-na{background:rgba(255,255,255,.04);color:var(--nd-dim,#8E98A8);border:1px solid var(--nd-border,#1E2430)}\n' +
'.vpill-meta{display:block;margin-top:8px;font-size:.82rem;color:var(--nd-dim,#8E98A8)}\n' +
'.vpill-na{color:var(--nd-dim,#8E98A8);font-size:.88rem}\n' +
'/* fundamentals */\n' +
'.sp-fund-group{margin:var(--nd-s6) 0}\n' +
'.sp-fund-sub{font-size:1rem;font-weight:700;color:var(--nd-text,#fff);margin:0 0 12px}\n' +
'.sp-fund-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--nd-s3)}\n' +
'@media(min-width:700px){.sp-fund-grid{grid-template-columns:repeat(3,1fr)}}\n' +
'.sp-fund{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 38%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:var(--nd-s4);box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-fund-l{display:block;font-size:.75rem;color:var(--nd-dim,#8E98A8);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}\n' +
'.sp-fund-v{display:block;font-size:1.1rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n' +
'.sp-fund-v.na{color:var(--nd-dim,#8E98A8);font-weight:400}\n' +
'.sp-ret-v.pos{color:var(--nd-up,#4ADE80)}\n' +
'.sp-ret-v.neg{color:var(--nd-down,#F87171)}\n' +
'.sp-ret-ref{display:block;font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:.35rem}\n' +
'/* tables: markup carries .nd-table inside .nd-tablewrap, so the table\n' +
'   system in css/nd-chrome.css governs (sticky header + first column,\n' +
'   mono small-caps dim headers, surface-shift zebra, .num right-align).\n' +
'   Only stock-specific extras live here. Specificity note: the section\n' +
'   and current-row rules are written to tie nd-table\'s zebra/hover and\n' +
'   win on source order (this block loads after nd-chrome.css). */\n' +
'.sp-table-wrap{overflow:auto;margin:var(--nd-s5) 0;background:var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-peer-table tbody tr.cur td{background:var(--nd-lime-soft)}\n' +
'.sp-peer-table a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none}\n' +
'.sp-peer-table a:hover{color:var(--nd-lime,#B8E62E);text-decoration:underline}\n' +
'.sp-peer-table td.pos{color:var(--nd-up,#4ADE80);font-weight:700}\n' +
'.sp-peer-table td.neg{color:var(--nd-down,#F87171);font-weight:700}\n' +
'.sp-peer-table tbody tr.sp-sec-row td{background:var(--nd-panel-2,#161A23)}\n' +
'.sp-sec-row strong{font-family:var(--nd-font-mono,ui-monospace,monospace);font-weight:600;font-size:.6875rem;letter-spacing:.09em;text-transform:uppercase;color:var(--nd-dim,#8E98A8)}\n' +
'/* news */\n' +
'.sp-news{list-style:none;margin:var(--nd-s4) 0;padding:0;display:grid;gap:var(--nd-s3)}\n' +
'.sp-news li{padding:var(--nd-s4) var(--nd-s5);border-radius:var(--nd-r-lg);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-news a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none;line-height:1.5}\n' +
'.sp-news a:hover{color:var(--nd-lime,#B8E62E)}\n' +
'.sp-news-src{display:block;margin-top:6px;font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n' +
'/* peers + disclaimer + directory */\n' +
'.sp-peers{list-style:none;margin:var(--nd-s4) 0;padding:0;display:flex;flex-wrap:wrap;gap:var(--nd-s3)}\n' +
'.sp-peers a{display:inline-block;padding:var(--nd-s2) var(--nd-s5);border-radius:var(--nd-r-pill);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-size:.88rem;font-weight:600;box-shadow:var(--nd-rim),var(--nd-e1);transition:border-color var(--nd-t-fast) var(--nd-ease)}\n' +
'.sp-peers a:hover{border-color:var(--nd-lime,#B8E62E)}\n' +
'.sp-disc{margin:var(--nd-s8) 0 0;padding:var(--nd-s4) var(--nd-s5);border-radius:var(--nd-r-lg);background:rgba(255,255,255,.02);border:1px dashed var(--nd-border,#1E2430);font-size:.85rem;color:var(--nd-dim,#8E98A8);line-height:1.6}\n' +
'.sp-dir{list-style:none;margin:var(--nd-s5) 0;padding:0;display:grid;gap:var(--nd-s2)}\n' +
'.sp-dir li{padding:var(--nd-s3) var(--nd-s5);border-radius:var(--nd-r-md);background:var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430)}\n' +
'.sp-dir a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none}\n' +
'.sp-dir a:hover{color:var(--nd-lime,#B8E62E)}\n' +
'.sp-type{font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-left:8px}\n' +
'/* investment calendar: card shell on tokens; its table rides .nd-table\n' +
'   (markup) inside the .nd-tablewrap scroll shell */\n' +
'.inv-cal{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);box-shadow:var(--nd-rim),var(--nd-e1);margin:var(--nd-s5) 0;overflow:hidden}\n' +
'.inv-cal-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:var(--nd-s4) var(--nd-s5);border-bottom:1px solid var(--nd-border,#1E2430)}\n' +
'.inv-cal-head h2{margin:0;font-size:1.15rem;font-weight:700;color:var(--nd-text,#fff)}\n' +
'.inv-cal-co{font-size:.82rem;color:var(--nd-dim,#8E98A8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}\n' +
'.inv-cal-body{display:flex;gap:0;padding:var(--nd-s5);flex-wrap:wrap}\n' +
'.inv-cal-nav{display:flex;flex-direction:column;min-width:150px;border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);overflow:hidden;align-self:flex-start;background:var(--nd-panel-2,#161A23)}\n' +
'.inv-cal-tab{appearance:none;border:0;border-bottom:1px solid var(--nd-border,#1E2430);background:transparent;padding:.85rem 1rem;font-size:.8rem;font-weight:600;letter-spacing:.04em;color:var(--nd-muted,#B8C0CE);cursor:pointer;text-align:center;transition:background var(--nd-t-fast) var(--nd-ease),color var(--nd-t-fast) var(--nd-ease)}\n' +
'.inv-cal-tab:last-child{border-bottom:0}\n' +
'.inv-cal-tab:hover{color:var(--nd-text,#fff)}\n' +
'.inv-cal-tab.active{background:linear-gradient(180deg,color-mix(in srgb,var(--nd-lime,#B8E62E) 88%,#fff),var(--nd-lime,#B8E62E));color:var(--nd-on-lime,#0A0C10);font-weight:700}\n' +
'.inv-cal-count{display:inline-block;background:rgba(0,0,0,.15);border-radius:10px;padding:1px 7px;font-size:.72rem;margin-left:4px}\n' +
'.inv-cal-tab.active .inv-cal-count{background:rgba(0,0,0,.18)}\n' +
'.inv-cal-main{flex:1;min-width:0;padding-left:var(--nd-s5)}\n' +
'.inv-cal-controls{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.8rem;flex-wrap:wrap}\n' +
'.inv-cal-controls label{font-size:.88rem;color:var(--nd-muted,#B8C0CE)}\n' +
'.inv-cal-perpage,.inv-cal-q{border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);padding:.45rem .7rem;font-size:.88rem;background:var(--nd-panel-2,#161A23);color:var(--nd-text,#fff)}\n' +
'.inv-cal-q{width:180px}\n' +
'.inv-cal-table{min-width:520px}\n' +
'.inv-pill{display:inline-block;padding:3px 12px;border-radius:999px;font-size:.75rem;font-weight:700}\n' +
'.inv-pill-open{background:rgba(74,222,128,.15);color:var(--nd-up,#4ADE80);border:1px solid rgba(74,222,128,.4)}\n' +
'.inv-pill-closed{background:rgba(255,255,255,.05);color:var(--nd-dim,#8E98A8);border:1px solid var(--nd-border,#1E2430)}\n' +
'.inv-cal-foot{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:.9rem;flex-wrap:wrap}\n' +
'.inv-cal-info{font-size:.85rem;color:var(--nd-dim,#8E98A8)}\n' +
'.inv-cal-pages{display:flex;gap:6px;align-items:center}\n' +
'.inv-cal-prev,.inv-cal-next,.inv-cal-pg{padding:7px 14px;border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);background:var(--nd-panel-2,#161A23);color:var(--nd-text,#fff);cursor:pointer;font-size:.82rem;font-weight:600}\n' +
'.inv-cal-prev:hover:not(:disabled),.inv-cal-next:hover:not(:disabled),.inv-cal-pg:hover{border-color:var(--nd-lime,#B8E62E)}\n' +
'.inv-cal-prev:disabled,.inv-cal-next:disabled{opacity:.4;cursor:default}\n' +
'.inv-cal-pg.cur{background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10);border-color:var(--nd-lime,#B8E62E);font-weight:700}\n' +
'.inv-cal-empty{margin:1.2rem}\n' +
'/* valuation lab: card shell on tokens */\n' +
'.d2-val-lab{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);padding:var(--nd-s5) var(--nd-s6);margin:var(--nd-s6) 0;box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.d2-val-label{font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nd-dim,#8E98A8);margin:0 0 12px}\n' +
'.d2-val-grid{display:grid;gap:20px}\n' +
'@media(min-width:900px){.d2-val-grid{grid-template-columns:340px 1fr}}\n' +
'.d2-bank-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px}\n' +
'.d2-bank-chips button{padding:7px 14px;border-radius:var(--nd-r-pill);border:1px solid var(--nd-border,#1E2430);background:var(--nd-panel-2,#161A23);color:var(--nd-muted,#B8C0CE);font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:border-color .15s,color .15s}\n' +
'.d2-bank-chips button:hover{border-color:var(--nd-lime,#B8E62E);color:var(--nd-text,#fff)}\n' +
'.d2-bank-chips button[aria-pressed=\"true\"]{background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10);border-color:var(--nd-lime,#B8E62E);font-weight:700}\n' +
'.d2-val-co-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:6px 0 14px}\n' +
'.d2-val-co-sym{font-size:1.3rem;font-weight:800;color:var(--nd-text,#fff)}\n' +
'.d2-val-co-name{font-size:.85rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n' +
'.d2-val-co-price{text-align:right}\n' +
'.d2-val-co-price .p{font-size:1.2rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n' +
'.d2-val-co-price .c{font-size:.85rem;font-weight:700}\n' +
'.d2-val-co-price .c.up{color:var(--nd-up,#4ADE80)}\n' +
'.d2-val-co-price .c.dn{color:var(--nd-down,#F87171)}\n' +
'.d2-metric-rows{display:grid;gap:8px}\n' +
'.d2-metric-row{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 16px;border-radius:var(--nd-r-lg);border:1px solid var(--nd-border,#1E2430);background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0) 50%),var(--nd-panel-2,#161A23);cursor:pointer;color:var(--nd-text,#fff);font:inherit;transition:border-color var(--nd-t-fast) var(--nd-ease),box-shadow var(--nd-t-fast) var(--nd-ease)}\n' +
'.d2-metric-row:hover{border-color:var(--nd-lime,#B8E62E)}\n' +
'.d2-metric-row[aria-pressed=\"true\"]{border-color:var(--nd-lime,#B8E62E);box-shadow:0 0 0 1px var(--nd-lime,#B8E62E),0 4px 14px rgba(184,230,46,.15)}\n' +
'.d2-metric-row .m-name{font-weight:700;font-size:.9rem}\n' +
'.d2-metric-row .m-name small{display:block;font-weight:400;font-size:.75rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n' +
'.d2-metric-row .m-val{font-weight:700;font-variant-numeric:tabular-nums;color:var(--nd-text,#fff)}\n' +
'.d2-val-chart-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}\n' +
'.d2-val-chart-head strong{color:var(--nd-text,#fff);font-size:1.05rem}\n' +
'.d2-val-chart-head span{display:block;font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n' +
'.d2-val-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.78rem;color:var(--nd-dim,#8E98A8)}\n' +
'.d2-val-chart{background:var(--nd-inset,#0D0F14);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:12px;min-height:280px}\n' +
'.d2-val-chart canvas{width:100%;height:280px;display:block}\n' +
'.d2-fresh{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px;font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n' +
'.d2-fresh b{color:var(--nd-muted,#B8C0CE)}\n' +
SP_ABOUT_CSS +
'/* light theme: token-driven components (tabs, tables) flip with the\n' +
'   tokens; only the deep-card light recipe remains explicit here */\n' +
'[data-theme=\"light\"] .sp-price-card,[data-theme=\"light\"] .vpill,[data-theme=\"light\"] .sp-about,[data-theme=\"light\"] .sp-fund,[data-theme=\"light\"] .inv-cal,[data-theme=\"light\"] .d2-val-lab{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;box-shadow:inset 0 2px 0 #FFFFFF,0 1px 2px rgba(10,12,16,.1),0 8px 24px rgba(10,12,16,.1)}\n' +
'[data-theme=\"light\"] .sp-price,[data-theme=\"light\"] .sp-stat-v,[data-theme=\"light\"] .sp-fund-v,[data-theme=\"light\"] .d2-val-co-sym,[data-theme=\"light\"] .inv-cal-head h2{color:#0A0C10}\n' +
'[data-theme=\"light\"] .sp-ret-v.pos{color:#15803D}\n' +
'[data-theme=\"light\"] .sp-ret-v.neg{color:#DC2626}\n' +
'[data-theme=\"light\"] .sp-note{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;border-left-color:#4D7C0F;color:#3F4753}\n' +
'[data-theme=\"light\"] .sp-note strong{color:#0A0C10}\n' +
'[data-theme=\"light\"] .sp-links a,[data-theme=\"light\"] .sp-news li,[data-theme=\"light\"] .sp-peers a,[data-theme=\"light\"] .sp-dir li{background:linear-gradient(180deg,#FFFFFF,#F4F7FA);border-color:#CBD4DE;color:#0A0C10}\n' +
'[data-theme=\"light\"] .sp-links a,[data-theme=\"light\"] .sp-news a{color:#0A0C10}\n' +
'[data-theme=\"light\"] .d2-metric-row{background:linear-gradient(180deg,#FFFFFF,#F4F7FA);border-color:#CBD4DE;color:#0A0C10}\n' +
'[data-theme=\"light\"] .d2-bank-chips button{background:#EFF2F6;border-color:#D5DCE4;color:#3F4753}\n' +
'[data-theme=\"light\"] .d2-bank-chips button[aria-pressed=\"true\"]{background:#4D7C0F;border-color:#4D7C0F;color:#fff}\n' +
/* teardown 2026-10-28: 48px design-rich controls (overrides earlier 40px
 * tabs/chips at equal specificity — this block loads after them) */
'.sp-tab{min-height:48px;padding:0 18px;display:inline-flex;align-items:center}\n' +
'.sp-peers a{min-height:48px;display:inline-flex;align-items:center}\n' +
'.inv-cal-tab,.inv-cal-perpage,.inv-cal-q,.inv-cal-prev,.inv-cal-next,.inv-cal-pg{min-height:48px}\n' +
'.d2-bank-chips button{min-height:48px}\n' +
'.d2-metric-row{min-height:48px}\n' +
/* session strip: page-owned freshness line */
'.sp-session{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);padding:14px 18px;margin:var(--nd-s5) 0;box-shadow:var(--nd-rim),var(--nd-e1);font-size:.85rem}\n' +
'.sp-session-l{font-family:var(--nd-font-display,Georgia,serif);font-size:1.05rem;font-weight:700;color:var(--nd-text,#fff)}\n' +
'.sp-session-t{color:var(--nd-dim,#8E98A8)}\n' +
'.sp-chip{display:inline-block;padding:4px 10px;border-radius:var(--nd-r-pill);font-size:.75rem;font-weight:700;letter-spacing:.06em;background:var(--nd-panel2,#1A1E26);border:1px solid var(--nd-border,#1E2430);color:var(--nd-muted,#B8C0CE)}\n' +
'.sp-chip-stale{background:rgba(255,176,32,.14);border-color:#FFB020;color:#FFB020}\n' +
/* sector-stocks block: full sector table + controls + pager */
'.sp-secblock{margin:var(--nd-s6) 0}\n' +
'.sp-sec-controls{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 14px}\n' +
'.sp-sec-controls label{font-size:.85rem;color:var(--nd-dim,#8E98A8);display:flex;align-items:center;gap:8px}\n' +
'.sp-sec-q,.sp-sec-sort{min-height:48px;padding:0 12px;border-radius:var(--nd-r-md);background:var(--nd-panel2,#1A1E26);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);font-size:.9rem}\n' +
'.sp-sec-q:focus,.sp-sec-sort:focus{outline:none;border-color:var(--nd-lime,#B8E62E);box-shadow:0 0 0 3px rgba(184,230,46,.25)}\n' +
'.sp-table-wrap{overflow-x:auto;border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-peer-table{width:100%;border-collapse:collapse;font-size:.9rem}\n' +
'.sp-peer-table th{text-align:left;padding:12px 14px;color:var(--nd-dim,#8E98A8);font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--nd-border,#1E2430);white-space:nowrap}\n' +
'.sp-peer-table td{padding:12px 14px;border-bottom:1px solid var(--nd-border,#1E2430)}\n' +
'.sp-peer-table tr.cur td{background:rgba(184,230,46,.08)}\n' +
'.sp-peer-table a{color:var(--nd-text,#fff);font-weight:700;text-decoration:none}\n' +
'.sp-peer-table a:hover{color:var(--nd-lime,#B8E62E)}\n' +
'.sp-peer-table .pos{color:var(--nd-up,#34D399)}\n' +
'.sp-peer-table .neg{color:var(--nd-down,#F87171)}\n' +
'.sp-pager{display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:12px}\n' +
'.sp-pager-info{font-size:.85rem;color:var(--nd-dim,#8E98A8)}\n' +
'.sp-pager-prev,.sp-pager-next{min-height:48px;padding:0 18px;border-radius:var(--nd-r-pill);border:1px solid var(--nd-border,#1E2430);background:var(--nd-panel2,#1A1E26);color:var(--nd-text,#fff);font-weight:700;cursor:pointer}\n' +
'.sp-pager-next{background:var(--nd-lime,#B8E62E);border-color:var(--nd-lime,#B8E62E);color:#0A0C10}\n' +
'.sp-pager-prev:disabled,.sp-pager-next:disabled{opacity:.45;cursor:default}\n' +
'.sp-pager-prev:focus-visible,.sp-pager-next:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(184,230,46,.35)}\n' +
/* valuation context: paired company-vs-median bars */
'.sp-val-row{margin:0 0 14px}\n' +
'.sp-val-row b{display:block;font-size:.9rem;margin-bottom:6px}\n' +
'.sp-val-bar{height:12px;border-radius:6px;background:var(--nd-panel2,#1A1E26);overflow:hidden;margin:4px 0}\n' +
'.sp-val-fill{display:block;height:100%;background:var(--nd-lime,#B8E62E)}\n' +
'.sp-val-fill.dim{background:var(--nd-dim,#8E98A8)}\n' +
'.sp-val-lab{font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n' +
/* forward record categories (mirror the chart page) */
'.sp-cat{display:inline-block;padding:3px 9px;border-radius:var(--nd-r-pill);font-size:.78rem;font-weight:700;white-space:nowrap}\n' +
'.sp-cat-up{background:rgba(52,211,153,.15);color:#34D399}\n' +
'.sp-cat-down{background:rgba(248,113,113,.15);color:#F87171}\n' +
'.sp-cat-bounce{background:rgba(255,176,32,.16);color:#FFB020}\n' +
'.sp-cat-fade,.sp-cat-flat,.sp-cat-pend{background:rgba(142,152,168,.14);color:#8E98A8}\n' +
/* verified notices */
'.sp-act{list-style:none;margin:0;padding:0;display:grid;gap:12px}\n' +
'.sp-act li{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);padding:14px 18px;box-shadow:var(--nd-rim),var(--nd-e1)}\n' +
'.sp-act-kind{display:inline-block;padding:3px 9px;border-radius:var(--nd-r-pill);font-size:.75rem;font-weight:700;background:rgba(184,230,46,.14);color:var(--nd-lime,#B8E62E);margin-right:8px}\n' +
'.sp-act li a{color:var(--nd-text,#fff);font-weight:700}\n' +
'.sp-act-meta{display:block;font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:6px}\n' +
'.sp-news-foot{font-size:.82rem;color:var(--nd-dim,#8E98A8);margin-top:10px}\n' +
/* light theme for the new blocks */
'[data-theme="light"] .sp-session,[data-theme="light"] .sp-table-wrap,[data-theme="light"] .sp-act li{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;box-shadow:inset 0 2px 0 #FFFFFF,0 1px 2px rgba(10,12,16,.1),0 8px 24px rgba(10,12,16,.1)}\n' +
'[data-theme="light"] .sp-session-l,[data-theme="light"] .sp-peer-table a,[data-theme="light"] .sp-act li a{color:#0A0C10}\n' +
'[data-theme="light"] .sp-sec-q,[data-theme="light"] .sp-sec-sort,[data-theme="light"] .sp-pager-prev{background:#fff;border-color:#D5DCE4;color:#0A0C10}\n' +
'[data-theme="light"] .sp-peer-table tr.cur td{background:rgba(77,124,15,.08)}\n' +
'body{font-family:var(--nd-font-sans,Inter,system-ui,-apple-system,Segoe UI,sans-serif)}\n' +
'</style>\n';

function vClass(v) {
  if (v === 'Strong Buy') return 'vg-sb';
  if (v === 'Buy') return 'vg-b';
  if (v === 'Hold') return 'vg-h';
  if (v === 'Exit / Reduce') return 'vg-e';
  if (v === 'Strong Exit') return 'vg-se';
  return 'vg-na';
}

function pill(tfLabel, vobj) {
  if (!vobj || !vobj.v || vobj.v === 'Insufficient history') {
    return '<div class="vpill ' + vClass('') + '"><span class="vpill-tf">' + esc(tfLabel) + '</span>' +
      '<span class="vpill-na">Insufficient history on this timeframe</span></div>';
  }
  const bits = [];
  bits.push('<span class="vpill-tf">' + esc(tfLabel) + '</span>');
  bits.push('<span class="vpill-v ' + vClass(vobj.v) + '">' + esc(vobj.v) + '</span>');
  const meta = [];
  if (vobj.s !== null && vobj.s !== undefined) meta.push('score ' + esc(vobj.s));
  if (vobj.rsi) meta.push('RSI ' + esc(vobj.rsi));
  if (vobj.n) meta.push(esc(vobj.n) + ' bars');
  if (vobj.sl && vobj.tp) meta.push('SL ' + esc(vobj.sl) + ' / TP ' + esc(vobj.tp));
  if (vobj.setup) meta.push(esc(vobj.setup));
  if (vobj.asof) meta.push('as of ' + esc(vobj.asof));
  bits.push('<span class="vpill-meta">' + meta.join(' · ') + '</span>');
  return '<div class="vpill">' + bits.join('') + '</div>';
}

function head(sym, name, slug) {
  const title = sym + ' Share Price, Signals and News | Nepse Decode';
  const desc = name + ' (' + sym + '): latest NEPSE price, Engine Verdict signals, 52-week range and headlines. Free, educational.';
  const url = SITE + '/stocks/' + slug + '/';
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', name: title, url,
        description: desc,
        author: { '@type': 'Person', name: 'Shirjan Khadka', url: SITE + '/' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: 'Stocks', item: SITE + '/stocks/' },
          { '@type': 'ListItem', position: 3, name: sym, item: url },
        ],
      },
      /* The listed company itself (Wave E schema depth): only fields
       * the batch data carries — name, ticker, canonical page URL. */
      { '@type': 'Corporation', name, tickerSymbol: sym, url },
    ],
  };
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<script>try{var t=localStorage.getItem(\'sk-theme\');if(!t)t=\'dark\';document.documentElement.setAttribute(\'data-theme\',t);if(t===\'light\')document.documentElement.setAttribute(\'data-nd-ed\',\'light\')}catch(e){}</script>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<meta name="description" content="' + esc(desc) + '">\n' +
    '<meta name="author" content="Nepse Decode">\n' +
    '<link rel="canonical" href="' + url + '">\n' +
    '<meta name="robots" content="index, follow, max-image-preview:large">\n' +
    '<meta name="theme-color" content="#0A0C10">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Nepse Decode">\n' +
    '<meta property="og:title" content="' + esc(name + ' (' + sym + ') | Nepse Decode') + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + url + '">\n' +
    '<meta property="og:image" content="' + OG_STOCKS + '">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(name + ' (' + sym + ') | Nepse Decode') + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<meta name="twitter:image" content="' + OG_STOCKS + '">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/css/fonts.css">\n' +
    '<link rel="stylesheet" href="/css/nd-tokens.css?v=20261023d">\n' +
    '<link rel="stylesheet" href="/css/nd-chrome.css?v=20261023d">\n' +
    '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261023d">\n' +
    '<link rel="stylesheet" href="/css/sig-pro.css?v=20261023d">\n' +
    SP_STYLES +

    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n' +
    '</head>\n';
}

const RAIL = '<body class="nd">\n' +
  '<a class="skip-link" href="#main">Skip to content</a>\n' +
  '<div id="nd-header"></div>\n';

  const FOOT =
  '<div id="nd-footer"></div>\n' +
  '<script src="/js/nd-chrome.js?v=20261023d" defer></script>\n' +
  '<script src="/js/theme-toggle.js?v=20261023d" defer></script>\n' +
  '<script src="/js/stock-live.js?v=c135f9d9" defer></script>\n' +
  '<script src="/js/val-lab.js?v=20261023d" defer></script>\n' +
  '</body>\n</html>\n';

function fmtNum(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : esc(x);
}

// Numbers-first fundamentals block. Values come from fundamentals.json
// (published quarterly figures); symbols without coverage get one honest line.
function fundBlock(sym, fund, sector) {
  const f = fund && fund.companies && fund.companies[sym];
  const g = sectorGroup(sector);
  let h = '<section aria-label="Fundamentals"><h2>Fundamentals</h2>\n';
  if (g === 'inst') {
    h += '<p class="sp-note">This is a fund or debt instrument, not an operating company; company-style quarterly profit figures do not apply.</p>\n</section>\n';
    return h;
  }
  if (!f) {
    h += '<p class="sp-note">Quarterly figures not yet published for this security.</p>\n</section>\n';
    return h;
  }
  const cell = (val, label) => {
    const na = val.indexOf('–') >= 0 ? ' na' : '';
    return '<div class="sp-fund"><span class="sp-fund-l">' + label + '</span>' +
      '<span class="sp-fund-v' + na + '">' + val + '</span></div>';
  };
  const b = (x) => (x === null || x === undefined) ? '–' : 'Rs ' + Number(x).toLocaleString('en-US') + 'b';
  // Adaptive money: sub-billion values read better in millions (many
  // hydropower/manufacturing companies report quarterly figures in crores).
  const bm = (x) => {
    if (x === null || x === undefined) return '–';
    const n = Number(x);
    if (Math.abs(n) < 1) return 'Rs ' + (n * 1000).toFixed(1) + 'm';
    return 'Rs ' + n.toLocaleString('en-US') + 'b';
  };
  const r = (x, suf) => (x === null || x === undefined) ? '–' : esc(x) + suf;
  // A P/E of exactly 0 means the source could not compute it (no or negative
  // EPS); showing "0x" would be wrong, so it renders as not published.
  const pe = (x) => (x === null || x === undefined || x === 0) ? '–' : esc(x) + 'x';
  h += '<p class="sp-note">Latest published quarter: ' + esc(f.period || fund.period || '') +
    ' · figures as published, not estimates</p>\n';
  h += '<div class="sp-fund-group"><h3 class="sp-fund-sub">Valuation</h3><div class="sp-fund-grid">\n';
  h += cell('Rs ' + r(f.eps_ttm, ''), 'EPS (TTM)') + '\n';
  h += cell(pe(f.pe_ttm), 'P/E (TTM)') + '\n';
  h += '</div></div>\n<div class="sp-fund-group"><h3 class="sp-fund-sub">Quarterly snapshot</h3><div class="sp-fund-grid">\n';
  h += cell(bm(f.netprofit_b), 'Net profit') + '\n';
  if (g === 'bank') {
    h += cell(b(f.paidup_b), 'Paid-up capital') + '\n';
    h += cell(b(f.reserves_b), 'Reserves') + '\n';
    h += cell(b(f.deposits_b), 'Deposits') + '\n';
    h += cell(b(f.loans_b), 'Loans') + '\n';
    h += cell(r(f.npl_pct, '%'), 'NPL ratio') + '\n';
  } else if (g === 'ins') {
    h += cell(bm(f.revenue_b), 'Revenue') + '\n';
    h += cell(bm(f.grossprofit_b), 'Gross profit') + '\n';
    h += cell(bm(f.assets_b), 'Total assets') + '\n';
    h += cell(bm(f.liabilities_b), 'Total liabilities') + '\n';
    h += cell(bm(f.paidup_b), 'Paid-up capital') + '\n';
  } else {
    h += cell(bm(f.revenue_b), 'Revenue') + '\n';
    h += cell(bm(f.grossprofit_b), 'Gross profit') + '\n';
    h += cell(bm(f.opprofit_b), 'Operating profit') + '\n';
    h += cell(bm(f.assets_b), 'Total assets') + '\n';
    h += cell(bm(f.paidup_b), 'Paid-up capital') + '\n';
  }
  h += '</div></div>\n</section>\n';
  return h;
}

/* Stocks-family social card (Wave E): one proper 1200x630 stocks image
 * for every stock page + the /stocks/ index, rendered from the official
 * brand mark by tools/build-og-stocks.py. Replaces the generic site card. */
const OG_STOCKS = SITE + '/assets/images/og/stocks.png';

/* Static company block (Wave E SEO). DATA HONESTY: every value below is
 * composed ONLY from fields the batch data already carries (universe,
 * verdicts, fundamentals, live tape) — a missing field omits its clause
 * and its stats row; nothing is estimated or invented. blockFacts()
 * formats; companyBlock() renders prose + a key-stats definition list.
 * snap mirrors symbolPage's own snapshot selection: { pNum, cNum, asofD,
 * volFmt, tnoFmt } where volFmt/tnoFmt are fmtNum() outputs (string|null). */
const isNum = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

function blockFacts(u, v, fund, sector, snap) {
  const f = { sym: u.s, name: u.n, type: u.t || null, sector: sector || null,
    asof: snap.asofD || null, price: null, chg: null, h52: null, l52: null,
    vol: snap.volFmt || null, turnover: snap.tnoFmt || null,
    period: null, paidup: null, netprofit: null, eps: null, pe: null,
    verdict: null, verdictAsof: null };
  if (snap.pNum != null) f.price = fmtNum(snap.pNum);
  if (snap.cNum != null) f.chg = (snap.cNum > 0 ? '+' : '') + snap.cNum + '%';
  if (v) {
    if (isNum(v.h52)) f.h52 = fmtNum(v.h52);
    if (isNum(v.l52)) f.l52 = fmtNum(v.l52);
    if (v.v) { f.verdict = v.v; f.verdictAsof = v.asof || null; }
  }
  const c = fund && fund.companies ? fund.companies[u.s] : null;
  if (c) {
    f.period = c.period || fund.period || null;
    if (c.paidup_b != null && isFinite(Number(c.paidup_b))) f.paidup = 'Rs ' + Number(c.paidup_b).toLocaleString('en-US') + 'b';
    if (c.netprofit_b != null && isFinite(Number(c.netprofit_b))) {
      const nb = Number(c.netprofit_b);
      f.netprofit = nb < 1 && nb > -1 ? 'Rs ' + (nb * 1000).toFixed(1) + 'm' : 'Rs ' + nb.toLocaleString('en-US') + 'b';
    }
    if (c.eps_ttm != null && isFinite(Number(c.eps_ttm))) f.eps = 'Rs ' + Number(c.eps_ttm);
    if (c.pe_ttm != null && isFinite(Number(c.pe_ttm)) && Number(c.pe_ttm) !== 0) f.pe = Number(c.pe_ttm) + 'x';
  }
  return f;
}

function companyBlock(f) {
  const s = [];
  s.push(f.name + ' (' + f.sym + ') is listed on the Nepal Stock Exchange (NEPSE)' +
    (f.sector ? ', in the ' + f.sector + ' sector' : '') + '.');
  if (f.type && f.type !== 'Equity') s.push('The security is a ' + f.type.toLowerCase() + '.');
  if (f.price) {
    let m = 'As of ' + f.asof + ', ' + f.sym + ' last traded at Rs ' + f.price;
    if (f.chg) m += ' (' + f.chg + ' on the session)';
    if (f.h52 || f.l52) m += ', within a 52-week range of Rs ' + (f.l52 || '–') + ' – Rs ' + (f.h52 || '–');
    if (f.vol) m += ', on volume of ' + f.vol + ' shares';
    s.push(m + '.');
  } else if (f.asof) {
    s.push('The ' + f.asof + ' data batch carries no recent traded price for ' + f.sym + '.');
  }
  const fp = [];
  if (f.paidup) fp.push('paid-up capital of ' + f.paidup);
  if (f.netprofit) fp.push('net profit of ' + f.netprofit);
  if (f.eps) fp.push('earnings per share (TTM) of ' + f.eps);
  if (f.pe) fp.push('a price-to-earnings ratio (TTM) of ' + f.pe);
  if (fp.length) s.push('Latest published fundamentals' + (f.period ? ' (' + f.period + ')' : '') +
    ' show ' + fp.join(', ') + '.');
  if (f.verdict) s.push('The Engine Verdict daily reading for ' + f.sym + ' is ' + f.verdict +
    (f.verdictAsof ? ' (as of ' + f.verdictAsof + ')' : '') + '.');
  const rows = [];
  const row = (dt, dd) => { if (dd != null && dd !== '') rows.push('<div><dt>' + esc(dt) + '</dt><dd>' + esc(dd) + '</dd></div>'); };
  row('Symbol', f.sym);
  row('Company', f.name);
  row('Sector', f.sector);
  row('Instrument type', f.type);
  row('Last traded price', f.price ? 'Rs ' + f.price : null);
  row('Session change', f.chg);
  row('52-week high', f.h52 ? 'Rs ' + f.h52 : null);
  row('52-week low', f.l52 ? 'Rs ' + f.l52 : null);
  row('Volume (shares)', f.vol);
  row('Turnover', f.turnover ? 'Rs ' + f.turnover : null);
  row('Paid-up capital', f.paidup);
  row('Net profit (latest quarter)', f.netprofit);
  row('EPS (TTM)', f.eps);
  row('P/E (TTM)', f.pe);
  row('Fundamentals period', f.period);
  row('Price data as of', f.asof);
  let h = '<section class="sp-about" data-seo-block="company" aria-label="About ' + esc(f.name) + '">\n';
  h += '<h2>About ' + esc(f.name) + '</h2>\n';
  h += '<p>' + esc(s.join(' ')) + '</p>\n';
  if (rows.length) h += '<dl class="sp-stats">\n' + rows.join('\n') + '\n</dl>\n';
  return h + '</section>\n';
}

/* Quarterly trend table. quarterly.json holds published quarterly figures
 * for covered securities (values in NPR thousands). P&L figures (net profit,
 * revenue, gross/operating profit) are published cumulative for the fiscal
 * year, so the standalone quarter is derived as cum(Q) minus cum(Q-1); Q1
 * stands alone. Balance-sheet items, EPS (TTM), P/E (TTM) and NPL are
 * point-in-time and compare directly. QoQ = latest quarter vs previous
 * quarter; YoY = latest vs same quarter of the previous fiscal year. NPL is
 * direction-aware (down is good); P/E differences are neutral. Metrics shown
 * depend on the sector: lenders get deposits/loans/NPL, other operating
 * companies get revenue and profit lines, fund/debt instruments get no trend
 * table. Missing figures render as –. */
function quarterlyTable(sym, quarterly, sector) {
  const g = sectorGroup(sector);
  if (g === 'inst') return '';
  const sq = quarterly && quarterly.symbols && quarterly.symbols[sym];
  if (!sq || !sq.quarters) return '';
  const qs = Object.keys(sq.quarters).map((k) => {
    const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(k);
    if (!m) return null;
    return { key: k, fy: m[1] + '/' + m[2], y0: +m[1], q: +m[3], d: sq.quarters[k] };
  }).filter(Boolean).sort((a, b) => (a.y0 - b.y0) || (a.q - b.q));
  if (qs.length < 2) return '';
  const byKey = {};
  qs.forEach((x) => { byKey[x.key] = x; });
  const prevQ = (x) => {
    if (x.q > 1) return byKey[x.fy + '-Q' + (x.q - 1)] || null;
    const p0 = x.y0 - 1;
    return byKey[p0 + '/' + (p0 + 1) + '-Q4'] || null;
  };
  const yoyQ = (x) => {
    const p0 = x.y0 - 1;
    return byKey[p0 + '/' + (p0 + 1) + '-Q' + x.q] || null;
  };
  const num = (x) => {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  // Standalone quarter P&L in Rs B (derived from cumulative fiscal-year figures).
  const stOf = (x, field) => {
    const c = num(x.d[field]);
    if (c === null) return null;
    if (x.q === 1) return c / 1e6;
    const p = prevQ(x);
    const pc = p ? num(p.d[field]) : null;
    if (pc === null) return null;
    return (c - pc) / 1e6;
  };
  const bOf = (x, f) => { const v = num(x.d[f]); return v === null ? null : v / 1e6; };
  const b2 = (x) => x === null ? '–' : 'Rs ' + x.toFixed(2) + 'b';
  const b1 = (x) => x === null ? '–' : 'Rs ' + x.toFixed(1) + 'b';
  // Adaptive: sub-billion quarterly figures read better in Rs millions.
  const bma = (x) => x === null ? '–' :
    (Math.abs(x) < 1 ? 'Rs ' + (x * 1000).toFixed(1) + 'm' : 'Rs ' + x.toFixed(2) + 'b');
  const r2 = (x) => x === null ? '–' : x.toFixed(2);
  const rs2 = (x) => x === null ? '–' : 'Rs ' + x.toFixed(2);
  const pc2 = (x) => x == null ? '–' : x.toFixed(2) + '%';
  const sec_h = (t) => ({ sec: t });
  // Full financial statements: P&L (standalone quarters), Balance Sheet (point-in-time), Ratios.
  const metrics = g === 'bank' ? [
    sec_h('Profit & Loss (standalone quarter)'),
    { l: 'Revenue', v: (x) => stOf(x, 'revenue'), f: bma, dir: 1 },
    { l: 'Gross profit', v: (x) => stOf(x, 'grossprofit'), f: bma, dir: 1 },
    { l: 'Operating profit', v: (x) => stOf(x, 'opprofit'), f: bma, dir: 1 },
    { l: 'Net profit', v: (x) => stOf(x, 'netprofit'), f: bma, dir: 1 },
    { l: 'Distributable profit', v: (x) => stOf(x, 'distprofit'), f: bma, dir: 1 },
    sec_h('Balance Sheet (point-in-time)'),
    { l: 'Paid-up capital', v: (x) => bOf(x, 'paidup'), f: bma, dir: 1 },
    { l: 'Reserves & surplus', v: (x) => bOf(x, 'reserves'), f: bma, dir: 1 },
    { l: 'Deposits', v: (x) => bOf(x, 'deposits'), f: bma, dir: 1 },
    { l: 'Loans & advances', v: (x) => bOf(x, 'loans'), f: bma, dir: 1 },
    { l: 'Total assets', v: (x) => bOf(x, 'assets'), f: bma, dir: 1 },
    { l: 'Total liabilities', v: (x) => bOf(x, 'liabilities'), f: bma, dir: 1 },
    sec_h('Key ratios'),
    { l: 'EPS (TTM)', v: (x) => num(x.d.eps_ttm), f: rs2, dir: 1 },
    { l: 'EPS (annualized)', v: (x) => num(x.d.eps_ann), f: rs2, dir: 1 },
    { l: 'P/E (TTM)', v: (x) => num(x.d.pe_ttm), f: (x) => (x === null || x === 0) ? '–' : x.toFixed(2) + '×', dir: 0 },
    { l: 'NPL ratio', v: (x) => num(x.d.npl_pct), f: pc2, dir: -1 },
    { l: 'Credit/deposit ratio', v: (x) => num(x.d.cd_ratio), f: pc2, dir: 0 },
    { l: 'Interest rate spread', v: (x) => num(x.d.spread), f: pc2, dir: 1 },
  ] : [
    sec_h('Profit & Loss (standalone quarter)'),
    { l: 'Revenue', v: (x) => stOf(x, 'revenue'), f: bma, dir: 1 },
    { l: 'Gross profit', v: (x) => stOf(x, 'grossprofit'), f: bma, dir: 1 },
    { l: 'Operating profit', v: (x) => stOf(x, 'opprofit'), f: bma, dir: 1 },
    { l: 'Net profit', v: (x) => stOf(x, 'netprofit'), f: bma, dir: 1 },
    { l: 'Distributable profit', v: (x) => stOf(x, 'distprofit'), f: bma, dir: 1 },
    sec_h('Balance Sheet (point-in-time)'),
    { l: 'Paid-up capital', v: (x) => bOf(x, 'paidup'), f: bma, dir: 1 },
    { l: 'Reserves & surplus', v: (x) => bOf(x, 'reserves'), f: bma, dir: 1 },
    { l: 'Total assets', v: (x) => bOf(x, 'assets'), f: bma, dir: 1 },
    { l: 'Total liabilities', v: (x) => bOf(x, 'liabilities'), f: bma, dir: 1 },
    sec_h('Key ratios'),
    { l: 'EPS (TTM)', v: (x) => num(x.d.eps_ttm), f: rs2, dir: 1 },
    { l: 'EPS (annualized)', v: (x) => num(x.d.eps_ann), f: rs2, dir: 1 },
    { l: 'P/E (TTM)', v: (x) => num(x.d.pe_ttm), f: (x) => (x === null || x === 0) ? '–' : x.toFixed(2) + '×', dir: 0 },
  ];
  const show = qs.slice(-12);
  const latest = show[show.length - 1];
  const pq = prevQ(latest), yq = yoyQ(latest);
  const pct = (cur, prev) => {
    if (cur === null || prev === null || prev === 0) return null;
    return (cur - prev) / Math.abs(prev) * 100;
  };
  const dCell = (m, ref) => {
    const d = pct(m.v(latest), ref ? m.v(ref) : null);
    if (d === null) return '<td>–</td>';
    const cls = m.dir === 0 ? '' : (d * m.dir > 0 ? ' class="pos"' : (d * m.dir < 0 ? ' class="neg"' : ''));
    return '<td' + cls + '>' + (d > 0 ? '+' : '') + d.toFixed(1) + '%</td>';
  };
  const qLabel = (x) => 'Q' + x.q + ' ' + x.fy.slice(2, 4) + '/' + x.fy.slice(7, 9);
  let h = '<section aria-label="Quarterly trend"><h2>Quarterly trend</h2>\n';
  h += '<p class="sp-note">Published quarterly figures · latest ' + show.length + ' quarters. QoQ compares with the previous quarter; YoY with the same quarter last fiscal year.</p>\n';
  h += '<div class="sp-table-wrap nd-tablewrap"><table class="sp-peer-table nd-table">\n<thead><tr><th scope="col">Metric</th><th scope="col">QoQ</th><th scope="col">YoY</th>';
  for (let i = show.length - 1; i >= 0; i--) h += '<th scope="col" class="num">' + esc(qLabel(show[i])) + '</th>';
  h += '</tr></thead>\n<tbody>\n';
  for (const m of metrics) {
    if (m.sec) {
      h += '<tr class="sp-sec-row"><td colspan="' + (3 + show.length) + '"><strong>' + esc(m.sec) + '</strong></td></tr>\n';
      continue;
    }
    h += '<tr><td>' + esc(m.l) + '</td>' + dCell(m, pq) + dCell(m, yq);
    for (let i = show.length - 1; i >= 0; i--) h += '<td class="num">' + m.f(m.v(show[i])) + '</td>';
    h += '</tr>\n';
  }
  h += '</tbody></table></div>\n';
  h += '<p class="sp-note">Profit figures are published cumulative for the fiscal year; the quarterly profit row shows the implied standalone quarter (this quarter minus the prior quarter). P/E is not shown as a trend: the screener prices every historical quarter at today\u2019s price, so a historical P/E would be misleading. – means not published.</p>\n</section>\n';
  return h;
}

/* Valuation lab (S6 idiom): metric-synced peer analysis inside the
 * Fundamentals tab. Clickable metric rows redraw one shared canvas with the
 * selected metric's real quarterly history for the company against up to five
 * same-sector peers; peer chips switch the highlighted company.
 * HONESTY: only filing-based quantities are charted (profit, revenue, EPS,
 * balance-sheet items, NPL). P/E is offered solely as a point-in-time peer
 * ranking — never a historical trend. Profit lines are implied standalone
 * quarters (published cumulative minus the prior quarter). All series come
 * from quarterly.json; unpublished quarters render as gaps, never as zeros. */
function valLab(sym, name, sector, sectorPeers, quarterly, fund, snap, asofD) {
  const g = sectorGroup(sector);
  if (g === 'inst') return '';
  const sq = quarterly && quarterly.symbols && quarterly.symbols[sym];
  if (!sq || !sq.quarters) return '';
  const ql = Object.keys(sq.quarters).map((k) => {
    const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(k);
    if (!m) return null;
    return { key: k, fy: m[1] + '/' + m[2], y0: +m[1], q: +m[3] };
  }).filter(Boolean).sort((a, b) => (a.y0 - b.y0) || (a.q - b.q));
  if (ql.length < 2) return '';
  const show = ql.slice(-12);
  const showKeys = show.map((x) => x.key);
  const labels = show.map((x) => 'Q' + x.q + ' ' + x.fy.slice(2, 4) + '/' + x.fy.slice(7, 9));
  const num = (x) => {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const M = (key, label, unit, kind, fmt, field, zeroBased) =>
    ({ key, label, unit, kind, fmt, field, zeroBased: !!zeroBased });
  const metrics = [
    M('netprofit', 'Net profit', 'Rs b', 'pl', 'money', 'netprofit'),
    M('revenue', 'Revenue', 'Rs b', 'pl', 'money', 'revenue', true),
    M('eps_ttm', 'EPS (TTM)', 'Rs', 'pt', 'rs', 'eps_ttm'),
  ].concat(g === 'bank'
    ? [M('npl_pct', 'NPL ratio', '%', 'pt', 'pct', 'npl_pct', true),
       M('deposits', 'Deposits', 'Rs b', 'pt', 'money', 'deposits', true)]
    : [M('assets', 'Total assets', 'Rs b', 'pt', 'money', 'assets', true)]);
  // Peer set: the focus company + up to 5 same-sector peers (engine-score
  // order) that actually have quarterly history. X axis is the focus
  // company's quarter list; peers map onto the same keys, gaps stay null.
  const peers = [];
  for (const p of (sectorPeers || [])) {
    if (p.s === sym) continue;
    const pq = quarterly.symbols && quarterly.symbols[p.s];
    if (pq && pq.quarters && Object.keys(pq.quarters).length >= 2) peers.push(p);
    if (peers.length >= 5) break;
  }
  const names = {};
  names[sym] = name;
  peers.forEach((p) => { names[p.s] = p.n; });
  const seriesForKeys = (qd) => {
    const qb = {};
    Object.keys(qd).forEach((k) => { qb[k] = qd[k]; });
    const prevOf = (key) => {
      const m = /^(\d{4})\/(\d{4})-Q([1-4])$/.exec(key);
      if (!m) return null;
      const fy = m[1] + '/' + m[2], q = +m[3], y0 = +m[1];
      if (q > 1) return qb[fy + '-Q' + (q - 1)] || null;
      const p0 = y0 - 1;
      return qb[p0 + '/' + (p0 + 1) + '-Q4'] || null;
    };
    const out = {};
    for (const m of metrics) {
      out[m.key] = showKeys.map((key) => {
        const d = qb[key];
        if (!d) return null;
        if (m.kind === 'pl') {
          const c = num(d[m.field]);
          if (c === null) return null;
          const q = +key.slice(-1);
          if (q === 1) return c / 1e6;
          const pd = prevOf(key);
          const pc = pd ? num(pd[m.field]) : null;
          return pc === null ? null : (c - pc) / 1e6;
        }
        const v = num(d[m.field]);
        return v === null ? null : (m.fmt === 'money' ? v / 1e6 : v);
      });
    }
    return out;
  };
  const series = {};
  const allSyms = [sym].concat(peers.map((p) => p.s));
  for (const s of allSyms) series[s] = seriesForKeys(quarterly.symbols[s].quarters);
  // Point-in-time P/E (TTM) for the ranking chart; 0/absent = not published.
  const peOf = (s) => {
    const f = fund && fund.companies && fund.companies[s];
    const pe = f && f.pe_ttm;
    return (pe === null || pe === undefined || pe === 0) ? null : Number(pe);
  };
  const pe = {};
  for (const s of allSyms) pe[s] = peOf(s);
  const fmtV = (m, v) => {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    if (m.fmt === 'money') {
      const a = Math.abs(v);
      return 'Rs ' + (a < 1 ? (v * 1000).toFixed(1) + 'm' : v.toFixed(2) + 'b');
    }
    if (m.fmt === 'pct') return v.toFixed(2) + '%';
    if (m.fmt === 'rs') return 'Rs ' + v.toFixed(2);
    return String(v);
  };
  const lastOf = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (v !== null && isFinite(v)) return v;
    }
    return null;
  };
  const subOf = (m) => m.kind === 'pl'
    ? 'standalone quarter · ' + m.unit
    : (m.key === 'eps_ttm' ? 'trailing twelve months · ' + m.unit : 'latest published · ' + m.unit);
  let rows = '';
  metrics.forEach((m, i) => {
    rows += '<button type="button" class="d2-metric-row" data-metric="' + m.key + '"' +
      ' aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' +
      '<span class="m-name">' + esc(m.label) + '<small>' + esc(subOf(m)) + '</small></span>' +
      '<span class="m-val">' + esc(fmtV(m, lastOf(series[sym][m.key]))) + '</span></button>\n';
  });
  const peTxt = pe[sym] === null ? '–' : pe[sym].toFixed(2) + '×';
  rows += '<button type="button" class="d2-metric-row" data-metric="__pe" aria-pressed="false">' +
    '<span class="m-name">P/E (TTM)<small>point-in-time peer ranking · ×</small></span>' +
    '<span class="m-val">' + esc(peTxt) + '</span></button>\n';
  const chips = allSyms.map((s, i) =>
    '<button type="button" data-sym="' + esc(s) + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '"' +
    ' aria-label="Highlight ' + esc(s) + ' in the chart">' + esc(s) + '</button>').join('\n');
  const px = snap && snap.p !== null && snap.p !== undefined
    ? 'Rs ' + Number(snap.p).toLocaleString('en-US') : '–';
  const chN = snap ? Number(snap.ch) : NaN;
  const chHtml = isFinite(chN)
    ? '<div class="c ' + (chN > 0 ? 'up' : chN < 0 ? 'dn' : '') + '">' +
      (chN > 0 ? '+' : '') + chN.toFixed(2) + '%</div>'
    : '';
  const fundPeriod = (fund && fund.period) || '';
  const payload = {
    quarters: labels, series, pe, focus: sym, peerNames: names, sector: sector || '',
    metrics: metrics.map((m) => ({
      key: m.key, label: m.label, unit: m.unit, kind: m.kind,
      fmt: m.fmt, zeroBased: m.zeroBased,
    })),
  };
  let h = '<section class="d2-val-lab" id="valLab" aria-label="Valuation lab">\n';
  h += '<p class="d2-val-label">Valuation lab · ' + esc(sector || 'sector peers') + '</p>\n';
  h += '<div class="d2-val-grid">\n<div>\n';
  h += '<div class="d2-val-label">Peer set · ' + allSyms.length + ' ' + esc(sector || 'companies') + '</div>\n';
  h += '<div class="d2-bank-chips" role="group" aria-label="Choose a company to highlight">\n' + chips + '\n</div>\n';
  h += '<div class="d2-val-co"><div class="d2-val-co-head"><div>' +
    '<div class="d2-val-co-sym" id="valCoSym">' + esc(sym) + '</div>' +
    '<div class="d2-val-co-name" id="valCoName">' + esc(name) + '</div></div>' +
    '<div class="d2-val-co-price"><div class="p">' + esc(px) + '</div>' + chHtml + '</div></div></div>\n';
  h += '<div class="d2-metric-rows" role="group" aria-label="Valuation metrics">\n' + rows + '</div>\n';
  h += '</div>\n<div>\n';
  h += '<div class="d2-val-chart-head"><div><strong id="valChartTitle">–</strong>' +
    '<span id="valChartSub">–</span></div><div class="d2-val-legend" id="valLegend"></div></div>\n';
  h += '<div class="d2-val-chart"><canvas id="valChart" role="img" aria-label="Valuation chart"></canvas></div>\n';
  h += '<p style="font-size:12.5px;color:var(--d2-muted);margin:10px 0 0;line-height:1.65">' +
    'Profit lines show implied standalone quarters (published cumulative minus the prior quarter). ' +
    'P/E is a point-in-time peer ranking, never a historical trend. Every figure is from published ' +
    'quarterly filings — nothing estimated.</p>\n';
  h += '<div class="d2-fresh"><b>Fundamentals</b><span>as of ' + esc(fundPeriod) + '</span>' +
    '<span aria-hidden="true">·</span><span>Source: published quarterly filings</span>' +
    '<span aria-hidden="true">·</span><span>Prices: session ' + esc(asofD || '') + '</span></div>\n';
  h += '</div>\n</div>\n';
  h += '<script type="application/json" id="val-lab-data">' +
    JSON.stringify(payload).replace(/</g, '\\u003c') + '<\/script>\n';
  h += '</section>\n';
  return h;
}

/* Sector peer comparison table: same-sector equities ranked by engine
 * score, with price/session change from verdicts and P/E + EPS from
 * published fundamentals where available. Current symbol highlighted.
 * Educational comparison of published figures, never a ranking or call. */
function peerTable(sym, sector, sectorPeers, verdicts, fund) {
  if (!sector || sectorPeers.length < 2) return '';
  const rows = sectorPeers.map((p) => {
    const v = verdicts[p.s] || {};
    const f = fund && fund.companies && fund.companies[p.s];
    return { s: p.s, n: p.n, v, f };
  }).filter((r) => r.v && r.v.p !== null && r.v.p !== undefined);
  if (rows.length < 2) return '';
  const shown = rows.slice(0, 9);
  let h = '<section aria-label="Sector peer comparison"><h2>Sector peers · ' + esc(sector) + '</h2>\n';
  h += '<p class="sp-note">Same-sector equities by engine score. P/E and EPS show published quarterly figures where available; – means not yet published.</p>\n';
  h += '<div class="sp-table-wrap nd-tablewrap"><table class="sp-peer-table nd-table">\n<thead><tr>' +
    '<th scope="col">Symbol</th><th scope="col">Price (Rs)</th>' +
    '<th scope="col">Session</th><th scope="col">P/E (TTM)</th><th scope="col">EPS (TTM)</th>' +
    '</tr></thead>\n<tbody>\n';
  for (const r of shown) {
    const ch = r.v.ch;
    const chTxt = (ch === null || ch === undefined || ch === '') ? '–'
      : ((Number(ch) > 0 ? '+' : '') + ch + '%');
    const chCls = (ch === null || ch === undefined || ch === '') ? ''
      : (Number(ch) < 0 ? 'neg' : (Number(ch) > 0 ? 'pos' : ''));
    const pe = r.f && r.f.pe_ttm !== null && r.f.pe_ttm !== undefined ? esc(r.f.pe_ttm) + 'x' : '–';
    const eps = r.f && r.f.eps_ttm !== null && r.f.eps_ttm !== undefined ? 'Rs ' + esc(r.f.eps_ttm) : '–';
    const cur = r.s === sym ? ' class="cur"' : '';
    h += '<tr' + cur + '><td><a href="/stocks/' + slugOf(r.s) + '/">' + esc(r.s) + '</a></td>' +
      '<td>' + esc(fmtNum(r.v.p)) + '</td>' +
      '<td class="' + chCls + '">' + esc(chTxt) + '</td>' +
      '<td>' + pe + '</td><td>' + eps + '</td></tr>\n';
  }
  h += '</tbody></table></div>\n';
  h += '<p class="sp-note">Figures from the same data date as this page. Educational comparison only, not investment advice.</p>\n</section>\n';
  return h;
}

/* Investment tab: all-time per-scrip history (dividends, rights, auctions, AGMs).
 * History rows come from corp-history.json (ShareSansar crawl: dividends,
 * AGMs, rights, auctions) unioned with div-history-yonepse.json (yonepse open
 * API dividends) at build time. Verified recent notices from
 * corporate-actions.json carry the official NEPSE/company PDF link. Nothing is
 * invented; missing history renders an honest note.
 * (2026-09-30: no on-page source label per his call.) */
const CA_KIND_LABEL = {
  'dividend': 'Dividend',
  'bonus-share': 'Bonus share',
  'right-share': 'Right share',
  'promoter-share': 'Promoter share',
  'auction': 'Auction',
};
function stripTags(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function pct(x) {
  if (x === null || x === undefined || x === '') return '–';
  const n = Number(x);
  return Number.isFinite(n) ? String(n) : String(x);
}
/* Investment Calendar card: Nepse Alpha-style past corporate-action history.
 * Shows all-time per-scrip history (dividends, AGMs, rights, auctions) in
 * a card with sidebar navigation, search, and pagination. History rows come
 * from corp-history.json unioned with div-history-yonepse.json at build time.
 * Nothing is invented; missing history renders an honest note. */
function investmentCalendarCard(sym, name, hist) {
  const H = hist || {};
  const divs = H.dividends || [], agms = H.agms || [],
        rights = H.rights || [], aucs = H.auctions || [];
  const uid = 'inv-' + sym.replace(/[^A-Z0-9]/gi, '');

  let h = '<section class="inv-cal" aria-label="Investment Calendar">\n';
  h += '<div class="inv-cal-head"><h2><span aria-hidden="true">📅</span> Investment Calendar</h2>' +
    '<span class="inv-cal-co">' + esc(name) + '</span></div>\n';

  const hasHist = divs.length + agms.length + rights.length + aucs.length > 0;
  if (!hasHist) {
    h += '<p class="sp-note inv-cal-empty">Past dividend, right share, auction and AGM history ' +
      'is being compiled for this security. Check back soon.</p>\n';
    h += '</section>\n';
    return h;
  }

  h += '<div class="inv-cal-body">\n';
  // Sidebar navigation
  h += '<nav class="inv-cal-nav" aria-label="History categories">\n';
  const tabs = [
    ['dividends', 'Dividends', divs.length],
    ['agm', 'AGM', agms.length],
    ['rights', 'Right Share', rights.length],
    ['auctions', 'Auction', aucs.length],
  ];
  tabs.forEach(([key, label, count], i) => {
    h += '<button class="inv-cal-tab' + (i === 0 ? ' active' : '') + '" data-inv-tab="' + key + '" ' +
      'data-inv-uid="' + uid + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' +
      esc(label.toUpperCase()) +
      (count ? ' <span class="inv-cal-count">' + count + '</span>' : '') +
      '</button>\n';
  });
  h += '</nav>\n';

  // Main content area
  h += '<div class="inv-cal-main">\n';
  h += '<div class="inv-cal-controls">\n';
  h += '<label>Show <select class="inv-cal-perpage" data-inv-uid="' + uid + '" aria-label="Entries per page">' +
    '<option value="10" selected>10</option><option value="25">25</option>' +
    '<option value="50">50</option><option value="100">100</option></select> entries</label>\n';
  h += '<label class="inv-cal-search">Search: <input type="search" class="inv-cal-q" data-inv-uid="' + uid + '" ' +
    'placeholder="" aria-label="Search history"></label>\n';
  h += '</div>\n';

  // Tables (one per category, only first visible)
  h += '<div class="inv-cal-tables" data-inv-uid="' + uid + '">\n';

  // Dividends table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="dividends">\n';
  if (divs.length) {
    h += '<div class="inv-cal-scroll nd-tablewrap"><table class="inv-cal-table nd-table nd-table--dense">\n<thead><tr>' +
      '<th scope="col">Bonus %</th><th scope="col">Cash %</th><th scope="col">Total</th>' +
      '<th scope="col">Book Close Date</th><th scope="col">Fiscal Year</th><th scope="col">Status</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const d of divs) {
      const bonus = pct(d.bonus_share), cash = pct(d.cash_dividend), total = pct(d.total_dividend);
      /* Status pill: computed live in the browser from the book close date vs
       * today (Open while the date is today or in the future, Closed once it
       * has passed), so it flips on its own with no rebuild. A [Closed]
       * marker from the crawl is authoritative and passed through as data.
       * Falls back to the fiscal year when no book close date is on record. */
      const bcRaw = stripTags(d.bookclose_date || '');
      const bcMarkedClosed = /\[closed\]/i.test(bcRaw);
      const bcDisp = bcRaw.replace(/\s*\[closed\]/i, '').trim();
      const bcIso = ((/^(\d{4}-\d{2}-\d{2})/.exec(bcDisp) || [])[1]) || '';
      const fy = String(d.year || d.fiscal_year || '');
      const annRaw = stripTags(d.announcement_date || d.announced || '');
      const annIso = ((/^(\d{4}-\d{2}-\d{2})/.exec(annRaw) || [])[1]) || '';
      h += '<tr><td>' + esc(bonus === '–' ? '–' : bonus + ' %') + '</td>' +
        '<td>' + esc(cash === '–' ? '–' : cash + ' %') + '</td>' +
        '<td>' + esc(total === '–' ? '–' : total + ' %') + '</td>' +
        '<td>' + esc(bcDisp || '–') + '</td>' +
        '<td>' + esc(fy || '–') + '</td>' +
        '<td><span class="inv-cal-divstatus" data-bc="' + esc(bcIso) + '"' +
        (annIso ? ' data-ann="' + esc(annIso) + '"' : '') +
        (bcMarkedClosed ? ' data-closed="1"' : '') + '></span></td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No dividend history available yet.</p>\n';
  }
  h += '</div>\n';

  // AGM table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="agm" hidden>\n';
  if (agms.length) {
    h += '<div class="inv-cal-scroll nd-tablewrap"><table class="inv-cal-table nd-table nd-table--dense">\n<thead><tr>' +
      '<th scope="col">AGM</th><th scope="col">Meeting Date</th>' +
      '<th scope="col">Book Close</th><th scope="col">Venue</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const g of agms) {
      h += '<tr><td>' + esc(stripTags(g.agm) || '–') + '</td>' +
        '<td>' + esc(g.meeting_date || '–') + '</td>' +
        '<td>' + esc(stripTags(g.bookclose_date) || '–') + '</td>' +
        '<td>' + esc(stripTags(g.venue_time).slice(0, 80) || '–') + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No AGM history available yet.</p>\n';
  }
  h += '</div>\n';

  // Right share table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="rights" hidden>\n';
  if (rights.length) {
    h += '<div class="inv-cal-scroll nd-tablewrap"><table class="inv-cal-table nd-table nd-table--dense">\n<thead><tr>' +
      '<th scope="col">Ratio</th><th scope="col">Units</th><th scope="col">Price (Rs)</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const r of rights) {
      const ratio = stripTags(r.ratio_value || r.ratio || r.right_ratio);
      const unitsRaw = stripTags(r.total_units || r.units);
      const unitsNum = Number(String(unitsRaw).replace(/,/g, ''));
      const units = unitsRaw ? (Number.isFinite(unitsNum)
        ? Math.round(unitsNum).toLocaleString('en-US') : unitsRaw) : '–';
      const priceRaw = stripTags(r.issue_price || r.price || r.rate);
      const priceNum = Number(String(priceRaw).replace(/,/g, ''));
      const price = priceRaw ? (Number.isFinite(priceNum) ? priceNum.toFixed(2) : priceRaw) : '–';
      h += '<tr><td>' + esc(ratio || '–') + '</td>' +
        '<td>' + esc(units) + '</td>' +
        '<td>' + esc(price) + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No right share history available yet.</p>\n';
  }
  h += '</div>\n';

  // Auction table
  h += '<div class="inv-cal-tablewrap" data-inv-panel="auctions" hidden>\n';
  if (aucs.length) {
    h += '<div class="inv-cal-scroll nd-tablewrap"><table class="inv-cal-table nd-table nd-table--dense">\n<thead><tr>' +
      '<th scope="col">Type</th><th scope="col">Units</th>' +
      '<th scope="col">Opened</th><th scope="col">Closed</th>' +
      '</tr></thead>\n<tbody>\n';
    for (const a of aucs) {
      const typ = a.displayable_share_type || (String(a.share_type) === '1' ? 'Promoter Share' : a.share_type);
      h += '<tr><td>' + esc(stripTags(typ) || '–') + '</td>' +
        '<td>' + esc(stripTags(a.total_auction) || '–') + '</td>' +
        '<td>' + esc(a.opening_date || '–') + '</td>' +
        '<td>' + esc(a.closing_date || '–') + '</td></tr>\n';
    }
    h += '</tbody></table></div>\n';
  } else {
    h += '<p class="sp-note">No auction history available yet.</p>\n';
  }
  h += '</div>\n';

  h += '</div>\n'; // .inv-cal-tables

  // Pagination footer
  h += '<div class="inv-cal-foot" data-inv-uid="' + uid + '">\n';
  h += '<span class="inv-cal-info">Showing 1 to 10 of 0 entries</span>\n';
  h += '<div class="inv-cal-pages" role="navigation" aria-label="Pagination">\n';
  h += '<button class="inv-cal-prev" disabled>Previous</button>\n';
  h += '<span class="inv-cal-pagenums"></span>\n';
  h += '<button class="inv-cal-next" disabled>Next</button>\n';
  h += '</div></div>\n';

  h += '</div>\n'; // .inv-cal-main
  h += '</div>\n'; // .inv-cal-body
  h += '</section>\n';
  return h;
}

/* SEO cross-linking: scan each blog article page (blog/<slug>/index.html) for
 * articles whose <title> or meta keywords mention a listed symbol (strict
 * token match on title/keywords only, never body text, so no false-positive
 * links). Returns [{ url, title, date }], newest first (JSON-LD date).
 * Built once in main() and passed into symbolPage as `related`. */
function scanRelatedArticles() {
  const blogDir = path.join(ROOT, 'blog');
  const out = {};
  let dirs = [];
  try { dirs = fs.readdirSync(blogDir, { withFileTypes: true }); } catch { return out; }
  const arts = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const f = path.join(blogDir, d.name, 'index.html');
    let html;
    try { html = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const head = html.slice(0, html.indexOf('</head>') > 0 ? html.indexOf('</head>') : 8000);
    const t = head.match(/<title>([\s\S]*?)<\/title>/i);
    const k = head.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["']/i) ||
              head.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']keywords["']/i);
    const title = t ? t[1].trim() : '';
    const hay = ((title + ' ' + (k ? k[1] : '')).toUpperCase());
    const ld = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    let date = '';
    if (ld) {
      try {
        const j = JSON.parse(ld[1]);
        date = String((j && j.datePublished) || '').slice(0, 10);
      } catch { /* ignore */ }
    }
    if (!title) continue;
    arts.push({ url: '/blog/' + d.name + '/', title, hay, date });
  }
  arts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return arts;
}

function relatedForSymbol(arts, sym) {
  const s = String(sym).toUpperCase().replace(/-/g, '/');
  const re = new RegExp('(^|[^A-Z0-9/])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Z0-9/]|$)');
  const hits = [];
  for (const a of arts) {
    if (re.test(a.hay)) hits.push({ url: a.url, title: a.title });
    if (hits.length >= 3) break;
  }
  return hits;
}

/* ---- teardown 2026-10-28: session strip, sector-stocks block,
 * valuation context, forward record, verified notices.
 * All figures come from the same batch the page already renders; nothing
 * here recomputes an engine verdict or invents a fair value. ---- */

function sessionStrip(x) {
  const stale = !!(x.manifest && x.manifest.session_date && x.pageAsof && x.pageAsof < x.manifest.session_date);
  let h = '<section class="sp-session" aria-label="Data session">';
  h += '<span class="sp-session-l">Session ' + esc(x.pageAsof || x.liveDate || '') + '</span>';
  if (stale) h += '<span class="sp-chip sp-chip-stale">STALE — NEWER SESSION PUBLISHED</span>';
  else if (x.manifest && x.manifest.market_state) h += '<span class="sp-chip">' + esc(x.manifest.market_state) + '</span>';
  h += '<span class="sp-session-t">tape ' + esc(x.liveDate || '—');
  if (x.quotes) h += ' · ' + esc(x.quotes) + ' quotes';
  if (x.scored) h += ' · ' + esc(x.scored) + ' symbols scored';
  h += '</span>';
  if (x.manifest && x.manifest.session_date) {
    h += '<span class="sp-session-t">manifest session ' + esc(x.manifest.session_date);
    if (x.manifest.generated_at_npt) h += ' · generated ' + esc(String(x.manifest.generated_at_npt).slice(0, 16));
    h += '</span>';
  }
  h += '<span class="sp-session-t" data-session-live>live tape refreshes in the browser when a newer snapshot lands</span>';
  h += '</section>';
  return h;
}

function sectorStocksBlock(sym, sector, sectorPeers, verdicts, liveMap) {
  if (!sector || !sectorPeers || sectorPeers.length < 2) return '';
  const rows = sectorPeers.map((p) => {
    const v = verdicts[p.s] || {};
    const q = liveMap[p.s] || null;
    const price = q && Number.isFinite(Number(q.ltp)) ? Number(q.ltp) : (v.p !== undefined && v.p !== null ? Number(v.p) : null);
    const chg = q && Number.isFinite(Number(q.percent_change)) ? Number(q.percent_change) : (v.ch !== undefined && v.ch !== null ? Number(v.ch) : null);
    return { s: p.s, n: p.n, price, chg, score: (v.s !== undefined && v.s !== null ? Number(v.s) : null), verdict: v.v || '' };
  });
  rows.sort((a, b) => (b.score === null ? -Infinity : b.score) - (a.score === null ? -Infinity : a.score));
  let h = '<section class="sp-secblock" aria-label="Stocks in this sector"><h2>Stocks in this sector</h2>';
  h += '<p class="sp-note">Every stock in ' + esc(sector) + ' (' + rows.length + '), same session data as this page. Day % is the exchange adjusted reference from the live tape. Click a symbol to open its chart.</p>';
  h += '<div class="sp-sec-controls"><label>Search <input class="sp-sec-q" type="search" placeholder="Symbol or name" aria-label="Search sector stocks"></label>';
  h += '<label>Sort <select class="sp-sec-sort" aria-label="Sort sector stocks"><option value="score">Engine score</option><option value="day">Day %</option><option value="sym">Symbol A–Z</option></select></label></div>';
  h += '<div class="sp-table-wrap"><table class="sp-peer-table"><thead><tr><th>Symbol</th><th>Company</th><th>LTP (Rs)</th><th>Day %</th><th>Score</th><th>Verdict</th></tr></thead><tbody>';
  for (const r of rows) {
    h += '<tr data-s="' + esc(r.s) + '" data-n="' + esc(String(r.n).toLowerCase()) + '" data-score="' + (r.score === null ? '' : r.score) + '" data-chg="' + (r.chg === null ? '' : r.chg) + '"' + (r.s === sym ? ' class="cur"' : '') + '>';
    h += '<td><a href="/stocks/' + slugOf(r.s) + '/">' + esc(r.s) + '</a></td>';
    h += '<td>' + esc(r.n) + '</td>';
    h += '<td>' + (r.price === null || !Number.isFinite(r.price) ? '–' : fmtNum(r.price)) + '</td>';
    h += '<td class="' + (r.chg === null ? '' : (r.chg < 0 ? 'neg' : (r.chg > 0 ? 'pos' : ''))) + '">' + (r.chg === null ? '–' : (r.chg > 0 ? '+' : '') + esc(r.chg) + '%') + '</td>';
    h += '<td>' + (r.score === null ? '–' : esc(r.score)) + '</td>';
    h += '<td>' + esc(r.verdict || '–') + '</td></tr>';
  }
  h += '</tbody></table></div>';
  h += '<div class="sp-pager"><button class="sp-pager-prev" type="button">Prev</button><span class="sp-pager-info"></span><button class="sp-pager-next" type="button">Next</button></div>';
  h += '<script>(function(){var b=document.querySelector(".sp-secblock");if(!b)return;';
  h += 'var q=b.querySelector(".sp-sec-q"),srt=b.querySelector(".sp-sec-sort");';
  h += 'var rows=Array.prototype.slice.call(b.querySelectorAll("tbody tr"));';
  h += 'var st={q:"",sort:"score",page:1,per:25};';
  h += 'function numv(r,k){var v=r.getAttribute("data-"+k);return v===""?null:+v;}';
  h += 'function render(){var f=rows.filter(function(r){return !st.q||r.getAttribute("data-s").toLowerCase().indexOf(st.q)>-1||r.getAttribute("data-n").indexOf(st.q)>-1;});';
  h += 'f.sort(function(a,b){if(st.sort==="sym")return a.getAttribute("data-s").localeCompare(b.getAttribute("data-s"));';
  h += 'var ka=numv(a,st.sort==="day"?"chg":"score"),kb=numv(b,st.sort==="day"?"chg":"score");';
  h += 'ka=ka===null?-Infinity:ka;kb=kb===null?-Infinity:kb;return kb-ka;});';
  h += 'var pages=Math.max(1,Math.ceil(f.length/st.per));if(st.page>pages)st.page=pages;var s=(st.page-1)*st.per;';
  h += 'rows.forEach(function(r){r.style.display="none";});';
  h += 'f.slice(s,s+st.per).forEach(function(r){r.style.display="";});';
  h += 'b.querySelector(".sp-pager-info").textContent=f.length?("Showing "+(s+1)+" to "+Math.min(s+st.per,f.length)+" of "+f.length):"Showing 0 entries";';
  h += 'b.querySelector(".sp-pager-prev").disabled=st.page<=1;';
  h += 'b.querySelector(".sp-pager-next").disabled=st.page>=pages;}';
  h += 'q.addEventListener("input",function(){st.q=this.value.toLowerCase();st.page=1;render();});';
  h += 'srt.addEventListener("change",function(){st.sort=this.value;st.page=1;render();});';
  h += 'b.querySelector(".sp-pager-prev").addEventListener("click",function(){if(st.page>1){st.page--;render();}});';
  h += 'b.querySelector(".sp-pager-next").addEventListener("click",function(){if(st.page<Math.ceil(rows.length/st.per)){st.page++;render();}});';
  h += 'render();})();</scr' + 'ipt>';
  h += '</section>';
  return h;
}

function valuationContextBlock(sym, valueRow, fund) {
  let h = '<section aria-label="Valuation context"><h2>Valuation context</h2>';
  if (valueRow) {
    const sc = valueRow.value_score;
    const pe = Number(valueRow.pe_ttm), pb = Number(valueRow.pbv);
    const mpe = Number(valueRow.sector_median_pe), mpb = Number(valueRow.sector_median_pbv);
    const bar = (v, m) => {
      if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return null;
      const max = Math.max(v, m);
      return { v: Math.round(v / max * 100), m: Math.round(m / max * 100) };
    };
    h += '<p class="sp-note">Value score ' + esc(sc) + ' of 100 — ranks this company within its own sector only: 50% earnings-yield rank (higher yield = cheaper) + 50% price-to-book rank (lower = cheaper). Quality gate: positive TTM EPS and positive net worth. This is a screening starting point for research — <strong>not a fair value and not a price target</strong>.</p>';
    const peBar = bar(pe, mpe), pbBar = bar(pb, mpb);
    if (peBar) {
      h += '<div class="sp-val-row"><b>Price / Earnings (TTM): ' + fmtNum(pe) + ' vs sector median ' + fmtNum(mpe) + '</b>';
      h += '<div class="sp-val-bar"><span class="sp-val-fill" style="width:' + peBar.v + '%"></span></div><span class="sp-val-lab">' + esc(sym) + '</span>';
      h += '<div class="sp-val-bar"><span class="sp-val-fill dim" style="width:' + peBar.m + '%"></span></div><span class="sp-val-lab">Sector median</span></div>';
    }
    if (pbBar) {
      h += '<div class="sp-val-row"><b>Price / Book: ' + fmtNum(pb) + ' vs sector median ' + fmtNum(mpb) + '</b>';
      h += '<div class="sp-val-bar"><span class="sp-val-fill" style="width:' + pbBar.v + '%"></span></div><span class="sp-val-lab">' + esc(sym) + '</span>';
      h += '<div class="sp-val-bar"><span class="sp-val-fill dim" style="width:' + pbBar.m + '%"></span></div><span class="sp-val-lab">Sector median</span></div>';
    }
    if (valueRow.eps_ttm !== undefined && valueRow.eps_ttm !== null) h += '<p>EPS (TTM): Rs ' + fmtNum(valueRow.eps_ttm) + (valueRow.bvps ? ' · Book value per share: Rs ' + fmtNum(valueRow.bvps) : '') + (valueRow.roe_ttm_pct !== undefined && valueRow.roe_ttm_pct !== null ? ' · ROE (TTM): ' + esc(valueRow.roe_ttm_pct) + '%' : '') + '.</p>';
    h += '<p><a href="/nepse-value/">Open the value screen <span aria-hidden="true">→</span></a></p>';
  } else {
    h += '<p class="sp-note">No fair-value estimate is published for ' + esc(sym) + '. This symbol is not scored in the value screen (its sector is not scored, or it fails the quality gate: positive TTM EPS and positive net worth). Published fundamentals, peer comparison and the chart remain the research basis — nothing here is a price target.</p>';
    if (fund) {
      const bits = [];
      if (fund.pe_ttm) bits.push('P/E (TTM): ' + fmtNum(fund.pe_ttm));
      if (fund.eps_ttm) bits.push('EPS (TTM): Rs ' + fmtNum(fund.eps_ttm));
      if (fund.netprofit_b !== undefined && fund.netprofit_b !== null) bits.push('Net profit: Rs ' + fmtNum(fund.netprofit_b) + 'B');
      if (bits.length) h += '<p>' + bits.join(' · ') + ' (' + esc(fund.period || '') + ').</p>';
    }
    h += '<p><a href="/nepse-value/">Open the value screen <span aria-hidden="true">→</span></a></p>';
  }
  h += '</section>';
  return h;
}

function forwardRecordBlock(sym, archiveSessions, ohlcRows) {
  if (!archiveSessions || !archiveSessions.length) return '';
  const byDate = new Map();
  const sorted = [];
  for (const r of (ohlcRows || [])) { byDate.set(r[0], r[4]); sorted.push(r[0]); }
  sorted.sort((a, b) => a - b);
  const dInt = (d) => Number(String(d).replace(/-/g, ''));
  const dStr = (i) => String(i).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  let bounce = 0, followed = 0, faded = 0, up = 0, pending = 0, flat = 0;
  let rows = '';
  for (const e of archiveSessions) {
    const di = dInt(e.date);
    const close = byDate.get(di);
    let next = null;
    for (const d of sorted) { if (d > di) { next = d; break; } }
    const nextClose = next !== null ? byDate.get(next) : undefined;
    let cat = '', cls = '', retTxt = '–';
    const buySide = e.v === 'Buy' || e.v === 'Strong Buy';
    const exitSide = e.v === 'Exit / Reduce' || e.v === 'Strong Exit';
    if (close === undefined || nextClose === undefined) { cat = 'Outcome pending'; cls = 'pend'; pending++; }
    else {
      const ret = (nextClose - close) / close * 100;
      retTxt = (ret > 0 ? '+' : '') + ret.toFixed(2) + '%';
      if (buySide) { if (ret > 0) { cat = 'Followed up'; cls = 'up'; up++; } else { cat = 'Faded'; cls = 'fade'; faded++; } }
      else if (exitSide) { if (ret > 0) { cat = 'Bounce-back watch'; cls = 'bounce'; bounce++; } else { cat = 'Followed down'; cls = 'down'; followed++; } }
      else { cat = 'No directional call'; cls = 'flat'; flat++; }
    }
    rows += '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.v) + '</td><td>' + esc(e.s) + '</td><td>' + esc(e.st) + '</td>';
    rows += '<td>' + (close === undefined ? '–' : fmtNum(close)) + '</td><td>' + (next === null ? '—' : dStr(next)) + '</td><td>' + retTxt + '</td>';
    rows += '<td><span class="sp-cat sp-cat-' + cls + '">' + cat + '</span></td></tr>';
  }
  let h = '<section aria-label="Forward record"><h2>Forward record: what happened after past verdicts</h2>';
  h += '<p class="sp-note">Each past verdict below is bucketed by the next closed session\u2019s return (close-to-close, same history series). A SELL-side verdict followed by a green next session is flagged Bounce-back watch — the failure pattern the learning loop watches. Returns are raw closes, not adjusted for bonus/right actions inside the window. Engine rules are not changed here; cases are recorded for that loop.</p>';
  if (!ohlcRows) h += '<p class="sp-note">No daily history file on record for ' + esc(sym) + ' — outcomes show as pending until the history backfill covers this symbol.</p>';
  h += '<div class="sp-table-wrap"><table class="sp-peer-table"><thead><tr><th>Session</th><th>Verdict</th><th>Score</th><th>Buy streak</th><th>Close (Rs)</th><th>Next session</th><th>Next return</th><th>Outcome</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  h += '<p>Summary: ' + up + ' followed up · ' + faded + ' faded · ' + followed + ' followed down · ' + bounce + ' bounce-back watch · ' + flat + ' no directional call · ' + pending + ' pending.</p>';
  if (bounce) h += '<p><strong>' + bounce + ' bounce-back case' + (bounce > 1 ? 's' : '') + ' on record</strong> — SELL-side verdicts the next session proved wrong. Handed to the learning loop with this evidence, not silently rewritten.</p>';
  h += '</section>';
  return h;
}

function verifiedNoticesBlock(sym, actions) {
  if (!actions || !actions.length) return '';
  let h = '<section aria-label="Verified corporate notices"><h2>Verified corporate notices</h2><ul class="sp-act">';
  for (const a of actions) {
    const link = a.officialPdf || a.sourceUrl || '';
    h += '<li><span class="sp-act-kind">' + esc(CA_KIND_LABEL[a.kind] || a.kind || 'Notice') + '</span> ';
    h += (link ? '<a href="' + esc(link) + '" rel="noopener" target="_blank">' + esc(a.headline) + '</a>' : esc(a.headline));
    h += '<span class="sp-act-meta">announced ' + esc(a.announced || '—') + ' · ' + esc(a.source || '');
    if (a.verifiedAt) h += ' · verified ' + esc(String(a.verifiedAt).slice(0, 10));
    h += '</span></li>';
  }
  h += '</ul></section>';
  return h;
}

/* Period-return ladder (agency-agents gap 1, C6b).
 * Computed ONLY from our own OHLC archive (~/workspace/nepse-data-archive/
 * ohlc-db, overridable via OHLC_DB_DIR), and ONLY from bars dated on or
 * after VERIFIED_START (2026-07-15). Bars before that date exist in the
 * archive from a scraper feed but are NOT independently verified, so they
 * are never used here: a period whose reference bar would fall before the
 * verified window renders as unavailable, never as a stub or an estimate.
 * Returns are price returns on UNADJUSTED closes by default: (anchor/ref - 1) * 100.
 * Bonus/right issues move price mechanically, so the section note says so.
 * Phase 2 (2026-10-28): where an event is OFFICIALLY VERIFIED (company
 * notice / NEPSE / SEBON filing — never portal agreement), bars dated
 * strictly before the event's ex-date are multiplied by the event factor
 * (bonus: 100/(100+pct); right: TERP/cum-close), and the note says exactly
 * which events were applied. Cash dividends are never adjusted: the honest
 * label is "bonus/right-adjusted price returns", never "total return".
 * A symbol with no verified event renders unadjusted with the caveat.
 * Each computable cell prints its actual reference date, so a period that
 * lands on a non-trading stretch is visible, never silently shortened.
 * A missing archive, a missing file, or a bad row degrades to unavailable
 * cells, never to a crash and never to an invented number. */
const OHLC_DB_DIR = process.env.OHLC_DB_DIR ||
  '/home/hatch/workspace/nepse-data-archive/ohlc-db';
const VERIFIED_START = '2026-07-15';
const LADDER_PERIODS = [
  { label: '1W', days: 7 },
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: '3Y', months: 36 },
];
/* Bonus/right adjustments (Phase 2 fix, 2026-10-28).
 * adjustments.json (repo data) carries ONLY officially verified events:
 * each { symbol, kind: 'bonus'|'right', pct (bonus), ratio_new/ratio_old/
 * price (right), ex_date, book_close, source }. Cash dividends are never
 * in this file and never adjusted. A symbol with a claimed-but-unverified
 * event is listed under unverified_claims and renders unadjusted with
 * that claim named. Missing file = all unadjusted, never fatal.
 * Adjustment: bars dated strictly before ex_date are multiplied by the
 * event factor (bonus: 100/(100+pct); right: TERP/cum-close, cum = last
 * bar before ex_date). Bars on/after ex_date are already ex-basis. An
 * event whose factor cannot be computed (right with no cum bar) is
 * skipped and counted in the log, never estimated. */
function loadAdjustments() {
  const p = process.env.ADJUSTMENTS_JSON || path.join(DATA, 'adjustments.json');
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const verified = new Map();
    for (const e of (d.events || [])) {
      if (!e || !e.symbol || !e.ex_date || !e.kind) continue;
      if (!verified.has(e.symbol)) verified.set(e.symbol, []);
      verified.get(e.symbol).push(e);
    }
    const unverified = new Map();
    for (const u of (d.unverified_claims || [])) {
      if (u && u.symbol && u.claim) unverified.set(u.symbol, u.claim);
    }
    return { verified, unverified };
  } catch { return { verified: new Map(), unverified: new Map() }; }
}
function eventFactor(e, byDate) {
  if (e.kind === 'bonus' && Number.isFinite(+e.pct) && +e.pct > 0) return 100 / (100 + +e.pct);
  if (e.kind === 'right' && Number.isFinite(+e.ratio_new) && Number.isFinite(+e.ratio_old) && +e.ratio_old > 0 && Number.isFinite(+e.price)) {
    let cum = null;
    for (const d of [...byDate.keys()].sort()) {
      if (d < e.ex_date) cum = byDate.get(d); else break;
    }
    if (cum == null || cum <= 0) return null;
    return ((+e.ratio_old * cum + +e.ratio_new * +e.price) / (+e.ratio_old + +e.ratio_new)) / cum;
  }
  return null;
}
function subMonthsIso(iso, m) {
  const parts = iso.split('-').map(Number);
  const total = (parts[0] * 12 + (parts[1] - 1)) - m;
  const yy = Math.floor(total / 12);
  const mm = total - yy * 12 + 1;
  const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dd = Math.min(parts[2], dim);
  return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
}
function subDaysIso(iso, n) {
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
function loadLadder(sym, adjEvents) {
  const slug = slugOf(sym);
  let data = null;
  for (const f of [sym + '.json', slug + '.json']) {
    try { data = JSON.parse(fs.readFileSync(path.join(OHLC_DB_DIR, f), 'utf8')); break; }
    catch { /* try the next name */ }
  }
  if (!data || !Array.isArray(data.bars)) return null;
  const byDate = new Map();
  for (const b of data.bars) {
    const d = String((b && b.date) || '');
    const c = Number(b && b.close);
    if (d >= VERIFIED_START && Number.isFinite(c) && c > 0) byDate.set(d, c);
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return null;
  const anchor = dates[dates.length - 1];
  const c0raw = byDate.get(anchor);
  // Per-event factors (rights need the cum bar); uncomputable events skip.
  const factors = [];
  let skipped = 0;
  for (const e of (adjEvents || [])) {
    const f = eventFactor(e, byDate);
    if (f == null) { skipped++; continue; }
    factors.push({ event: e, factor: f });
  }
  const adj = (d) => {
    let c = byDate.get(d);
    for (const { event: e, factor: f } of factors) {
      if (d < e.ex_date) c *= f;
    }
    return c;
  };
  const c0 = adj(anchor);
  const cells = LADDER_PERIODS.map((p) => {
    const target = p.days ? subDaysIso(anchor, p.days) : subMonthsIso(anchor, p.months);
    let ref = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= target) { ref = dates[i]; break; }
    }
    if (!ref) return { label: p.label, pct: null, ref: null };
    return { label: p.label, pct: (c0 / adj(ref) - 1) * 100, ref };
  });
  // Adjusted only if at least one computable cell actually changed: an
  // event outside every (ref, anchor] interval leaves all ratios intact.
  let adjusted = false;
  for (const c of cells) {
    if (c.pct === null) continue;
    const raw = (c0raw / byDate.get(c.ref) - 1) * 100;
    if (Math.abs(raw - c.pct) > 1e-9) { adjusted = true; break; }
  }
  return { anchor, close: c0raw, first: dates[0], cells, adjusted, adjEvents: factors.map((x) => x.event), skipped };
}
function ladderSection(sym, ladder) {
  let h = '<section aria-label="Period returns"><h2>Period returns</h2>\n';
  if (!ladder) {
    h += '<p class="sp-note">No verified OHLC history on file for this security, so no period return can be computed. Nothing is estimated.</p>\n';
    h += '<div class="sp-fund-grid">\n';
    for (const p of LADDER_PERIODS) {
      h += '<div class="sp-fund"><span class="sp-fund-l">' + esc(p.label) + '</span>' +
        '<span class="sp-fund-v na">–</span><span class="sp-ret-ref">No verified history</span></div>\n';
    }
    h += '</div></section>\n';
    return h;
  }
  const hist = ladder.first > VERIFIED_START
    ? 'First verified close for this security: ' + esc(ladder.first) + '.'
    : 'Verified history starts 2026-07-15; longer periods show as unavailable until that history exists.';
  if (ladder.adjusted) {
    const evList = ladder.adjEvents.map((e) => e.kind === 'bonus'
      ? esc(+e.pct) + '% bonus (ex-date ' + esc(e.ex_date) + ')'
      : esc(e.ratio_new) + ':' + esc(e.ratio_old) + ' right at Rs ' + esc(e.price) + ' (ex-date ' + esc(e.ex_date) + ')').join('; ');
    h += '<p class="sp-note">Bonus/right-adjusted price returns from Nepse Decode\'s own OHLC archive. ' +
      'Latest close ' + esc(ladder.anchor) + ' · Rs ' + fmtNum(ladder.close) + '. ' + hist +
      ' Adjusted for: ' + evList + '. Cash dividends are not reinvested, so these are bonus/right-adjusted price returns, not total returns.</p>\n';
  } else if (ladder.unverifiedClaim) {
    h += '<p class="sp-note">Price returns on unadjusted closes from Nepse Decode\'s own OHLC archive. ' +
      'Latest close ' + esc(ladder.anchor) + ' · Rs ' + fmtNum(ladder.close) + '. ' + hist +
      ' Bonus or right issues move price mechanically, so a return spanning one is a price move, not a total return. ' +
      'Note: ' + esc(ladder.unverifiedClaim) + ' — this could not be officially verified, so no adjustment is applied.</p>\n';
  } else {
    h += '<p class="sp-note">Price returns on unadjusted closes from Nepse Decode\'s own OHLC archive. ' +
      'Latest close ' + esc(ladder.anchor) + ' · Rs ' + fmtNum(ladder.close) + '. ' + hist +
      ' Bonus or right issues move price mechanically, so a return spanning one is a price move, not a total return.</p>\n';
  }
  h += '<div class="sp-fund-grid">\n';
  for (const c of ladder.cells) {
    if (c.pct === null) {
      h += '<div class="sp-fund"><span class="sp-fund-l">' + esc(c.label) + '</span>' +
        '<span class="sp-fund-v na">–</span><span class="sp-ret-ref">No verified history</span></div>\n';
    } else {
      const r = Math.round(c.pct * 100) / 100;
      const cls = r > 0 ? ' pos' : (r < 0 ? ' neg' : '');
      const sign = r > 0 ? '+' : '';
      h += '<div class="sp-fund"><span class="sp-fund-l">' + esc(c.label) + '</span>' +
        '<span class="sp-fund-v sp-ret-v' + cls + '">' + sign + r.toFixed(2) + '%</span>' +
        '<span class="sp-ret-ref">from ' + esc(c.ref) + '</span></div>\n';
    }
  }
  h += '</div></section>\n';
  return h;
}

function symbolPage(u, v, newsItems, fund, liveQ, liveDate, sector, sectorPeers, verdicts, quarterly, corpHist, related, extra, ladder) {
  const sym = u.s, name = u.n, slug = slugOf(sym);
  // Headline price prefers our canonical live payload (NEPSE API) when it is
  // at least as fresh as the batch verdict — the batch daily history comes
  // from a third-party feed that can lag by a session.
  const vAsof = (v && v.asof) || '';
  const useLive = !!(liveQ && liveDate && liveDate >= vAsof && Number.isFinite(Number(liveQ.ltp)));
  const pNum = useLive ? Number(liveQ.ltp) : (v && v.p);
  const cNum = (useLive && Number.isFinite(Number(liveQ.percent_change))) ? Number(liveQ.percent_change) : (v && v.ch);
  const asofD = useLive ? liveDate : vAsof;
  const price = fmtNum(pNum);
  const chg = cNum !== null && cNum !== undefined && cNum !== '' ? esc(cNum) + '%' : null;
  const chgCls = chg && Number(cNum) < 0 ? 'neg' : (chg && Number(cNum) > 0 ? 'pos' : '');

  let h = head(sym, name, slug) + RAIL + '<main id="main" class="sig-wrap">\n';
  h += '<p class="sig-kicker">' + esc(u.t || 'Security') + ' · NEPSE</p>\n';
  h += '<h1>' + esc(name) + ' (' + esc(sym) + ')</h1>\n';
  h += '<p class="sig-sub">Data as of ' + esc(asofD) + ' · refreshed daily after market close</p>\n';

  // Price snapshot — hydrated live in the browser by /js/stock-live.js
  // (data-live-symbol), so the page stays fresh without rebuilds.
  h += '<section class="sp-snap" aria-label="Price snapshot" data-live-symbol="' + esc(sym) + '"><div class="sp-price-card">\n';
  h += '<div class="sp-price-main">\n';
  if (price) {
    h += '<div class="sp-price">Rs ' + price + '</div>\n';
    if (chg) h += '<div class="sp-chg ' + chgCls + '">' + (Number(cNum) > 0 ? '+' : '') + chg + ' on the session</div>\n';
  } else {
    h += '<div class="sp-price">No recent price data</div>\n';
  }
  h += '<span class="sp-live-badge" data-live-badge style="display:none">LIVE</span>\n';
  h += '</div><div class="sp-price-side">\n';
  const h52 = fmtNum(v && v.h52), l52 = fmtNum(v && v.l52);
  if (h52 || l52) h += '<div class="sp-stat"><span class="sp-stat-v">Rs ' + (l52 || '–') + ' – Rs ' + (h52 || '–') + '</span><span class="sp-stat-l">52-week range</span></div>\n';
  const vol = fmtNum(useLive && Number.isFinite(Number(liveQ.volume)) ? Number(liveQ.volume) : (v && v.vol));
  if (vol) h += '<div class="sp-stat"><span class="sp-stat-v" data-live-vol>' + vol + '</span><span class="sp-stat-l">Volume (shares)</span></div>\n';
  const tno = fmtNum(useLive && Number.isFinite(Number(liveQ.turnover)) ? Math.round(Number(liveQ.turnover)) : null);
  if (tno) h += '<div class="sp-stat"><span class="sp-stat-v" data-live-turnover>Rs ' + tno + '</span><span class="sp-stat-l">Turnover</span></div>\n';
  h += '</div>';
  h += '</div></section>\n';
  if (extra) h += sessionStrip(extra);

h += '<div class="sp-tabs" role="tablist" aria-label="Security details">';
  h += '<button class="sp-tab active" role="tab" aria-selected="true" data-tab="overview">Overview</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="signals">Signals</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="fundamentals">Fundamentals</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="news">News</button>';
  h += '<button class="sp-tab" role="tab" aria-selected="false" data-tab="actions">Corporate Actions</button>';
  h += '</div>';
  h += '<div class="sp-tabpanel active" data-panel="overview" role="tabpanel">';
  h += '<p class="sp-note">Price snapshot above. Below: every stock in this sector, valuation context and the forward record of past verdicts. Switch tabs for engine signals, published fundamentals, latest headlines and corporate actions.</p>';
  h += companyBlock(blockFacts(u, v, fund, sector, { pNum, cNum, asofD, volFmt: vol, tnoFmt: tno }));
  if (extra) {
    h += sectorStocksBlock(sym, sector, sectorPeers, verdicts, extra.liveMap);
    h += valuationContextBlock(sym, extra.valueRow, fund);
    h += forwardRecordBlock(sym, extra.archiveSessions, extra.ohlcRows);
  }
  h += '<ul class="sp-links">';
  h += '<li><a href="/nepse-chart/?s=' + esc(sym) + '">Full chart, patterns and divergences <span aria-hidden="true">→</span></a></li>';
  h += '<li><a href="/nepse-screener/">Ranked screener <span aria-hidden="true">→</span></a></li>';
  h += '</ul>';
  h += ladderSection(sym, ladder);
  h += '</div>';
  h += '<div class="sp-tabpanel" data-panel="signals" role="tabpanel" hidden>';
  h += '<h2>Engine Verdict signals</h2>';
  h += '<p class="sp-note">Transparent rule-based readings, one per timeframe. A daily Buy can be weak while the weekly read is stronger; each pill names its own timeframe and data date.</p>';
  h += pill('Daily', v) + pill('Weekly', v && v.w) + pill('Monthly', v && v.m);
  h += '</div>';
  h += '<div class="sp-tabpanel" id="fundamentals" data-panel="fundamentals" role="tabpanel" hidden>';
  h += valLab(sym, name, sector, sectorPeers, quarterly, fund, { p: pNum, ch: cNum }, asofD);
  h += fundBlock(sym, fund, sector);
  h += quarterlyTable(sym, quarterly, sector);
  h += peerTable(sym, sector, sectorPeers, verdicts, fund);
  h += '</div>';
  h += '<div class="sp-tabpanel" data-panel="news" role="tabpanel" hidden>';
  h += '<h2>Latest headlines</h2>';
  if (extra && extra.newsAsof) h += '<p class="sp-news-foot">Feed as of ' + esc(extra.newsAsof) + (extra.newsCount ? ' (' + esc(extra.newsCount) + ' items)' : '') + '. Only headlines tagged with this symbol appear here — general market news is never shown as if it were about this symbol.</p>';
  if (newsItems.length) {
    h += '<ul class="sp-news">';
    for (const it of newsItems.slice(0, 5)) {
      h += '<li><a href="' + esc(it.link) + '" rel="noopener" target="_blank">' + esc(it.title) + '</a> ';
      h += '<span class="sp-news-src">' + esc(it.src || '') + ' · ' + esc(it.date || '') + '</span></li>';
    }
    h += '</ul>';
  } else {
    h += '<p class="sp-note">No recent headlines mention ' + esc(sym) + ' in the tracked press.</p>';
    if (extra && extra.newsAsof) h += '<p class="sp-news-foot">The feed itself is current (as of ' + esc(extra.newsAsof) + ') — this symbol simply has no tagged headlines in it yet.</p>';
  }
  h += '</div>';
  h += '<div class="sp-tabpanel" data-panel="actions" role="tabpanel" hidden>';
  h += '<h2>Corporate actions</h2>';
  h += '<p class="sp-note">Past dividends, bonus shares, right shares, auctions and AGM history.</p>';
  if (extra) h += verifiedNoticesBlock(sym, extra.actions);
  h += investmentCalendarCard(sym, name, corpHist);
  h += '</div>';

  // (teardown 2026-10-28) The old top-5 "More in the sector" link list
  // is gone: the full sector-stocks block in the overview panel now
  // carries every peer link, so the short list only duplicated it.

  // SEO cross-linking: Nepse Decode articles that cover this symbol.
  if (related && related.length) {
    h += '<section aria-label="Related analysis"><h2>Related analysis</h2><ul class="sp-peers">\n';
    for (const r of related) {
      h += '<li><a href="' + esc(r.url) + '">' + esc(r.title) + '</a></li>\n';
    }
    h += '</ul></section>\n';
  }

  h += '<p class="sp-disc">Educational use only, not investment advice. Signals are mechanical readings of past prices; past patterns do not guarantee future results.</p>\n';
// Tab switching
  h += '<script>(function(){';
  h += 'var tabs=document.querySelectorAll(".sp-tab"),panels=document.querySelectorAll(".sp-tabpanel");';
  h += 'function on(n){tabs.forEach(function(t){var a=t.dataset.tab===n;t.classList.toggle("active",a);t.setAttribute("aria-selected",a);t.tabIndex=a?0:-1;});';
  h += 'panels.forEach(function(p){var a=p.dataset.panel===n;p.classList.toggle("active",a);if(a)p.removeAttribute("hidden");else p.setAttribute("hidden","");});}';
  h += 'tabs.forEach(function(t){if(!t.classList.contains("active"))t.tabIndex=-1;';
  h += 't.addEventListener("click",function(){on(t.dataset.tab);});';
  h += 't.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key==="ArrowLeft"||e.key==="Home"||e.key==="End"){e.preventDefault();';
  h += 'var i=Array.prototype.indexOf.call(tabs,t);var nx=e.key==="Home"?0:e.key==="End"?tabs.length-1:e.key==="ArrowRight"?(i+1)%tabs.length:(i-1+tabs.length)%tabs.length;';
  h += 'tabs[nx].focus();on(tabs[nx].dataset.tab);}});});';
  h += 'document.querySelectorAll("[data-goto-tab]").forEach(function(a){a.addEventListener("click",function(){on(a.dataset.gotoTab);});});';
  h += 'if(location.hash==="#fundamentals"){on("fundamentals");}';
  h += 'if(location.hash==="#actions"){on("actions");}';
  // Investment Calendar: sidebar tabs, search, pagination
  h += 'document.querySelectorAll(".inv-cal").forEach(function(card){';
  // Phase 6 (D8): empty investor-calendar cards (debentures / new listings /
  // promoter shares with no compiled history) carry no [data-inv-uid] child;
  // the old unguarded .dataset read threw on all 111 such pages. Skip the
  // pager wiring for a card with no uid element — there is nothing to page.
  h += 'var uidEl=card.querySelector("[data-inv-uid]");if(!uidEl)return;var uid=uidEl.dataset.invUid;';
  h += 'var state={tab:"dividends",q:"",page:1,per:10};';
  h += 'function rows(){var p=card.querySelector("[data-inv-panel=\\""+state.tab+"\\"]");';
  h += 'if(!p)return[];return Array.prototype.slice.call(p.querySelectorAll("tbody tr"));}';
  h += 'function filtered(){var q=state.q.toLowerCase();return rows().filter(function(r){';
  h += 'return !q||r.textContent.toLowerCase().indexOf(q)>-1;});}';
  h += 'function render(){var list=filtered(),total=list.length,pages=Math.max(1,Math.ceil(total/state.per));';
  h += 'if(state.page>pages)state.page=pages;var s=(state.page-1)*state.per;';
  h += 'rows().forEach(function(r){r.style.display="none";});';
  h += 'list.slice(s,s+state.per).forEach(function(r){r.style.display="";});';
  h += 'var info=card.querySelector(".inv-cal-info");';
  h += 'info.textContent=total?("Showing "+(s+1)+" to "+Math.min(s+state.per,total)+" of "+total+" entries"):"Showing 0 entries";';
  h += 'var nums=card.querySelector(".inv-cal-pagenums");nums.innerHTML="";';
  h += 'for(var i=1;i<=pages&&i<=7;i++){var b=document.createElement("button");';
  h += 'b.textContent=i;b.className="inv-cal-pg"+(i===state.page?" cur":"");';
  h += 'b.dataset.pg=i;b.addEventListener("click",function(){state.page=+this.dataset.pg;render();});nums.appendChild(b);}';
  h += 'card.querySelector(".inv-cal-prev").disabled=state.page<=1;';
  h += 'card.querySelector(".inv-cal-next").disabled=state.page>=pages;}';
  h += 'card.querySelectorAll("[data-inv-tab]").forEach(function(t){t.addEventListener("click",function(){';
  h += 'card.querySelectorAll("[data-inv-tab]").forEach(function(x){x.classList.remove("active");x.setAttribute("aria-selected","false");});';
  h += 't.classList.add("active");t.setAttribute("aria-selected","true");';
  h += 'state.tab=t.dataset.invTab;state.page=1;';
  h += 'card.querySelectorAll("[data-inv-panel]").forEach(function(p){p.hidden=p.dataset.invPanel!==state.tab;});';
  h += 'render();});});';
  h += 'var q=card.querySelector(".inv-cal-q");if(q)q.addEventListener("input",function(){state.q=this.value;state.page=1;render();});';
  h += 'var pp=card.querySelector(".inv-cal-perpage");if(pp)pp.addEventListener("change",function(){state.per=+this.value;state.page=1;render();});';
  h += 'card.querySelector(".inv-cal-prev").addEventListener("click",function(){if(state.page>1){state.page--;render();}});';
  h += 'card.querySelector(".inv-cal-next").addEventListener("click",function(){state.page++;render();});';
  /* Dividend status: derived from the Book Close Date against TODAY IN
   * KATHMANDU (Asia/Kathmandu), so every visitor sees the same status.
   * Open while the book close date is today or in the future, Closed once it
   * has passed. Computed here in the browser so the status flips on its own
   * when the date passes — no rebuild needed. Rows with no valid book close
   * date on record show an honest "–" (unknown) — never a guessed status. */
  h += 'card.querySelectorAll("[data-inv-panel=\\"dividends\\"] .inv-cal-divstatus").forEach(function(el){';
  h += 'var bc=el.getAttribute("data-bc")||"";';
  h += 'if(el.getAttribute("data-closed")==="1"){el.innerHTML="<span class=\\"inv-pill inv-pill-closed\\">Closed</span>";return;}';
  h += 'var today="";try{today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kathmandu",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}';
  h += 'catch(e){var kd=new Date(Date.now()+20700000);today=kd.getUTCFullYear()+"-"+("0"+(kd.getUTCMonth()+1)).slice(-2)+"-"+("0"+kd.getUTCDate()).slice(-2);}';
  h += 'if(/^\\d{4}-\\d{2}-\\d{2}$/.test(bc)){var closed=bc<today;';
  h += 'el.innerHTML="<span class=\\"inv-pill "+(closed?"inv-pill-closed":"inv-pill-open")+"\\">"+(closed?"Closed":"Open")+"</span>";return;}';
  h += 'var ann=el.getAttribute("data-ann")||"";';
  h += 'if(/^\\d{4}-\\d{2}-\\d{2}$/.test(ann)){var ad=new Date(ann+"T00:00:00"),td=new Date(today+"T00:00:00");';
  h += 'var daysOld=Math.floor((td-ad)/86400000);';
  h += 'if(daysOld>=0&&daysOld<=365){el.innerHTML="<span class=\\"inv-pill inv-pill-open\\">Open</span>";return;}}';
  h += 'el.textContent="\\u2013";});';
  h += 'render();});';
  h += '})();</scr' + 'ipt>';
  h += '</main>\n' + FOOT;
  return h;
}

function indexPage(symbols, asof) {
  const title = 'All NEPSE Listed Securities | Nepse Decode';
  const desc = 'Alphabetical directory of every NEPSE-listed security with a free price, signal and news snapshot. Educational, no login.';
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: title,
    url: SITE + '/stocks/',
    description: desc,
    author: { '@type': 'Person', name: 'Shirjan Khadka', url: SITE + '/' },
  };
  let h = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<script>try{var t=localStorage.getItem(\'sk-theme\');if(!t)t=\'dark\';document.documentElement.setAttribute(\'data-theme\',t);if(t===\'light\')document.documentElement.setAttribute(\'data-nd-ed\',\'light\')}catch(e){}</script>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(title) + '</title>\n<meta name="description" content="' + esc(desc) + '">\n' +
    '<link rel="canonical" href="' + SITE + '/stocks/">\n' +
    '<meta name="robots" content="index, follow">\n' +
    '<meta property="og:title" content="' + esc(title) + '">\n' +
    '<meta property="og:description" content="' + esc(desc) + '">\n' +
    '<meta property="og:url" content="' + SITE + '/stocks/">\n' +
    '<meta property="og:image" content="' + OG_STOCKS + '">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + esc(title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '">\n' +
    '<meta name="twitter:image" content="' + OG_STOCKS + '">\n' +
    '<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
    '<link rel="stylesheet" href="/css/fonts.css">\n' +
    '<link rel="stylesheet" href="/css/nd-tokens.css?v=20261023d">\n' +
    '<link rel="stylesheet" href="/css/nd-chrome.css?v=20261023d">\n' +
    '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261023d">\n' +
    '<link rel="stylesheet" href="/css/sig-pro.css?v=20261023d">\n' +
    SP_STYLES +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n</head>\n' +
    RAIL + '<main id="main" class="sig-wrap">\n' +
    '<p class="sig-kicker">Directory</p>\n' +
    '<h1>All NEPSE listed securities</h1>\n' +
    '<p class="sig-sub">' + symbols.length + ' instruments · data as of ' + esc(asof || '') + '</p>\n' +
    '<section aria-label="Security directory"><ul class="sp-dir">\n';
  const sorted = symbols.slice().sort((a, b) => String(a.s).localeCompare(String(b.s)));
  for (const u of sorted) {
    h += '<li><a href="/stocks/' + slugOf(u.s) + '/">' + esc(u.n) + ' (' + esc(u.s) + ')</a> <span class="sp-type">' + esc(u.t || '') + '</span></li>\n';
  }
  h += '</ul></section>\n<p class="sp-disc">Educational use only, not investment advice.</p>\n</main>\n' + FOOT;
  return h;
}

function main() {
  /* --symbol=XYZ rebuilds a single stock page (used by the dividend watcher
   * to refresh one Investment Calendar the moment a dividend is announced). */
  const onlySym = (process.argv.find((a) => a.startsWith('--symbol=')) || '').slice(9).toUpperCase();
  const universe = loadJson(path.join(DATA, 'universe.json'), null);
  const ver = loadJson(path.join(DATA, 'verdicts.json'), null);
  const news = loadJson(path.join(DATA, 'news.json'), null);
  const fund = loadJson(path.join(DATA, 'fundamentals.json'), null);
  const quarterly = loadJson(path.join(DATA, 'quarterly.json'), null);
  const corpHistData = loadJson(path.join(DATA, 'corp-history.json'), null);
  const corpHist = (corpHistData && corpHistData.companies) || {};
  /* Second dividend source: yonepse open API (tools/fetch-yonepse-dividends.js
   * -> div-history-yonepse.json). Union with the crawl's dividends, deduped by
   * (fiscal year, bonus %, cash %); crawl rows win ties (richer fields).
   * (2026-09-30: his call — never depend on a single source.) */
  const ynData = loadJson(path.join(DATA, 'div-history-yonepse.json'), null);
  const ynDivs = (ynData && ynData.companies) || {};
  const divKey = (d) => {
    const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    return String(d.year || d.fiscal_year || '').trim() + '|' + n(d.bonus_share) + '|' + n(d.cash_dividend);
  };
  for (const sym of Object.keys(ynDivs)) {
    const seen = new Set(), merged = [];
    for (const d of (((corpHist[sym] || {}).dividends) || [])) {
      const k = divKey(d);
      if (!seen.has(k)) { seen.add(k); merged.push(d); }
    }
    for (const d of (ynDivs[sym] || [])) {
      const k = divKey(d);
      if (!seen.has(k)) { seen.add(k); merged.push(d); }
    }
    merged.sort((a, b) =>
      String(b.year || b.fiscal_year || '').localeCompare(String(a.year || a.fiscal_year || '')) ||
      String(b.announcement_date || '').localeCompare(String(a.announcement_date || '')));
    if (!corpHist[sym]) corpHist[sym] = {};
    corpHist[sym].dividends = merged;
  }
  /* Third dividend source: div-live.json — verified dividend announcements
   * recorded by the dividend watcher the moment they publish
   * (tools/record-live-dividend.js). On key collisions the richest record
   * (most filled fields) wins, so a live record carrying a fresh book close
   * date upgrades a sparser historical row. (2026-09-30: his order — the
   * Investment Calendar must update automatically on every new dividend.) */
  const divLiveData = loadJson(path.join(DATA, 'div-live.json'), null);
  const divLive = (divLiveData && divLiveData.companies) || {};
  const divRich = (d) => ['bonus_share', 'cash_dividend', 'total_dividend',
    'announcement_date', 'bookclose_date', 'year', 'fiscal_year'].reduce(
    (n, k) => n + (d[k] !== undefined && d[k] !== null && String(d[k]).trim() !== '' ? 1 : 0), 0);
  const divSort = (a, b) =>
    String(b.year || b.fiscal_year || '').localeCompare(String(a.year || a.fiscal_year || '')) ||
    String(b.announcement_date || '').localeCompare(String(a.announcement_date || ''));
  for (const sym of Object.keys(divLive)) {
    if (!corpHist[sym]) corpHist[sym] = {};
    const byKey = new Map();
    for (const d of (corpHist[sym].dividends || [])) byKey.set(divKey(d), d);
    for (const d of (divLive[sym] || [])) {
      const k = divKey(d), ex = byKey.get(k);
      if (!ex || divRich(d) > divRich(ex)) byKey.set(k, d);
    }
    corpHist[sym].dividends = [...byKey.values()].sort(divSort);
  }
  const actionsData = loadJson(path.join(DATA, 'corporate-actions.json'), null);
  const actionsBySym = {};
  if (actionsData && actionsData.items) {
    for (const a of actionsData.items) {
      if (!a.symbol) continue;
      (actionsBySym[a.symbol] = actionsBySym[a.symbol] || []).push(a);
    }
  }
  // Canonical live quotes (NEPSE API) for the headline price snapshot.
  const live = loadJson(path.join(DATA, 'live.json'), null);
  const liveMap = {};
  let liveDate = '';
  if (live && Array.isArray(live.quotes)) {
    for (const q of live.quotes) { if (q && q.symbol) liveMap[q.symbol] = q; }
    liveDate = String(live.asof || '').slice(0, 10);
  }
  const pageAsof = (liveDate && liveDate >= String((ver && ver.asof) || '')) ? liveDate : ((ver && ver.asof) || '');
  /* teardown 2026-10-28 payloads: manifest (session + generation stamp),
   * audit (scored count), value screen (map), verdict archive (sessions). */
  const manifest = loadJson(path.join(ROOT, 'data', 'manifest.json'), null);
  const audit = loadJson(path.join(DATA, 'audit.json'), null);
  const valueData = loadJson(path.join(DATA, 'value.json'), null);
  const valueBySym = {};
  if (valueData && Array.isArray(valueData.stocks)) {
    for (const r of valueData.stocks) { if (r && r.symbol) valueBySym[r.symbol] = r; }
  }
  const archiveData = loadJson(path.join(DATA, 'screener-verdict-archive.json'), null);
  const archiveSessionsBySym = {};
  if (archiveData && archiveData.sessions) {
    const dates = Object.keys(archiveData.sessions).sort().reverse();
    for (const d of dates) {
      const sess = archiveData.sessions[d] || {};
      for (const sy of Object.keys(sess)) {
        (archiveSessionsBySym[sy] = archiveSessionsBySym[sy] || []).push({ date: d, v: sess[sy].v, s: sess[sy].s, st: sess[sy].st });
      }
    }
  }
  const liveQuotesCount = (live && Array.isArray(live.quotes)) ? live.quotes.length : 0;
  const newsAsof = news ? String(news.asof || '') : '';
  const newsCount = (news && Array.isArray(news.items)) ? news.items.length : 0;
  if (!universe || !universe.symbols || !ver || !ver.verdicts) {
    console.error('build-symbol-pages: missing universe/verdicts data');
    process.exit(1);
  }
  const symbols = onlySym
    ? universe.symbols.filter((u) => String(u.s).toUpperCase() === onlySym)
    : universe.symbols;
  const verdicts = ver.verdicts;
  const newsBySym = {};
  if (news && news.items) {
    for (const it of news.items) {
      if (!it.sym) continue;
      (newsBySym[it.sym] = newsBySym[it.sym] || []).push(it);
    }
  }
  // Sector peers: classified with the same NEPSE sector map as the
  // screener and sector heatmap, ranked by engine score desc.
  const scoreOf = (s) => { const e = verdicts[s]; const sc = e && e.s; return (sc === null || sc === undefined) ? -Infinity : Number(sc); };
  const sectorOf = {};
  const bySector = {};
  for (const u of symbols) {
    const sec = classifySymbol(u.s, u.n, u.t);
    sectorOf[u.s] = sec;
    if (sec) (bySector[sec] = bySector[sec] || []).push(u);
  }
  for (const sec of Object.keys(bySector)) bySector[sec].sort((a, b) => scoreOf(b.s) - scoreOf(a.s));

  /* SEO cross-linking source: blog articles whose title/meta keywords mention
   * a symbol token. Scanned once per run (works for --symbol=XYZ too, since
   * the map is built from the blog tree, not the symbol batch). */
  const blogArts = scanRelatedArticles();

  /* Period-return ladders from our own OHLC archive (verified window only).
   * Never fatal: a missing archive or file degrades that symbol's ladder
   * to unavailable cells, and the counts below make it visible in the log.
   * Verified bonus/right events (adjustments.json) are applied per symbol;
   * unverified claims ride along for the honest unadjusted note. */
  const adjustments = loadAdjustments();
  const ladderMap = {};
  let ladderOk = 0, ladderNone = 0, adjSymbols = 0, adjEventsApplied = 0, adjSkipped = 0;
  for (const u of symbols) {
    try {
      const lad = loadLadder(u.s, adjustments.verified.get(u.s) || []);
      if (lad) {
        lad.unverifiedClaim = adjustments.unverified.get(u.s) || null;
        if (lad.adjusted) { adjSymbols++; adjEventsApplied += lad.adjEvents.length; }
        adjSkipped += lad.skipped || 0;
      }
      ladderMap[u.s] = lad;
      if (lad) ladderOk++; else ladderNone++;
    } catch { ladderMap[u.s] = null; ladderNone++; }
  }

  let made = 0;
  for (const u of symbols) {
    const sym = u.s, slug = slugOf(sym);
    const v = verdicts[sym] || null;
    const sector = sectorOf[sym] || null;
    const sectorPeers = sector ? (bySector[sector] || []) : [];
    const related = relatedForSymbol(blogArts, sym);
    let ohlcRows = null;
    try {
      const od = loadJson(path.join(DATA, 'daily-ohlc', slug + '.json'), null);
      if (od && Array.isArray(od.rows)) ohlcRows = od.rows;
    } catch { ohlcRows = null; }
    const extra = {
      pageAsof, liveDate, manifest,
      scored: audit ? audit.count : null, quotes: liveQuotesCount,
      liveMap, valueRow: valueBySym[sym] || null,
      archiveSessions: archiveSessionsBySym[sym] || [],
      ohlcRows, actions: actionsBySym[sym] || [],
      newsAsof, newsCount,
    };
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), symbolPage(u, v, newsBySym[sym] || [], fund, liveMap[sym], liveDate, sector, sectorPeers, verdicts, quarterly, corpHist[sym], related, extra, ladderMap[sym]));
    made++;
  }
  if (!onlySym) {
    /* Wave E: the /stocks/ directory also lists baked pages whose symbols
     * are no longer in universe.json (delisted / renamed instruments whose
     * pages remain live). Without them those pages are orphans — nothing
     * links to them. Their name/type are read back from each page's own
     * baked <h1> and sector kicker; no data is invented. */
    const extras = scanBakedExtras(new Set(symbols.map((u) => slugOf(u.s))));
    fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(symbols.concat(extras), pageAsof));
  }
  console.log(JSON.stringify({ pages: made, dir: 'stocks/', symbol: onlySym || undefined, ladder: { withData: ladderOk, noData: ladderNone, archive: OHLC_DB_DIR }, adjustments: { events: adjEventsApplied, symbols: adjSymbols, skipped: adjSkipped } }));
}

/* Baked stock pages on disk that universe.json no longer carries.
 * Returns [{ s, n, t }] parsed from each page itself (h1 "Name (SYM)",
 * kicker "Type · NEPSE"); pages without a parseable h1 are skipped. */
function scanBakedExtras(knownSlugs) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(OUT, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory() || knownSlugs.has(d.name)) continue;
    let html;
    try { html = fs.readFileSync(path.join(OUT, d.name, 'index.html'), 'utf8'); } catch { continue; }
    const h1 = html.match(/<h1>([\s\S]*?)\(([^()]*)\)<\/h1>/);
    if (!h1) continue;
    const kick = html.match(/sig-kicker">([\s\S]*?) · NEPSE</);
    out.push({ s: h1[2].trim(), n: h1[1].trim(), t: kick ? kick[1].trim() : '' });
  }
  return out;
}

if (require.main === module) main();

/* Exported for tools/apply-stock-seo.js, which brings the already-baked
 * pages to the identical end state without a full regeneration. */
module.exports = { classifySymbol, sectorGroup, slugOf, fmtNum, esc,
  blockFacts, companyBlock, SP_ABOUT_CSS, OG_STOCKS, scanBakedExtras };
