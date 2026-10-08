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
    const symbols = {};  // sym -> {qty, value, buyers: {code: [qty, value]}, sellers: {code: [qty, value]}}
    const brokerSymbols = {};  // broker code -> {sym -> {buy_qty, buy_value, sell_qty, sell_value}}

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
      // Aggregate symbols (stock-wise)
      for (const [sym, s] of Object.entries(df.symbols || {})) {
        if (!symbols[sym]) {
          symbols[sym] = { qty: 0, value: 0, buyers: {}, sellers: {} };
        }
        symbols[sym].qty += s.qty || 0;
        symbols[sym].value += s.value || 0;
        for (const [bcode, bv] of Object.entries(s.buyers || {})) {
          if (!symbols[sym].buyers[bcode]) symbols[sym].buyers[bcode] = [0, 0];
          symbols[sym].buyers[bcode][0] += bv[0] || 0;
          symbols[sym].buyers[bcode][1] += bv[1] || 0;
          // Track per-broker symbols
          if (!brokerSymbols[bcode]) brokerSymbols[bcode] = {};
          if (!brokerSymbols[bcode][sym]) brokerSymbols[bcode][sym] = {buy_qty: 0, buy_value: 0, sell_qty: 0, sell_value: 0};
          brokerSymbols[bcode][sym].buy_qty += bv[0] || 0;
          brokerSymbols[bcode][sym].buy_value += bv[1] || 0;
        }
        for (const [scode, sv] of Object.entries(s.sellers || {})) {
          if (!symbols[sym].sellers[scode]) symbols[sym].sellers[scode] = [0, 0];
          symbols[sym].sellers[scode][0] += sv[0] || 0;
          symbols[sym].sellers[scode][1] += sv[1] || 0;
          if (!brokerSymbols[scode]) brokerSymbols[scode] = {};
          if (!brokerSymbols[scode][sym]) brokerSymbols[scode][sym] = {buy_qty: 0, buy_value: 0, sell_qty: 0, sell_value: 0};
          brokerSymbols[scode][sym].sell_qty += sv[0] || 0;
          brokerSymbols[scode][sym].sell_value += sv[1] || 0;
        }
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

    // Build symbol list with top buyers/sellers
    const symbolList = {};
    for (const [sym, s] of Object.entries(symbols)) {
      const buyers = Object.entries(s.buyers)
        .map(([c, v]) => [c, r2(v[0]), r2(v[1])])
        .sort((a, b) => b[2] - a[2])
        .slice(0, 25);
      const sellers = Object.entries(s.sellers)
        .map(([c, v]) => [c, r2(v[0]), r2(v[1])])
        .sort((a, b) => b[2] - a[2])
        .slice(0, 25);
      symbolList[sym] = {
        qty: r2(s.qty),
        value: r2(s.value),
        avg_rate: s.qty > 0 ? r2(s.value / s.qty) : 0,
        buyers: Object.fromEntries(buyers.map(([c, q, v]) => [c, [q, v]])),
        sellers: Object.fromEntries(sellers.map(([c, q, v]) => [c, [q, v]])),
      };
    }

    // Build accumulation/distribution (net flow per symbol-broker)
    const flows = [];
    for (const [sym, s] of Object.entries(symbols)) {
      const netByBroker = {};
      for (const [c, v] of Object.entries(s.buyers)) {
        netByBroker[c] = (netByBroker[c] || 0) + v[1];
      }
      for (const [c, v] of Object.entries(s.sellers)) {
        netByBroker[c] = (netByBroker[c] || 0) - v[1];
      }
      for (const [c, net] of Object.entries(netByBroker)) {
        if (Math.abs(net) > 0) {
          flows.push({symbol: sym, broker: c, net_value: r2(net)});
        }
      }
    }
    flows.sort((a, b) => b.net_value - a.net_value);
    const accumulation = flows.filter(f => f.net_value > 0).slice(0, 200);
    const distribution = flows.filter(f => f.net_value < 0).slice(0, 200);

    const out = {
      period,
      from: windowDates[0],
      to: windowDates[windowDates.length - 1],
      trading_days: windowDates.length,
      brokers: brokerList,
      symbols: symbolList,
      symbol_count: Object.keys(symbolList).length,
      broker_symbols: brokerSymbols,
      accumulation,
      distribution,
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
