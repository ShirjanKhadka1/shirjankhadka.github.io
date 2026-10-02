#!/usr/bin/env node
/**
 * tools/bake-noscript.js
 * Bakes a no-JS fallback into nepse-decode/index.html at market-close build time.
 *
 * No-JS users see: NEPSE index value, session date, market state — never a blank page.
 * The baked values ALWAYS carry their asof date so they're never mistaken for live.
 *
 * The block is marked with <!-- NOSCRIPT-BAKE-START --> / <!-- NOSCRIPT-BAKE-END -->
 * markers and replaced (not duplicated) on each run. Fail-soft: if live.json
 * is missing/unparseable, the existing baked block is left untouched.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'nepse-decode', 'index.html');
const LIVE = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');

const START = '<!-- NOSCRIPT-BAKE-START -->';
const END = '<!-- NOSCRIPT-BAKE-END -->';

function fmtNum(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function main() {
  let live;
  try {
    live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  } catch (e) {
    console.log('bake-noscript: live.json unavailable — keeping existing baked block (fail-soft)');
    return;
  }
  const idx = live.index || {};
  const value = idx.value;
  const change = idx.change;
  const pct = idx.pct_change;
  const asof = live.asof || '';
  const asofDate = asof.slice(0, 10);

  let session = asofDate, state = 'UNKNOWN';
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    session = m.session_date || session;
    state = m.market_state || state;
  } catch (e) { /* manifest optional */ }

  if (value == null) {
    console.log('bake-noscript: no index value in live.json — keeping existing baked block (fail-soft)');
    return;
  }

  const dir = change > 0 ? '▲' : change < 0 ? '▼' : '■';
  const dirColor = change > 0 ? '#0a7a3d' : change < 0 ? '#c0392b' : '#666';

  const block = `${START}
<noscript>
  <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0;background:#fafafa;font-family:system-ui,sans-serif">
    <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">NEPSE Index — static snapshot (JavaScript disabled)</div>
    <div style="font-size:32px;font-weight:700;margin:8px 0">${fmtNum(value)} <span style="font-size:18px;color:${dirColor}">${dir} ${change > 0 ? '+' : ''}${fmtNum(change || 0)} (${change > 0 ? '+' : ''}${Number(pct || 0).toFixed(2)}%)</span></div>
    <div style="font-size:13px;color:#444">Session: <b>${session}</b> · Market: <b>${state}</b></div>
    <div style="font-size:12px;color:#888;margin-top:6px">Baked at build time from data as of ${asofDate}. Enable JavaScript for live updates during market hours.</div>
  </div>
</noscript>
${END}`;

  let html = fs.readFileSync(PAGE, 'utf8');
  const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (re.test(html)) {
    html = html.replace(re, () => block);
    console.log('bake-noscript: replaced existing baked block');
  } else {
    // Insert after the hero price div (first occurrence of the hero section anchor)
    const anchor = '<div class="d2-hero-chart">';
    if (!html.includes(anchor)) {
      console.log('bake-noscript: anchor not found — page unchanged (fail-soft)');
      return;
    }
    html = html.replace(anchor, () => block + '\n          ' + anchor);
    console.log('bake-noscript: inserted new baked block');
  }
  fs.writeFileSync(PAGE, html);
  console.log(`bake-noscript: NEPSE ${fmtNum(value)} session=${session} state=${state} asof=${asofDate}`);
}

if (require.main === module) main();
module.exports = { main };
