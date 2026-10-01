#!/usr/bin/env node
/**
 * tools/rollback-data.js — restore data files from a last-known-good tag.
 *
 * Usage: node tools/rollback-data.js <tag>   (tag must match data-YYYY-MM-DD-N)
 *
 * Restores nepse-chart/data from the tag, then regenerates both manifests
 * with SESSION_OVERRIDE pinned to the tag's session date (so the manifest
 * honestly describes the restored session, not "today").
 * Does NOT commit — the caller commits and pushes.
 * Exits non-zero on any error (rollback must never silently half-apply).
 */
'use strict';
const child_process = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TAG_RE = /^data-(\d{4}-\d{2}-\d{2})-\d+$/;

function sh(cmd, env) {
  return child_process.execSync(cmd, {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'],
    env: Object.assign({}, process.env, env || {}),
  });
}

function main() {
  const tag = process.argv[2];
  if (!tag || !TAG_RE.test(tag)) {
    console.error(`rollback-data: invalid tag "${tag}" (expected data-YYYY-MM-DD-N)`);
    process.exit(1);
  }
  const session = tag.match(TAG_RE)[1];
  // tag must exist locally (workflows fetch full history)
  try {
    sh(`git rev-parse --verify --quiet "${tag}^{commit}"`);
  } catch (e) {
    console.error(`rollback-data: tag ${tag} does not exist`);
    process.exit(1);
  }
  console.log(`rolling back data files to ${tag} (session ${session})`);
  sh(`git checkout "${tag}" -- nepse-chart/data`);
  sh('node tools/build-manifest.js', { SESSION_OVERRIDE: session, BUILD_COMMIT: process.env.BUILD_COMMIT || '' });
  console.log(`rollback complete: nepse-chart/data restored from ${tag}, manifests regenerated for session ${session}`);
}

main();
