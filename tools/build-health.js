#!/usr/bin/env node
/**
 * build-health.js — Phase 5 diagnostics.
 *
 * Generates data/health.json at the END of the market-close pipeline
 * (and the intraday workflow). health.json is DIAGNOSTIC, never a gate:
 * this script must never fail the workflow — on any builder error it
 * records status "fail" for that check and continues.
 *
 * Usage: node tools/build-health.js [--out data/health.json]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(ROOT, 'data', 'health.json');

const PIPELINE_VERSION = 5; // five-phase overhaul

function nptNow() {
  // ISO-ish with +05:45 offset, no external deps.
  const d = new Date(Date.now() + (5 * 60 + 45) * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:45`;
}

function readJsonSafe(p) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch (e) { return -1; }
}

const checks = [];
function check(name, fn) {
  // A check NEVER throws out of build-health.js — failure is recorded, not raised.
  try {
    const r = fn();
    checks.push({
      name,
      status: r.status,
      detail: r.detail || '',
      checked_at_npt: nptNow(),
    });
  } catch (e) {
    checks.push({
      name,
      status: 'fail',
      detail: 'check crashed: ' + String(e && e.message || e),
      checked_at_npt: nptNow(),
    });
  }
}

// ---- individual checks ----

check('live.json valid', () => {
  const p = path.join(ROOT, 'nepse-chart', 'data', 'live.json');
  const r = readJsonSafe(p);
  if (!r.ok) return { status: 'fail', detail: 'unreadable/invalid JSON: ' + r.error };
  const q = r.data.quotes;
  if (!Array.isArray(q)) return { status: 'fail', detail: 'quotes is not an array' };
  if (q.length === 0) return { status: 'fail', detail: 'quotes array is EMPTY' };
  if (q.length < 300) return { status: 'warn', detail: `only ${q.length} quotes (expected 300+)` };
  return { status: 'ok', detail: `${q.length} quotes, asof ${r.data.asof || 'unknown'}` };
});

check('manifest version', () => {
  const p = path.join(ROOT, 'data', 'manifest.json');
  const r = readJsonSafe(p);
  if (!r.ok) return { status: 'fail', detail: 'manifest unreadable: ' + r.error };
  const v = r.data.version;
  if (typeof v !== 'number' || v < 1) return { status: 'warn', detail: 'version missing/not incrementing (got ' + JSON.stringify(v) + ')' };
  return { status: 'ok', detail: `version ${v}, session ${r.data.session_date || 'unknown'}` };
});

check('trending/value fresh', () => {
  const manR = readJsonSafe(path.join(ROOT, 'data', 'manifest.json'));
  const session = manR.ok ? manR.data.session_date : null;
  const files = [
    ['nepse-chart/data/trending.json', 'trending'],
    ['nepse-chart/data/value.json', 'value'],
  ];
  const stale = [];
  const missing = [];
  for (const [rel, label] of files) {
    const r = readJsonSafe(path.join(ROOT, rel));
    if (!r.ok) { missing.push(label); continue; }
    const s = r.data.session || r.data.session_date || r.data.asof;
    if (session && s && String(s).slice(0, 10) !== String(session).slice(0, 10)) {
      stale.push(`${label} (${String(s).slice(0, 10)} vs ${session})`);
    }
  }
  if (missing.length) return { status: 'warn', detail: 'missing: ' + missing.join(', ') };
  if (stale.length) return { status: 'warn', detail: 'stale vs manifest session: ' + stale.join('; ') };
  return { status: 'ok', detail: 'session matches manifest' };
});

check('sitemap.xml valid', () => {
  const p = path.join(ROOT, 'sitemap.xml');
  const sz = fileSize(p);
  if (sz < 0) return { status: 'fail', detail: 'sitemap.xml missing' };
  if (sz < 1000) return { status: 'warn', detail: `sitemap.xml suspiciously small (${sz} bytes)` };
  let head = '';
  try { head = fs.readFileSync(p, 'utf8').slice(0, 400); } catch (e) { /* size check already failed */ }
  if (!head.includes('<urlset') && !head.includes('<sitemapindex')) {
    return { status: 'fail', detail: 'not a valid sitemap (no urlset/sitemapindex root)' };
  }
  return { status: 'ok', detail: `${sz} bytes` };
});

check('no empty data files', () => {
  const dir = path.join(ROOT, 'nepse-chart', 'data');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); }
  catch (e) { return { status: 'fail', detail: 'data dir unreadable: ' + String(e && e.message || e) }; }
  const empty = names.filter((n) => fileSize(path.join(dir, n)) === 0);
  if (empty.length) return { status: 'fail', detail: 'empty files: ' + empty.join(', ') };
  return { status: 'ok', detail: `${names.length} JSON files, none empty` };
});

// ---- assemble health.json ----

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bakeStatusPage(health) {
  // No-JS fallback: bake the health summary into status/index.html's noscript block.
  // Fail-soft — a bake error never fails the workflow.
  try {
    const p = path.join(ROOT, 'status', 'index.html');
    let html = fs.readFileSync(p, 'utf8');
    const dot = health.overall === 'ok' ? '🟢' : health.overall === 'warn' ? '🟡' : '🔴';
    const rows = (health.checks || []).map((c) => {
      const d = c.status === 'ok' ? '🟢' : c.status === 'warn' ? '🟡' : '🔴';
      return `      <div class="row"><span>${escHtml(c.name)}</span><span>${d} ${escHtml(c.status.toUpperCase())}</span></div>`;
    }).join('\n');
    const baked = [
      '      <!-- HEALTH-BAKE-START -->',
      `      <p><strong>${dot} Pipeline ${escHtml(health.overall.toUpperCase())}</strong> — last session ${escHtml(health.last_session)},`,
      `      manifest v${escHtml(health.manifest_version)}, generated ${escHtml(health.generated_at_npt)} NPT.</p>`,
      rows,
      '      <p class="sub">Baked at build time. Enable JavaScript for live updates, or view raw: <a href="/data/health.json">/data/health.json</a>.</p>',
      '      <!-- HEALTH-BAKE-END -->',
    ].join('\n');
    const re = /      <!-- HEALTH-BAKE-START -->[\s\S]*?      <!-- HEALTH-BAKE-END -->/;
    if (!re.test(html)) {
      console.log('status/index.html: no HEALTH-BAKE markers found, skipping bake');
      return;
    }
    html = html.replace(re, baked);
    fs.writeFileSync(p, html);
    console.log('status/index.html: noscript health block baked');
  } catch (e) {
    console.error('status bake failed (non-fatal): ' + String(e && e.message || e));
  }
}

function main() {
  const manR = readJsonSafe(path.join(ROOT, 'data', 'manifest.json'));
  const man = manR.ok ? manR.data : {};

  const health = {
    generated_at_npt: nptNow(),
    pipeline_version: PIPELINE_VERSION,
    last_session: man.session_date || null,
    market_state: man.market_state || 'UNKNOWN',
    manifest_version: typeof man.version === 'number' ? man.version : null,
    data_tag: man.data_tag || null,
    checks,
  };

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  health.overall = fails ? 'fail' : warns ? 'warn' : 'ok';

  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(health, null, 2) + '\n');
    console.log(`health.json written: ${health.overall} (${checks.length} checks, ${fails} fail, ${warns} warn) -> ${OUT}`);
    bakeStatusPage(health);
  } catch (e) {
    // Even the write must not fail the workflow — log and exit 0.
    console.error('health.json write failed (non-fatal): ' + String(e && e.message || e));
  }
  process.exit(0);
}

main();
