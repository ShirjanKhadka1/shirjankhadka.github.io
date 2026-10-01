#!/usr/bin/env node
// build-manifest.js — S3 data integrity
//
// Walks the published data directories, computes SHA-256 for every file,
// and writes nepse-chart/data/manifest.json. The manifest lets validate-build
// (and anyone else) verify that deployed data matches what the builders
// produced — any tampered or half-written file fails the check.
//
// Usage: node tools/build-manifest.js
// Run AFTER all data builders, BEFORE commit/deploy.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIRS = [
  'nepse-chart/data',
  'nepse-brokers/data',
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name !== 'manifest.json') out.push(p);
  }
  return out;
}

const files = {};
for (const d of DATA_DIRS) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  for (const f of walk(abs)) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    files[rel] = { sha256: hash, bytes: fs.statSync(f).size };
  }
}

const manifest = {
  generated: new Date().toISOString(),
  generator: 'tools/build-manifest.js',
  files,
};

const outPath = path.join(ROOT, 'nepse-chart/data/manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(`manifest.json: ${Object.keys(files).length} files hashed`);
