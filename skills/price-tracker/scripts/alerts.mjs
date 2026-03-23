#!/usr/bin/env node
/**
 * Alerts — Price alert management and checking
 * Usage:
 *   node alerts.mjs set <asset> <above|below> <price> [--type=crypto|stock] [--currency=usd]
 *   node alerts.mjs list
 *   node alerts.mjs remove <id>
 *   node alerts.mjs clear
 *   node alerts.mjs check [--notify]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const ALERTS_FILE = join(DATA_DIR, 'alerts.json');
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Ensure data dir exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Load/save alerts
function loadAlerts() {
  if (!existsSync(ALERTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ALERTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

// Coin aliases
const aliases = {
  'btc': 'bitcoin', 'eth': 'ethereum', 'sol': 'solana', 'bnb': 'binancecoin',
  'xrp': 'ripple', 'ada': 'cardano', 'doge': 'dogecoin', 'avax': 'avalanche-2',
  'dot': 'polkadot', 'matic': 'matic-network', 'link': 'chainlink', 'uni': 'uniswap',
  'ltc': 'litecoin', 'atom': 'cosmos', 'near': 'near', 'arb': 'arbitrum',
  'op': 'optimism', 'sui': 'sui', 'pepe': 'pepe', 'shib': 'shiba-inu',
  'trx': 'tron', 'ton': 'the-open-network',
};

function resolveCoinId(input) {
  return aliases[input.toLowerCase()] || input.toLowerCase();
}

// Fetch current price
async function getPrice(asset, type, currency) {
  if (type === 'stock') {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset)}?interval=1d&range=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`Yahoo Finance error: ${resp.status}`);
    const data = await resp.json();
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(`No data for ${asset}`);
    return { price: meta.regularMarketPrice, name: meta.shortName || asset, currency: meta.currency };
  } else {
    const coinId = resolveCoinId(asset);
    const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=${currency}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw-PriceTracker/1.0' } });
    if (!resp.ok) throw new Error(`CoinGecko error: ${resp.status}`);
    const data = await resp.json();
    const price = data[coinId]?.[currency];
    if (!price) throw new Error(`No price for ${coinId} in ${currency}`);
    return { price, name: coinId, currency };
  }
}

// Generate unique ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Format
function formatPrice(num, curr = 'usd') {
  const symbols = { usd: '$', eur: '€', idr: 'Rp', gbp: '£', jpy: '¥', sgd: 'S$' };
  const sym = symbols[curr] || curr.toUpperCase() + ' ';
  if (num >= 1) return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${sym}${num.toFixed(6)}`;
}

// Commands
const args = process.argv.slice(2);
const command = args[0];

if (command === 'set') {
  const [, asset, direction, priceStr, ...rest] = args;
  
  if (!asset || !direction || !priceStr) {
    console.error('Usage: node alerts.mjs set <asset> <above|below> <price> [--type=crypto|stock] [--currency=usd]');
    process.exit(1);
  }
  
  const flags = {};
  for (const r of rest) {
    if (r.startsWith('--')) {
      const [k, v] = r.slice(2).split('=');
      flags[k] = v || true;
    }
  }
  
  if (!['above', 'below'].includes(direction)) {
    console.error('Direction must be "above" or "below"');
    process.exit(1);
  }
  
  const price = parseFloat(priceStr);
  if (isNaN(price) || price <= 0) {
    console.error('Price must be a positive number');
    process.exit(1);
  }
  
  const alerts = loadAlerts();
  const alert = {
    id: genId(),
    asset: asset.toLowerCase(),
    type: flags.type || 'crypto',
    direction,
    targetPrice: price,
    currency: (flags.currency || 'usd').toLowerCase(),
    triggered: false,
    createdAt: new Date().toISOString(),
  };
  
  alerts.push(alert);
  saveAlerts(alerts);
  
  console.log(`✅ Alert set: ${asset.toUpperCase()} ${direction} ${formatPrice(price, alert.currency)}`);
  console.log(`   ID: ${alert.id}`);

} else if (command === 'list') {
  const alerts = loadAlerts();
  const active = alerts.filter(a => !a.triggered);
  const triggered = alerts.filter(a => a.triggered);
  
  if (active.length === 0 && triggered.length === 0) {
    console.log('No alerts set. Use: node alerts.mjs set <asset> <above|below> <price>');
    return;
  }
  
  if (active.length > 0) {
    console.log('\n🔔 Active Alerts\n');
    for (const a of active) {
      const icon = a.direction === 'above' ? '⬆️' : '⬇️';
      console.log(`${icon} [${a.id}] ${a.asset.toUpperCase()} ${a.direction} ${formatPrice(a.targetPrice, a.currency)} (${a.type})`);
    }
  }
  
  if (triggered.length > 0) {
    console.log('\n✅ Triggered (last 10)\n');
    for (const a of triggered.slice(-10)) {
      console.log(`  [${a.id}] ${a.asset.toUpperCase()} ${a.direction} ${formatPrice(a.targetPrice, a.currency)} — triggered ${a.triggeredAt}`);
    }
  }

} else if (command === 'remove') {
  const id = args[1];
  if (!id) {
    console.error('Usage: node alerts.mjs remove <id>');
    process.exit(1);
  }
  
  let alerts = loadAlerts();
  const before = alerts.length;
  alerts = alerts.filter(a => a.id !== id);
  
  if (alerts.length === before) {
    console.log(`Alert ${id} not found`);
  } else {
    saveAlerts(alerts);
    console.log(`🗑️ Alert ${id} removed`);
  }

} else if (command === 'clear') {
  saveAlerts([]);
  console.log('🗑️ All alerts cleared');

} else if (command === 'check') {
  const alerts = loadAlerts();
  const active = alerts.filter(a => !a.triggered);
  
  if (active.length === 0) {
    console.log('No active alerts to check.');
    return;
  }
  
  console.log(`Checking ${active.length} alert(s)...\n`);
  
  // Group by type for batch fetching
  const cryptoAlerts = active.filter(a => a.type === 'crypto');
  const stockAlerts = active.filter(a => a.type === 'stock');
  
  const triggered = [];
  
  // Batch check crypto (up to 50 per request)
  if (cryptoAlerts.length > 0) {
    const uniqueCoins = [...new Set(cryptoAlerts.map(a => resolveCoinId(a.asset)))];
    const currencies = [...new Set(cryptoAlerts.map(a => a.currency))];
    
    for (const curr of currencies) {
      try {
        const ids = uniqueCoins.join(',');
        const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=${curr}`;
        const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw-PriceTracker/1.0' } });
        
        if (!resp.ok) {
          console.error(`CoinGecko error: ${resp.status}`);
          continue;
        }
        
        const prices = await resp.json();
        
        for (const alert of cryptoAlerts.filter(a => a.currency === curr)) {
          const coinId = resolveCoinId(alert.asset);
          const currentPrice = prices[coinId]?.[curr];
          
          if (!currentPrice) {
            console.log(`⚠️ No price data for ${alert.asset}`);
            continue;
          }
          
          const hit = alert.direction === 'above' 
            ? currentPrice >= alert.targetPrice
            : currentPrice <= alert.targetPrice;
          
          if (hit) {
            alert.triggered = true;
            alert.triggeredAt = new Date().toISOString();
            alert.triggeredPrice = currentPrice;
            triggered.push({ ...alert, currentPrice });
          }
          
          const icon = hit ? '🔔' : '  ';
          const dir = alert.direction === 'above' ? '≥' : '≤';
          console.log(`${icon} ${alert.asset.toUpperCase()}: ${formatPrice(currentPrice, curr)} (target: ${dir} ${formatPrice(alert.targetPrice, curr)}) ${hit ? '← TRIGGERED!' : ''}`);
        }
      } catch (err) {
        console.error(`Error checking crypto: ${err.message}`);
      }
      
      // Respect rate limit
      if (currencies.length > 1) await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Check stocks individually
  for (const alert of stockAlerts) {
    try {
      const data = await getPrice(alert.asset, 'stock', alert.currency);
      const currentPrice = data.price;
      
      const hit = alert.direction === 'above'
        ? currentPrice >= alert.targetPrice
        : currentPrice <= alert.targetPrice;
      
      if (hit) {
        alert.triggered = true;
        alert.triggeredAt = new Date().toISOString();
        alert.triggeredPrice = currentPrice;
        triggered.push({ ...alert, currentPrice });
      }
      
      const icon = hit ? '🔔' : '  ';
      console.log(`${icon} ${alert.asset.toUpperCase()}: ${formatPrice(currentPrice, alert.currency)} ${hit ? '← TRIGGERED!' : ''}`);
      
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`Error checking ${alert.asset}: ${err.message}`);
    }
  }
  
  // Save updated alerts
  saveAlerts(alerts);
  
  // Output triggered alerts as JSON for agent consumption
  if (triggered.length > 0) {
    console.log('\n--- TRIGGERED_ALERTS ---');
    console.log(JSON.stringify(triggered));
  } else {
    console.log('\n✅ No alerts triggered.');
  }

} else {
  console.log(`
Price Alert Manager

Commands:
  set <asset> <above|below> <price>  Create alert
  list                               List all alerts
  remove <id>                        Remove alert
  clear                              Remove all alerts
  check                              Check alerts against current prices

Options:
  --type=crypto|stock   Asset type (default: crypto)
  --currency=usd        Currency (default: usd)

Examples:
  node alerts.mjs set bitcoin above 100000
  node alerts.mjs set sol below 150 --currency=usd
  node alerts.mjs set AAPL above 200 --type=stock
  node alerts.mjs check
  `);
}
