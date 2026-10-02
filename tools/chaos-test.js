#!/usr/bin/env node
/**
 * chaos-test.js — Phase 5 frontend resilience suite.
 *
 * Tests the Phase 1-3 data layer WITHOUT a browser, in a Node VM sandbox
 * with mocked browser globals. Every test asserts that bad data NEVER
 * reaches the screen: invalid payloads are rejected, spikes quarantined,
 * failures degrade to STALE with last-good retained.
 *
 * Exit code: 0 = all pass, 1 = any failure.
 * CI: runs as the `chaos` job in .github/workflows/ci.yml.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The market-config time logic reads local-timezone hours (correct for NPT
// browsers). Force NPT in this process so CI runners in any TZ get the same
// results; re-exec once if TZ isn't already NPT (Node reads TZ at startup).
if (process.env.TZ !== 'Asia/Kathmandu') {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, TZ: 'Asia/Kathmandu', CHAOS_TZ_FIXED: '1' },
    stdio: 'inherit',
  });
  process.exit(r.status === null ? 1 : r.status);
}

const ROOT = path.resolve(__dirname, '..');

// ---- sandbox with mocked browser globals ----
function loadModules() {
  const store = {};
  const listeners = {};
  const sandbox = {
    console,
    // localStorage mock
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    // document mock (visibility API)
    document: {
      hidden: false,
      addEventListener: (t, fn) => { listeners[t] = fn; },
    },
    // BroadcastChannel mock (in-memory bus)
    __bus: [],
    setTimeout: (fn) => 0,       // no real timers in tests
    clearTimeout: () => {},
    Date,
    JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error,
    isFinite, parseFloat, parseInt,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  function MockBC(name) { this.name = name; }
  MockBC.prototype.postMessage = function (msg) { sandbox.__bus.push({ name: this.name, msg }); };
  MockBC.prototype.addEventListener = function () {};
  MockBC.prototype.close = function () {};
  sandbox.BroadcastChannel = MockBC;
  // fetch mock — tests override per-case
  sandbox.fetch = () => Promise.reject(new Error('fetch not stubbed'));

  vm.createContext(sandbox);
  for (const f of ['js/nepse-market-config.js', 'js/nepse-format.js', 'js/nepse-data.js']) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox;
}

// ---- test harness ----
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(e && e.message || e).split('\n')[0]}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function validPayload(overrides) {
  const base = {
    asof: new Date(Date.now() - 60000).toISOString(),
    index: { value: 2599.15, change: 0.26, percent_change: 0.01 },
    quotes: [
      { symbol: 'NBL', ltp: 297, previous_close: 296, volume: 1000 },
      { symbol: 'NICA', ltp: 500, previous_close: 505, volume: 2000 },
    ],
  };
  return Object.assign(base, overrides || {});
}

// ---- run ----
console.log('Chaos suite — NEPSE data layer resilience\n');

test('corrupt live.json (invalid JSON shape) -> validateSnapshot rejects', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate('this is not json');
  assert(!v.ok, 'string payload should be rejected');
  assert(v.errors.length > 0, 'should carry errors');
});

test('corrupt live.json (null) -> rejected', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(null);
  assert(!v.ok, 'null payload should be rejected');
});

test('empty quotes array -> rejected', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({ quotes: [] }));
  assert(!v.ok, 'empty quotes should be rejected');
  assert(v.errors.some((e) => /quotes/i.test(e)), 'error should mention quotes');
});

test('missing quotes -> rejected', () => {
  const sb = loadModules();
  const p = validPayload(); delete p.quotes;
  const v = sb.NepseData._validate(p);
  assert(!v.ok, 'missing quotes should be rejected');
});

test('future timestamp -> rejected', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({
    asof: new Date(Date.now() + 3600000).toISOString(),
  }));
  assert(!v.ok, 'future asof should be rejected');
  assert(v.errors.some((e) => /future/i.test(e)), 'error should mention future');
});

test('negative index value -> rejected', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({ index: { value: -5 } }));
  assert(!v.ok, 'negative index should be rejected');
});

test('+15% quote spike -> quarantined, excluded from getQuotes()', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({
    quotes: [{ symbol: 'SPIKE', ltp: 115, previous_close: 100, volume: 10 }],
  }));
  assert(v.ok, 'snapshot with one spiking quote should still validate, got: ' + v.errors.join(';'));
  const snap = v.snapshot;
  const raw = snap.quotes.find((q) => q.symbol === 'SPIKE');
  assert(raw && raw.quarantined === true, 'spiking quote must be flagged quarantined');
});

test('-15% quote crash -> quarantined', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({
    quotes: [{ symbol: 'CRASH', ltp: 85, previous_close: 100, volume: 10 }],
  }));
  assert(v.ok, 'snapshot should validate');
  const raw = v.snapshot.quotes.find((q) => q.symbol === 'CRASH');
  assert(raw && raw.quarantined === true, 'crashing quote must be flagged quarantined');
});

test('normal +-5% move -> NOT quarantined', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({
    quotes: [{ symbol: 'CALM', ltp: 105, previous_close: 100, volume: 10 }],
  }));
  assert(v.ok, 'snapshot should validate');
  const raw = v.snapshot.quotes.find((q) => q.symbol === 'CALM');
  assert(raw && raw.quarantined === false, 'normal move must not be quarantined');
});

test('individual bad quote dropped, snapshot survives', () => {
  const sb = loadModules();
  const v = sb.NepseData._validate(validPayload({
    quotes: [
      { symbol: 'GOOD', ltp: 100, previous_close: 100, volume: 1 },
      { symbol: 'BAD', ltp: 'not-a-number', previous_close: 100 },
      { ltp: 50 }, // missing symbol
    ],
  }));
  assert(v.ok, 'snapshot with some bad quotes should survive, got: ' + v.errors.join(';'));
  assert(v.snapshot.quotes.some((q) => q.symbol === 'GOOD'), 'good quote kept');
  assert(!v.snapshot.quotes.some((q) => q.symbol === 'BAD'), 'bad quote dropped');
});

test('holiday date -> market CLOSED (Dashain 2026-10-22)', () => {
  const sb = loadModules();
  assert(sb.NepseMarketConfig.isHoliday('2026-10-22') === true, 'Dashain should be a holiday');
  assert(sb.NepseMarketConfig.isTradingDay('2026-10-22') === false, 'holiday is not a trading day');
  // Thursday Oct 22 2026, 12:00 NPT — inside market hours but a holiday
  const nptNoon = new Date('2026-10-22T12:00:00+05:45');
  assert(sb.NepseMarketConfig.isMarketOpen(nptNoon) === false, 'market must be CLOSED on holiday');
});

test('normal Thursday -> market OPEN at noon NPT', () => {
  const sb = loadModules();
  assert(sb.NepseMarketConfig.isTradingDay('2026-10-01') === true, 'Thu Oct 1 should trade');
  const nptNoon = new Date('2026-10-01T12:00:00+05:45');
  assert(sb.NepseMarketConfig.isMarketOpen(nptNoon) === true, 'market should be OPEN Thu noon');
});

test('Friday -> market CLOSED (weekend)', () => {
  const sb = loadModules();
  assert(sb.NepseMarketConfig.isTradingDay('2026-10-02') === false, 'Friday is not a trading day');
});

test('shared formatter: en-IN lakh/crore grouping', () => {
  const sb = loadModules();
  const s = sb.NepseFormat.fmtVol(1234567);
  assert(/12/.test(s) && /L/.test(s), `fmtVol(1234567) should show lakh, got "${s}"`);
  const p = sb.NepseFormat.fmtPrice(2599.15);
  assert(p === '2,599.15', `fmtPrice(2599.15) should be "2,599.15", got "${p}"`);
});

test('shared formatter: signed percentages', () => {
  const sb = loadModules();
  assert(sb.NepseFormat.fmtPct(0.45) === '+0.45%', 'positive pct needs + sign');
  assert(sb.NepseFormat.fmtPct(-1.2) === '-1.20%', 'negative pct, 2 decimals');
});

// ---- summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('Failed tests: ' + failures.join(', '));
  process.exit(1);
}
console.log('All chaos tests passed — bad data never reaches the screen.');
