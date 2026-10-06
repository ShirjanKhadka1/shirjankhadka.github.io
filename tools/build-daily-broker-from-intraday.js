/* Nepse Decode — post-close daily broker aggregation.
 *
 * Runs AFTER market close. Reads nepse-brokers/data/intraday.json (written by
 * the intraday fetcher during market hours), saves it as the daily file, and
 * rebuilds all period aggregates.
 *
 * Writes:
 *   nepse-brokers/data/daily/YYYY-MM-DD.json
 *   nepse-brokers/data/periods/{1D,2D,1W,2W,1M,3M,6M,1Y,2Y,3Y}.json
 *   nepse-brokers/data/meta.json
 *
 * FAILS LOUDLY on errors (exit 1). Silent failures hide broken pipelines.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DATA = path.join(REPO, 'nepse-brokers', 'data');
const INTRADAY = path.join(DATA, 'intraday.json');

const PERIODS = { '1D': 1, '2D': 2, '1W': 7, '2W': 14, '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '2Y': 730, '3Y': 1095 };

function log(...args) {
  console.log('[daily-broker]', ...args);
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

function main() {
  // 1. Read intraday.json
  if (!fs.existsSync(INTRADAY)) {
    log('FATAL: intraday.json not found at', INTRADAY);
    log('The intraday fetcher did not produce data today. Check its logs.');
    process.exit(1);
  }

  const intraday = JSON.parse(fs.readFileSync(INTRADAY, 'utf8'));
  const date = intraday.date;
  if (!date) {
    log('FATAL: intraday.json has no date field');
    process.exit(1);
  }

  log('Processing date:', date);
  log('Brokers:', Object.keys(intraday.brokers || {}).length);
  log('Symbols:', Object.keys(intraday.symbols || {}).length);

  if (!intraday.brokers || Object.keys(intraday.brokers).length === 0) {
    log('FATAL: intraday.json has no broker data');
    process.exit(1);
  }

  // 2. Write daily file
  const dailyDir = path.join(DATA, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });

  const dailyFile = path.join(dailyDir, date + '.json');
  const daily = {
    date: date,
    asof: intraday.asof,
    brokers: intraday.brokers,
    symbols: intraday.symbols,
    rows: intraday.rows,
    pages: intraday.pages,
  };
  fs.writeFileSync(dailyFile, JSON.stringify(daily));
  log('Wrote', dailyFile);

  // 3. Get all daily files sorted
  const dailyFiles = fs.readdirSync(dailyDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();

  log('Total trading days on record:', dailyFiles.length);

  // 4. Rebuild each period
  const periodsDir = path.join(DATA, 'periods');
  fs.mkdirSync(periodsDir, { recursive: true });

  for (const [period, days] of Object.entries(PERIODS)) {
    const windowDates = dailyFiles.slice(-days);
    if (windowDates.length === 0) continue;

    const brokers = {};  // code -> {buy_value, sell_value, buy_qty, sell_qty, total, net}

    for (const d of windowDates) {
      const df = JSON.parse(fs.readFileSync(path.join(dailyDir, d + '.json'), 'utf8'));
      for (const [code, b] of Object.entries(df.brokers || {})) {
        if (!brokers[code]) {
          brokers[code] = { buy_value: 0, sell_value: 0, buy_qty: 0, sell_qty: 0 };
        }
        brokers[code].buy_value += b.buy_value || 0;
        brokers[code].sell_value += b.sell_value || 0;
        brokers[code].buy_qty += b.buy_qty || 0;
        brokers[code].sell_qty += b.sell_qty || 0;
      }
    }

    // Compute totals and net
    const brokerList = Object.entries(brokers).map(([code, b]) => ({
      code,
      buy_value: r2(b.buy_value),
      sell_value: r2(b.sell_value),
      buy_qty: r2(b.buy_qty),
      sell_qty: r2(b.sell_qty),
      total: r2(b.buy_value + b.sell_value),
      net: r2(b.buy_value - b.sell_value),
    })).sort((a, b) => b.total - a.total);

    const out = {
      period,
      from: windowDates[0],
      to: windowDates[windowDates.length - 1],
      trading_days: windowDates.length,
      brokers: brokerList,
    };

    fs.writeFileSync(path.join(periodsDir, period + '.json'), JSON.stringify(out));
    log(`Wrote ${period}.json (${windowDates.length} days, ${brokerList.length} brokers)`);
  }

  // 5. Update meta.json
  const meta = {
    earliest: dailyFiles[0],
    latest: dailyFiles[dailyFiles.length - 1],
    trading_days: dailyFiles.length,
    periods: Object.keys(PERIODS),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2));
  log('Updated meta.json');

  log('DONE');
}

try {
  main();
} catch (e) {
  log('FATAL:', e.message);
  log(e.stack);
  process.exit(1);
}
