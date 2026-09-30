#!/usr/bin/env node
/* Nepse Decode — real-time news bridge.
 *
 * Called by the dividend watcher when breaking news is confirmed.
 * Appends the news item to news.json immediately so the website
 * shows it in real-time, then triggers a quick deploy of news.json.
 *
 * Usage: node tools/realtime-news-bridge.js '<json>'
 * JSON: { sym, title, link, src, date }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NEWS = path.join(ROOT, 'nepse-chart', 'data', 'news.json');

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: realtime-news-bridge.js \'<json>\'');
    process.exit(1);
  }
  
  const item = JSON.parse(arg);
  if (!item.sym || !item.title || !item.link) {
    console.error('Missing required fields: sym, title, link');
    process.exit(1);
  }
  
  // Load current news
  const news = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
  const existing = new Set((news.items || []).map(it => it.link));
  
  if (existing.has(item.link)) {
    console.log('Already in news.json, skipping');
    return;
  }
  
  // Prepend (newest first)
  news.items = [{
    sym: item.sym,
    title: item.title,
    link: item.link,
    src: item.src || 'NEPSE disclosure',
    date: item.date || new Date().toISOString().slice(0, 10),
  }, ...(news.items || [])].slice(0, 500);
  
  fs.writeFileSync(NEWS, JSON.stringify(news, null, 2));
  console.log(`Added to news.json: ${item.sym} - ${item.title.slice(0, 50)}...`);
  
  // Quick deploy just the news.json file
  try {
    execSync(
      `cd ${ROOT} && git add nepse-chart/data/news.json && ` +
      `git commit -m "Real-time: ${item.sym} breaking news" --quiet && ` +
      `python3 ~/workspace/skills/github/bin/github-push.py ` +
      `--repo ShirjanKhadka1/shirjankhadka.github.io --branch main --base main ` +
      `--local-ref $(git rev-parse HEAD) 2>&1 | tail -3`,
      { timeout: 120000 }
    );
    console.log('Deployed to live site');
  } catch (e) {
    console.error('Deploy failed:', e.message);
    // Don't fail the whole thing if deploy fails - news is saved locally
  }
}

main();
