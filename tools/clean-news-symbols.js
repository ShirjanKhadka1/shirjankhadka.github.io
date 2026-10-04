
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'nepse-chart', 'data', 'news.json');
const d = JSON.parse(fs.readFileSync(OUT, 'utf8'));

// Symbols that were wrongly assigned to generic news - clear them
// These will show the neutral icon instead of wrong company logos
const CLEAR = {
  'JHAPA': ['elephant', 'wild', 'jhapa district'],
  'SYPNL': ['panel', 'subcommittee', 'police uniform'],
  'MANDU': ['kathmandu', 'transport', 'urban'],
  'STC': [], // Salt Trading Corp on general market news
};

let cleared = 0;
for (const item of d.items) {
  const sym = item.sym;
  const title = (item.title || '').toLowerCase();
  if (CLEAR[sym]) {
    const keywords = CLEAR[sym];
    // If no keywords specified, or title matches generic patterns, clear it
    if (keywords.length === 0 || keywords.some(k => title.includes(k))) {
      // But keep it if it's actually about the company
      const companyWords = {
        'JHAPA': ['energy', 'hydropower', 'power'],
        'SYPNL': ['sy panel', 'solar'],
        'MANDU': ['mandu hydropower', 'hydro'],
        'STC': ['salt trading', 'salt'],
      };
      const isCompany = (companyWords[sym] || []).some(w => title.includes(w));
      if (!isCompany) {
        item.sym = null;
        cleared++;
      }
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(d, null, 1));
console.log(`Cleared ${cleared} wrong symbols`);
