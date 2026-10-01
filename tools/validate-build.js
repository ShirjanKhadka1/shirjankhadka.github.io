#!/usr/bin/env node
// validate-build.js — S3 data integrity gate
//
// Verifies every file listed in nepse-chart/data/manifest.json against its
// recorded SHA-256. Any mismatch (tampered, truncated, or half-written file)
// fails the build with a non-zero exit BEFORE deploy.
//
// Usage: node tools/validate-build.js
// Run AFTER build-manifest.js, BEFORE commit/deploy.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'nepse-chart/data/manifest.json');

if (!fs.existsSync(MANIFEST)) {
  console.error('FAIL: manifest.json missing — run tools/build-manifest.js first');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const failures = [];
let checked = 0;

for (const [rel, meta] of Object.entries(manifest.files)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: MISSING`);
    continue;
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  checked++;
  if (hash !== meta.sha256) failures.push(`${rel}: HASH MISMATCH`);
}

// Fail on unexpected extra files too (something the builders didn't produce)
const known = new Set(Object.keys(manifest.files));
known.add('nepse-chart/data/manifest.json');
for (const d of ['nepse-chart/data', 'nepse-brokers/data']) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(ROOT, p).replace(/\\/g, '/');
        if (!known.has(rel)) failures.push(`${rel}: UNLISTED FILE`);
      }
    }
  };
  walk(abs);
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} integrity problem(s) in ${checked} files:`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`OK: ${checked} files verified against manifest.json`);
