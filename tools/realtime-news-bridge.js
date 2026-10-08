#!/usr/bin/env node
/* Nepse Decode — real-time news bridge.
 *
 * Called when breaking news is verified (official notice in hand).
 * Prepends the item to news.json in the CLEAN deploy worktree
 * (~/workspace/wt-news, detached at origin/main) and pushes just that
 * file to the live site. Never touches the feature-branch working tree:
 * committing there would drag the whole branch onto main.
 *
 * Usage: node tools/realtime-news-bridge.js '<json>'
 * JSON: { sym, title, link, src, date }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WT = '/home/hatch/workspace/wt-news';
const NEWS = path.join(WT, 'nepse-chart', 'data', 'news.json');
const PUSH = '/home/hatch/workspace/skills/github/bin/github-push.py';
const REPO = 'ShirjanKhadka1/shirjankhadka.github.io';

function sh(cmd) {
  return execSync(cmd, { cwd: WT, timeout: 120000, encoding: 'utf8' });
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: realtime-news-bridge.js '<json>'");
    process.exit(1);
  }
  const item = JSON.parse(arg);
  if (!item.sym || !item.title || !item.link) {
    console.error('Missing required fields: sym, title, link');
    process.exit(1);
  }

  // Clean slate on main — never carry worktree state.
  sh('git fetch origin main --quiet && git reset --hard origin/main --quiet');

  const news = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
  const existing = new Set((news.items || []).map((it) => it.link));
  if (existing.has(item.link)) {
    console.log('Already in news.json, skipping');
    return;
  }
  news.items = [{
    sym: item.sym,
    title: item.title,
    link: item.link,
    src: item.src || 'NEPSE disclosure',
    date: item.date || new Date().toISOString().slice(0, 10),
  }, ...(news.items || [])].slice(0, 500);
  news.asof = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(NEWS, JSON.stringify(news, null, 1));

  sh('git add nepse-chart/data/news.json');
  const dirty = sh('git status --porcelain').trim();
  if (!dirty) { console.log('Nothing to deploy'); return; }
  sh(`git -c user.name="nepse-decode" -c user.email="newsroom@shirjankhadka.com.np" commit -m "Real-time: ${item.sym} breaking news" --quiet`);
  const head = sh('git rev-parse HEAD').trim();
  const out = sh(`python3 ${PUSH} --repo ${REPO} --repo-dir ${WT} --branch main --base main --local-ref ${head} 2>&1 | tail -3`);
  console.log('Deployed to live site:', out.trim().split('\n').pop());
}

main();
