#!/usr/bin/env node
/* Nepse Decode — company website monitor.
 *
 * Checks listed companies' official websites for new announcements,
 * press releases, and financial documents. Only financial/share-market
 * related updates become news items.
 *
 * This supplements the RSS news feeds with company-primary-source updates.
 * Many Nepali companies publish notices as PDFs without a structured news
 * section; we monitor for new documents and surface them.
 *
 * Usage: node tools/company-website-monitor.js [--symbols HATHY,NABIL]
 * Output: merges into nepse-chart/data/news.json with src="Company website"
 *
 * Node 18+, no npm dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'nepse-chart', 'data', 'company-websites.json');
const NEWS = path.join(ROOT, 'nepse-chart', 'data', 'news.json');
const STATE = path.join(ROOT, 'nepse-chart', 'data', 'company-website-state.json');

const UA = { 'User-Agent': 'Mozilla/5.0 (NepseDecode company monitor)' };

// Financial/share-market keywords that qualify a document as news-worthy.
const FIN_KW = [
  'dividend', 'bonus', 'right share', 'agm', 'annual general meeting',
  'quarterly', 'financial', 'profit', 'loss', 'merger', 'acquisition',
  'intention to sell', 'promoter', 'auction', 'book closure', 'bookclose',
  'share', 'nepse', 'capital', 'investment',
  // Nepali
  'लाभांश', 'बोनस', 'हकप्रद', 'साधारण सभा', 'नाफा', 'घाटा', 'सेयर',
];

function fetch(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: UA, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).href, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Extract PDF links from HTML.
function extractPdfs(html, baseUrl) {
  const pdfs = [];
  const re = /href=["']([^"']+\.pdf[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1], baseUrl).href;
      // Get filename for keyword matching
      const fname = url.split('/').pop().toLowerCase();
      pdfs.push({ url, fname });
    } catch { /* skip invalid URLs */ }
  }
  return pdfs;
}

// Check if a PDF filename/content indicates financial relevance.
function isFinancial(fname) {
  const lower = fname.toLowerCase();
  return FIN_KW.some(kw => lower.includes(kw.toLowerCase()));
}

async function checkCompany(sym, info, state) {
  const results = [];
  const seen = state[sym] || { pdfs: [] };
  
  for (const checkPath of (info.check_paths || ['/'])) {
    const url = info.website.replace(/\/$/, '') + checkPath;
    try {
      const html = await fetch(url);
      const pdfs = extractPdfs(html, url);
      
      for (const pdf of pdfs) {
        if (!seen.pdfs.includes(pdf.url) && isFinancial(pdf.fname)) {
          results.push({
            sym,
            title: `${info.name} published: ${pdf.fname.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ')}`,
            link: pdf.url,
            src: 'Company website',
            date: new Date().toISOString().slice(0, 10),
          });
          seen.pdfs.push(pdf.url);
        }
      }
    } catch (e) {
      console.log(`  ${sym} ${checkPath}: ${e.message}`);
    }
    // Be polite: small delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  state[sym] = seen;
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let filterSyms = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbols' && args[i+1]) {
      filterSyms = args[i+1].split(',').map(s => s.trim().toUpperCase());
    }
  }

  if (!fs.existsSync(DB)) {
    console.log('No company websites database found.');
    return;
  }
  
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  
  let companies = Object.entries(db.companies || {});
  if (filterSyms) {
    companies = companies.filter(([sym]) => filterSyms.includes(sym));
  }
  
  console.log(`> Company website monitor`);
  console.log(`  checking ${companies.length} companies`);
  
  const allResults = [];
  for (const [sym, info] of companies) {
    console.log(`  ${sym} (${info.website})...`);
    const results = await checkCompany(sym, info, state);
    allResults.push(...results);
    if (results.length > 0) {
      console.log(`    found ${results.length} new documents`);
    }
  }
  
  // Save state
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  
  // Merge into news.json
  if (allResults.length > 0 && fs.existsSync(NEWS)) {
    const news = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
    const existing = new Set((news.items || []).map(it => it.link));
    const fresh = allResults.filter(r => !existing.has(r.link));
    news.items = [...fresh, ...(news.items || [])].slice(0, 500);
    fs.writeFileSync(NEWS, JSON.stringify(news, null, 2));
    console.log(`> added ${fresh.length} new items to news.json`);
  } else {
    console.log(`> no new documents found`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
