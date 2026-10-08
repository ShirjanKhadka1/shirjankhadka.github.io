/* Nepse Decode — Daily broker data verification template.
 *
 * Compares NEPSE floorsheet totals against Capital Max for verification.
 * 
 * NEPSE is the PRIMARY source (automated via fetch-intraday-floorsheet.js).
 * Capital Max is the VERIFICATION source (checked daily, browser-based).
 *
 * Usage:
 * 1. After market close, run: node tools/verify-broker-vs-capitalmax.js
 * 2. It outputs NEPSE totals from the daily broker file
 * 3. Manually check Capital Max (login.capitalmax.com.np → Market → Historical Data)
 *    for the same date and compare totals
 * 4. If mismatch > 1%, investigate before publishing
 *
 * This is a verification aid, not an automated check — Capital Max has no API,
 * so the comparison requires browser access or manual verification.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'nepse-brokers', 'data');

function main() {
  const today = new Date().toISOString().split('T')[0];
  
  // Find latest daily file
  const dailyDir = path.join(DATA, 'daily');
  if (!fs.existsSync(dailyDir)) {
    console.log('No daily broker data found');
    process.exit(1);
  }
  
  const files = fs.readdirSync(dailyDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  
  if (files.length === 0) {
    console.log('No daily files');
    process.exit(1);
  }
  
  const latest = files[files.length - 1];
  const date = latest.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(dailyDir, latest), 'utf8'));
  
  console.log('=== NEPSE Floorsheet Verification ===');
  console.log(`Date: ${date}`);
  console.log('');
  console.log('NEPSE totals (from floorsheet):');
  
  let totalBuy = 0, totalSell = 0;
  const brokers = data.brokers || {};
  for (const [code, b] of Object.entries(brokers)) {
    totalBuy += b.buy_value || 0;
    totalSell += b.sell_value || 0;
  }
  
  // Total turnover is buy+sell / 2 (each trade counted twice)
  const turnover = (totalBuy + totalSell) / 2;
  console.log(`  Total turnover: Rs ${(turnover / 1e7).toFixed(2)} Cr`);
  console.log(`  Brokers: ${Object.keys(brokers).length}`);
  console.log('');
  console.log('TO VERIFY in Capital Max:');
  console.log('  1. Go to login.capitalmax.com.np → Market → Historical Data');
  console.log(`  2. Select date: ${date}`);
  console.log('  3. Compare total turnover and broker figures');
  console.log('  4. If mismatch > 1%, investigate NEPSE data source');
  console.log('');
  console.log('Top 5 brokers by total:');
  const sorted = Object.entries(brokers)
    .map(([code, b]) => ({code, total: (b.buy_value || 0) + (b.sell_value || 0)}))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  sorted.forEach((b, i) => {
    console.log(`  ${i+1}. Broker ${b.code}: Rs ${(b.total / 1e7).toFixed(2)} Cr`);
  });
}

main();
