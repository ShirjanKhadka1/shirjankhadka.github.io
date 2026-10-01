#!/usr/bin/env node
// backup-data.js — S3 backup: keep last 30 daily data builds in a private repo.
//
// Creates a dated tarball of the published data directories and pushes it to
// the PRIVATE backup repo (never the public site repo). Keeps 30 days,
// prunes older. Test restore with: node tools/backup-data.js --restore <date>
//
// Usage:
//   node tools/backup-data.js            # backup today's build
//   node tools/backup-data.js --restore 2026-10-01   # restore to ./restore-<date>/
//   node tools/backup-data.js --list     # list available backups

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUP_REPO = 'ShirjanKhadka1/shirjankhadka-data-backups'; // PRIVATE
const KEEP = 30;

// Auth: token via GH_BACKUP_TOKEN env (local .env, git-ignored) or --token flag.
// In CI, the workflow passes ${{ secrets.GITHUB_TOKEN }}. The token is sent
// via http.extraHeader so it NEVER appears in the remote URL (and can't leak
// into git error output).
function argvToken() {
  const i = process.argv.indexOf('--token');
  return i > -1 ? process.argv[i + 1] : null;
}
function gitEnv() {
  const t = process.env.GH_BACKUP_TOKEN || argvToken();
  if (!t) {
    console.error('GH_BACKUP_TOKEN not set (add to .env; see .env.example)');
    process.exit(1);
  }
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${t}`,
  };
}
const authedUrl = () => `https://github.com/${BACKUP_REPO}.git`;

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', ...opts }).trim();
}

function backup() {
  process.chdir(ROOT);
  const date = new Date().toISOString().slice(0, 10);
  const work = path.join(ROOT, '.backup-work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  // Clone (or pull) the private backup repo
  if (!fs.existsSync(path.join(work, '.git'))) {
    sh(`git clone --depth 1 ${authedUrl()} "${work}"`, { env: gitEnv() });
  }
  const tag = `data-${date}`;
  const tarball = path.join(work, `${tag}.tar.gz`);
  sh(`tar --no-same-owner -czf "${tarball}" nepse-chart/data nepse-brokers/data`);
  const size = (fs.statSync(tarball).size / 1024 / 1024).toFixed(1);
  process.chdir(work);
  sh('git config user.name "github-actions[bot]"', { env: gitEnv() });
  sh('git config user.email "github-actions[bot]@users.noreply.github.com"', { env: gitEnv() });
  sh('git add .', { env: gitEnv() });
  // Prune: keep newest KEEP tarballs
  const balls = sh('ls -1 data-*.tar.gz 2>/dev/null || true').split('\n').filter(Boolean).sort();
  for (const old of balls.slice(0, Math.max(0, balls.length - KEEP))) {
    fs.unlinkSync(path.join(work, old));
    sh(`git rm -q "${old}"`, { env: gitEnv() });
  }
  sh(`git commit -qm "data backup ${date} (${size} MB)" || true`, { env: gitEnv() });
  sh('git push -q origin main', { env: gitEnv() });
  console.log(`backup ${tag} pushed (${size} MB)`);
  fs.rmSync(work, { recursive: true, force: true });
}

function list() {
  process.chdir(ROOT);
  const work = path.join(ROOT, '.backup-work');
  fs.rmSync(work, { recursive: true, force: true });
  sh(`git clone --depth 1 --quiet ${authedUrl()} "${work}"`, { env: gitEnv() });
  const balls = sh(`ls -1 "${work}"/data-*.tar.gz 2>/dev/null || true`).split('\n').filter(Boolean);
  console.log(balls.map((b) => path.basename(b)).join('\n') || '(none)');
  fs.rmSync(work, { recursive: true, force: true });
}

function restore(date) {
  process.chdir(ROOT);
  const work = path.join(ROOT, '.backup-work');
  const dest = path.join(ROOT, `restore-${date}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
  sh(`git clone --depth 1 --quiet ${authedUrl()} "${work}"`, { env: gitEnv() });
  const tarball = path.join(work, `data-${date}.tar.gz`);
  if (!fs.existsSync(tarball)) {
    console.error(`no backup for ${date}`);
    process.exit(1);
  }
  fs.mkdirSync(dest, { recursive: true });
  sh(`tar --no-same-owner -xzf "${tarball}" -C "${dest}"`);
  console.log(`restored ${date} to ${dest}/`);
  fs.rmSync(work, { recursive: true, force: true });
}

const arg = process.argv[2];
if (arg === '--list') list();
else if (arg === '--restore') restore(process.argv[3]);
else backup();
