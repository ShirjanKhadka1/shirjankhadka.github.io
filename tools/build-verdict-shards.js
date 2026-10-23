#!/usr/bin/env node
/**
 * build-verdict-shards.js — split data/verdicts-v2.json into per-letter
 * detail shards under data/verdicts-v2.d/<L>.json.
 *
 * Why: nepse-verdicts-v2/verdicts-v2.js used to download the FULL detail
 * file (~2.8 MB raw / ~241 KB gz, all 386 verdicts) the first time a
 * visitor expanded any single row. With shards, expanding a row fetches
 * only the shard for that symbol's first letter (typically 5–40 KB gz),
 * and further expansions in the same letter are served from memory.
 *
 * Shard format (exact slices of the source file — no value is recomputed,
 * rounded or dropped):
 *   { "session_date": <copied>, "asof": <copied>,
 *     "verdicts": { "<SYM>": <the exact entry object from verdicts-v2.json> } }
 * The envelope lets the page detect a stale shard (session mismatch vs the
 * summary it already loaded) and fall back to the full file.
 *
 * PIPELINE STEP (for the verdict pipeline owner): run this AFTER the
 * verdict build regenerates data/verdicts-v2.json, in the same job:
 *     node tools/build-verdict-shards.js
 * If shards lag a session the page stays correct: a missing shard (404)
 * or a session-mismatched shard makes the loader fall back to fetching
 * /data/verdicts-v2.json exactly as before.
 *
 * Verification is built in and runs on every build: after writing, the
 * shards are re-read and every entry is compared against the source with
 * a canonical (key-sorted) serialization — the build FAILS unless the
 * union of shard keys is exactly the source's verdict set, no symbol
 * appears in two shards, and every entry is value-identical.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'verdicts-v2.json');
const OUT_DIR = path.join(ROOT, 'data', 'verdicts-v2.d');

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

function main() {
  const full = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const verdicts = full.verdicts || {};
  const symbols = Object.keys(verdicts);
  if (!symbols.length) throw new Error('source has no verdicts — refusing to shard');

  const byLetter = {};
  for (const sym of symbols) {
    const L = sym.charAt(0).toUpperCase();
    if (!/^[A-Z0-9]$/.test(L)) throw new Error('unshardable symbol: ' + sym);
    (byLetter[L] = byLetter[L] || {})[sym] = verdicts[sym];
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Remove shards for letters no longer present so stale files never linger.
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.json') && !byLetter[f.replace(/\.json$/, '')]) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      console.log('removed stale shard ' + f);
    }
  }

  let totalRaw = 0, totalGz = 0;
  for (const L of Object.keys(byLetter).sort()) {
    const shard = {
      session_date: full.session_date || null,
      asof: full.asof || null,
      verdicts: byLetter[L],
    };
    const text = JSON.stringify(shard);
    fs.writeFileSync(path.join(OUT_DIR, L + '.json'), text);
    const gz = zlib.gzipSync(text).length;
    totalRaw += text.length; totalGz += gz;
    console.log('shard ' + L + '.json: ' + Object.keys(byLetter[L]).length +
      ' symbols, ' + text.length + ' B raw, ' + gz + ' B gz');
  }

  /* ---- verification: shards must reconstruct the source exactly ---- */
  const seen = {};
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.json')) continue;
    const shard = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    if (shard.session_date !== (full.session_date || null)) {
      throw new Error(f + ': session_date envelope mismatch');
    }
    for (const sym of Object.keys(shard.verdicts || {})) {
      if (seen[sym]) throw new Error(sym + ' appears in two shards');
      seen[sym] = f;
      if (canonical(shard.verdicts[sym]) !== canonical(verdicts[sym])) {
        throw new Error(sym + ': shard entry differs from source (value equality failed)');
      }
    }
  }
  const missing = symbols.filter((s) => !seen[s]);
  if (missing.length) throw new Error('symbols missing from shards: ' + missing.join(','));
  if (Object.keys(seen).length !== symbols.length) {
    throw new Error('shard symbol count != source symbol count');
  }

  const srcRaw = fs.statSync(SRC).size;
  const srcGz = zlib.gzipSync(fs.readFileSync(SRC)).length;
  console.log('OK: ' + symbols.length + ' verdicts in ' + Object.keys(byLetter).length +
    ' shards; every entry value-identical to source.');
  console.log('Full file: ' + srcRaw + ' B raw / ' + srcGz + ' B gz. ' +
    'All shards together: ' + totalRaw + ' B raw / ' + totalGz + ' B gz ' +
    '(a row expansion now fetches ONE shard instead of the full file).');
}

main();
