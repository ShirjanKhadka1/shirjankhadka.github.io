#!/usr/bin/env node
/**
 * tools/check-freshness.js — dead-man's-switch freshness check.
 *
 * Fetches the LIVE site's manifest (/data/manifest.json, falling back to the
 * legacy /nepse-chart/data/manifest.json during the one-release transition)
 * and fails if the market data is more than --max-behind trading days behind
 * the expected session. Runs on a schedule INDEPENDENT of the data pipelines,
 * so it catches the case where a pipeline silently never ran.
 *
 * Usage: node tools/check-freshness.js [--url https://shirjankhadka.com.np] [--max-behind 1]
 * Exit 0 = fresh, exit 1 = STALE (callers send the email alert).
 * Writes a GitHub Actions step summary when GITHUB_STEP_SUMMARY is set.
 */
'use strict';
const td = require('./trading-days');

const args = process.argv.slice(2);
const url = (args.find(a => a.startsWith('--url=')) || '').split('=')[1] || 'https://shirjankhadka.com.np';
const maxBehind = parseInt((args.find(a => a.startsWith('--max-behind=')) || '').split('=')[1] || '1', 10);

function getJSON(u) {
  return new Promise((resolve, reject) => {
    const lib = u.startsWith('https') ? require('https') : require('http');
    const req = lib.get(u, { headers: { 'User-Agent': 'nepse-freshness-watch/1.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + u)); }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(new Error('timeout')); });
  });
}

function summary(lines) {
  const s = process.env.GITHUB_STEP_SUMMARY;
  if (s) require('fs').appendFileSync(s, lines.join('\n') + '\n');
}

async function main() {
  const now = new Date();
  const expected = td.expectedSessionDate(now);
  const todayNPT = td.todayNPT(now);

  let manifest = null, usedUrl = null, lastErr = null;
  for (const p of ['/data/manifest.json', '/nepse-chart/data/manifest.json']) {
    try {
      manifest = await getJSON(url.replace(/\/$/, '') + p);
      usedUrl = p;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!manifest) {
    const msg = `FRESHNESS CHECK FAILED: could not fetch manifest from ${url} (${lastErr && lastErr.message})`;
    console.error(msg);
    summary(['## Freshness watch: ERROR', '', msg]);
    process.exit(1);
  }

  const session = manifest.session_date;
  if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(session)) {
    const msg = `FRESHNESS CHECK FAILED: manifest at ${usedUrl} has no valid session_date`;
    console.error(msg);
    summary(['## Freshness watch: ERROR', '', msg]);
    process.exit(1);
  }

  // Count trading days the live data is behind the expected session.
  let d = session, behind = 0;
  while (d < expected && behind < 30) {
    d = td.nextTradingDay(d);
    if (d <= expected) behind++;
  }

  const stale = behind > maxBehind;
  const line = `live session=${session} expected=${expected} behind=${behind} trading day(s) (via ${usedUrl}, checked ${todayNPT} NPT)`;
  console.log(line);
  summary([
    '## Freshness watch',
    '',
    `- Site: ${url}`,
    `- Live session date: \`${session}\``,
    `- Expected session: \`${expected}\``,
    `- Trading days behind: **${behind}** (alert threshold: > ${maxBehind})`,
    `- Market state: ${manifest.market_state || 'unknown'}`,
    `- Verdict: ${stale ? '**STALE — alert sent**' : 'fresh'}`,
  ]);

  if (stale) {
    console.error(`STALE: market data is ${behind} trading days behind (threshold ${maxBehind})`);
    process.exit(1);
  }
  console.log('OK: market data is fresh');
}

main().catch(e => { console.error('check-freshness error:', e.message); process.exit(1); });
