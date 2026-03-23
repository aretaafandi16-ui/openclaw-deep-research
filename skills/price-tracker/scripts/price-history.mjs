#!/usr/bin/env node
/**
 * Price History — Log and query historical price snapshots
 * Usage:
 *   node price-history.mjs log <asset> [--type=crypto|stock] [--currency=usd]
 *   node price-history.mjs log-all              (logs entire watchlist)
 *   node price-history.mjs show <asset> [--days=30] [--currency=usd]
 *   node price-history.mjs export <asset> [--format=csv|json]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const WATCHLIST_FILE = join(DATA_DIR, 'watchlist.json');
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });

const aliases = {
  'btc': 'bitcoin', 'eth': 'ethereum', 'sol': 'solana', 'bnb': 'binancecoin',
  'xrp': 'ripple', 'ada': 'cardano', 'doge': 'dogecoin', 'avax': 'avalanche-2',
  'dot': 'polkadot', 'matic': 'matic-network', 'link': 'chainlink', 'uni': 'uniswap',
  'ltc': 'litecoin', 'atom': 'cosmos', 'near': 'near', 'arb': 'arbitrum',
  'op': 'optimism', 'sui': 'sui', 'pepe': 'pepe', 'shib': 'shiba-inu',
  'trx': 'tron', 'ton': 'the-open-network',
};

function resolveCoinId(input) { return aliases[input.toLowerCase()] || input.toLowerCase(); }

function getHistoryFile(asset) {
  const safeName = asset.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(HISTORY_DIR, `${safeName}.jsonl`);
}

function loadHistory(asset) {
  const file = getHistoryFile(asset);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function appendHistory(asset, entry) {
  const file = getHistoryFile(asset);
  writeFileSync(file, JSON.stringify(entry) + '\n', { flag: 'a' });
}

function formatPrice(num, curr = 'usd') {
  const symbols = { usd: '$', eur: '€', idr: 'Rp', gbp: '£', jpy: '¥', sgd: 'S$' };
  const sym = symbols[curr] || curr.toUpperCase() + ' ';
  if (num >= 1) return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${sym}${num.toFixed(6)}`;
}

async function getCryptoPrice(coinId, currency) {
  const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=${currency}&include_24hr_change=true`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw-PriceTracker/1.0' } });
  if (!resp.ok) throw new Error(`CoinGecko error: ${resp.status}`);
  const data = await resp.json();
  const info = data[coinId];
  if (!info) throw new Error(`No data for ${coinId}`);
  return { price: info[currency], change24h: info[`${currency}_24h_change`] };
}

async function getStockPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`Yahoo Finance error: ${resp.status}`);
  const data = await resp.json();
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No data for ${symbol}`);
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  return { price, change24h: ((price - prevClose) / prevClose) * 100 };
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'log') {
  const flags = {};
  const assets = [];
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v || true;
    } else assets.push(arg.toLowerCase());
  }
  
  if (assets.length === 0) {
    console.error('Usage: node price-history.mjs log <asset> [--type=crypto|stock] [--currency=usd]');
    process.exit(1);
  }
  
  const type = flags.type || 'crypto';
  const currency = (flags.currency || 'usd').toLowerCase();
  
  for (const asset of assets) {
    try {
      const resolved = type === 'crypto' ? resolveCoinId(asset) : asset;
      const data = type === 'crypto' 
        ? await getCryptoPrice(resolved, currency)
        : await getStockPrice(asset);
      
      const entry = {
        asset: resolved,
        type,
        currency,
        price: data.price,
        change24h: data.change24h,
        timestamp: new Date().toISOString(),
      };
      
      appendHistory(resolved, entry);
      console.log(`📝 Logged ${resolved}: ${formatPrice(data.price, currency)}`);
    } catch (err) {
      console.error(`❌ ${asset}: ${err.message}`);
    }
    
    if (assets.length > 1) await new Promise(r => setTimeout(r, 500));
  }

} else if (command === 'log-all') {
  const wl = JSON.parse(existsSync(WATCHLIST_FILE) ? readFileSync(WATCHLIST_FILE, 'utf-8') : '{"crypto":[],"stocks":[]}');
  const flags = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v || true;
    }
  }
  const currency = (flags.currency || 'usd').toLowerCase();
  
  if (wl.crypto.length > 0) {
    try {
      const ids = wl.crypto.join(',');
      const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=${currency}&include_24hr_change=true`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw-PriceTracker/1.0' } });
      
      if (resp.ok) {
        const data = await resp.json();
        for (const coin of wl.crypto) {
          const info = data[coin];
          if (!info) continue;
          const entry = {
            asset: coin, type: 'crypto', currency,
            price: info[currency],
            change24h: info[`${currency}_24h_change`],
            timestamp: new Date().toISOString(),
          };
          appendHistory(coin, entry);
          console.log(`📝 ${coin}: ${formatPrice(info[currency], currency)}`);
        }
      }
    } catch (err) {
      console.error(`Crypto batch error: ${err.message}`);
    }
  }
  
  for (const symbol of wl.stocks) {
    try {
      const data = await getStockPrice(symbol);
      const entry = {
        asset: symbol, type: 'stock', currency,
        price: data.price,
        change24h: data.change24h,
        timestamp: new Date().toISOString(),
      };
      appendHistory(symbol, entry);
      console.log(`📝 ${symbol}: ${formatPrice(data.price, 'usd')}`);
    } catch (err) {
      console.error(`❌ ${symbol}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

} else if (command === 'show') {
  const flags = {};
  const assets = [];
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v || true;
    } else assets.push(arg.toLowerCase());
  }
  
  if (assets.length === 0) {
    // Show all available histories
    const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith('.jsonl'));
    if (files.length === 0) {
      console.log('No price history found. Use: node price-history.mjs log <asset>');
      return;
    }
    console.log('\n📊 Available histories:');
    for (const f of files) {
      const asset = f.replace('.jsonl', '');
      const history = loadHistory(asset);
      const latest = history[history.length - 1];
      console.log(`  ${asset}: ${history.length} entries, latest: ${latest?.timestamp?.split('T')[0] || 'N/A'}`);
    }
    return;
  }
  
  const days = parseInt(flags.days || '30');
  const cutoff = new Date(Date.now() - days * 86400000);
  
  for (const asset of assets) {
    const resolved = resolveCoinId(asset);
    const history = loadHistory(resolved);
    const recent = history.filter(h => new Date(h.timestamp) >= cutoff);
    
    if (recent.length === 0) {
      console.log(`\n${asset}: No data in last ${days} days`);
      continue;
    }
    
    const currency = recent[0]?.currency || 'usd';
    const prices = recent.map(h => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const latest = recent[recent.length - 1];
    const first = recent[0];
    const overallChange = ((latest.price - first.price) / first.price) * 100;
    
    console.log(`\n📊 ${resolved} — Last ${days} days (${recent.length} snapshots)\n`);
    console.log(`   Current: ${formatPrice(latest.price, currency)}`);
    console.log(`   High:    ${formatPrice(max, currency)}`);
    console.log(`   Low:     ${formatPrice(min, currency)}`);
    console.log(`   Average: ${formatPrice(avg, currency)}`);
    console.log(`   Period:  ${overallChange >= 0 ? '+' : ''}${overallChange.toFixed(2)}%`);
    console.log(`   Range:   ${first.timestamp.split('T')[0]} → ${latest.timestamp.split('T')[0]}`);
  }

} else if (command === 'export') {
  const flags = {};
  let asset = null;
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v || true;
    } else asset = arg.toLowerCase();
  }
  
  if (!asset) {
    console.error('Usage: node price-history.mjs export <asset> [--format=csv|json]');
    process.exit(1);
  }
  
  const resolved = resolveCoinId(asset);
  const history = loadHistory(resolved);
  
  if (history.length === 0) {
    console.log(`No history for ${asset}`);
    return;
  }
  
  const format = flags.format || 'json';
  
  if (format === 'csv') {
    console.log('timestamp,price,change24h,currency');
    for (const h of history) {
      console.log(`${h.timestamp},${h.price},${h.change24h || ''},${h.currency}`);
    }
  } else {
    console.log(JSON.stringify(history, null, 2));
  }

} else {
  console.log(`
Price History Logger

Commands:
  log <asset>          Log current price snapshot
  log-all              Log prices for entire watchlist
  show [asset]         Show history stats (or list all if no asset)
  export <asset>       Export history as CSV or JSON

Options:
  --type=crypto|stock     Asset type (default: crypto)
  --currency=usd          Currency (default: usd)
  --days=30               Days to show (default: 30)
  --format=csv|json       Export format (default: json)

Examples:
  node price-history.mjs log bitcoin
  node price-history.mjs log-all
  node price-history.mjs show bitcoin --days=7
  node price-history.mjs export bitcoin --format=csv
  `);
}
