#!/usr/bin/env node
/**
 * Watchlist — Manage price watchlists
 * Usage:
 *   node watchlist.mjs add <asset> [asset2...] [--type=crypto|stock] [--currency=usd]
 *   node watchlist.mjs remove <asset>
 *   node watchlist.mjs list
 *   node watchlist.mjs prices [--currency=usd]
 *   node watchlist.mjs clear
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const WATCHLIST_FILE = join(DATA_DIR, 'watchlist.json');
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

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

function loadWatchlist() {
  if (!existsSync(WATCHLIST_FILE)) return { crypto: [], stocks: [] };
  try {
    return JSON.parse(readFileSync(WATCHLIST_FILE, 'utf-8'));
  } catch {
    return { crypto: [], stocks: [] };
  }
}

function saveWatchlist(wl) {
  writeFileSync(WATCHLIST_FILE, JSON.stringify(wl, null, 2));
}

function formatPrice(num, curr = 'usd') {
  const symbols = { usd: '$', eur: '€', idr: 'Rp', gbp: '£', jpy: '¥', sgd: 'S$' };
  const sym = symbols[curr] || curr.toUpperCase() + ' ';
  if (num >= 1) return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${sym}${num.toFixed(6)}`;
}

function formatPct(num) {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function pctEmoji(num) {
  if (num >= 5) return '🚀';
  if (num >= 0) return '📈';
  if (num >= -5) return '📉';
  return '💀';
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'add') {
  const flags = {};
  const items = [];
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v || true;
    } else {
      items.push(arg.toLowerCase());
    }
  }
  
  if (items.length === 0) {
    console.error('Usage: node watchlist.mjs add <asset> [asset2...] [--type=crypto|stock]');
    process.exit(1);
  }
  
  const wl = loadWatchlist();
  const type = flags.type || 'crypto';
  const list = type === 'stock' ? wl.stocks : wl.crypto;
  
  let added = 0;
  for (const item of items) {
    const resolved = type === 'crypto' ? resolveCoinId(item) : item.toUpperCase();
    if (!list.includes(resolved)) {
      list.push(resolved);
      added++;
      console.log(`✅ Added ${resolved} to ${type} watchlist`);
    } else {
      console.log(`  ${resolved} already in watchlist`);
    }
  }
  
  if (type === 'stock') wl.stocks = list;
  else wl.crypto = list;
  
  saveWatchlist(wl);
  if (added > 0) console.log(`\n${added} asset(s) added.`);

} else if (command === 'remove') {
  const asset = args[1]?.toLowerCase();
  if (!asset) {
    console.error('Usage: node watchlist.mjs remove <asset>');
    process.exit(1);
  }
  
  const wl = loadWatchlist();
  const resolved = resolveCoinId(asset);
  let found = false;
  
  if (wl.crypto.includes(resolved)) {
    wl.crypto = wl.crypto.filter(c => c !== resolved);
    found = true;
    console.log(`🗑️ Removed ${resolved} from crypto watchlist`);
  }
  
  const upperAsset = asset.toUpperCase();
  if (wl.stocks.includes(upperAsset)) {
    wl.stocks = wl.stocks.filter(s => s !== upperAsset);
    found = true;
    console.log(`🗑️ Removed ${upperAsset} from stock watchlist`);
  }
  
  if (!found) console.log(`${asset} not in any watchlist`);
  else saveWatchlist(wl);

} else if (command === 'list') {
  const wl = loadWatchlist();
  
  if (wl.crypto.length === 0 && wl.stocks.length === 0) {
    console.log('Watchlist is empty. Use: node watchlist.mjs add <asset>');
    process.exit(0);
  }
  
  console.log('\n📋 Watchlist\n');
  if (wl.crypto.length > 0) {
    console.log('Crypto:', wl.crypto.join(', '));
  }
  if (wl.stocks.length > 0) {
    console.log('Stocks:', wl.stocks.join(', '));
  }

} else if (command === 'prices') {
  const wl = loadWatchlist();
  
  if (wl.crypto.length === 0 && wl.stocks.length === 0) {
    console.log('Watchlist is empty.');
    process.exit(0);
  }
  
  const flags = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v || true;
    }
  }
  const currency = (flags.currency || 'usd').toLowerCase();
  
  // Fetch crypto prices
  if (wl.crypto.length > 0) {
    try {
      const ids = wl.crypto.join(',');
      const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=${currency}&include_24hr_change=true`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw-PriceTracker/1.0' } });
      
      if (resp.ok) {
        const data = await resp.json();
        console.log(`\n💰 Crypto Watchlist (${currency.toUpperCase()})\n`);
        
        for (const coin of wl.crypto) {
          const info = data[coin];
          if (!info) {
            console.log(`❌ ${coin}: No data`);
            continue;
          }
          const price = info[currency];
          const change = info[`${currency}_24h_change`];
          const emoji = pctEmoji(change || 0);
          
          const name = coin.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          console.log(`${emoji} ${name}: ${formatPrice(price, currency)} ${change !== undefined ? `(${formatPct(change)})` : ''}`);
        }
      } else {
        console.error(`CoinGecko error: ${resp.status}`);
      }
    } catch (err) {
      console.error(`Crypto fetch error: ${err.message}`);
    }
  }
  
  // Fetch stock prices
  if (wl.stocks.length > 0) {
    console.log(`\n📊 Stock Watchlist\n`);
    for (const symbol of wl.stocks) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        
        if (resp.ok) {
          const data = await resp.json();
          const meta = data.chart?.result?.[0]?.meta;
          if (meta) {
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            const changePct = ((price - prevClose) / prevClose) * 100;
            const emoji = pctEmoji(changePct);
            const name = meta.shortName || symbol;
            console.log(`${emoji} ${symbol} (${name}): ${formatPrice(price, 'usd')} (${formatPct(changePct)})`);
          }
        } else {
          console.log(`❌ ${symbol}: Fetch error`);
        }
      } catch (err) {
        console.log(`❌ ${symbol}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

} else if (command === 'clear') {
  saveWatchlist({ crypto: [], stocks: [] });
  console.log('🗑️ Watchlist cleared');

} else {
  console.log(`
Watchlist Manager

Commands:
  add <asset> [asset2...]     Add to watchlist
  remove <asset>              Remove from watchlist
  list                        Show watchlist
  prices                      Show current prices for watchlist
  clear                       Clear watchlist

Options:
  --type=crypto|stock   Asset type (default: crypto)
  --currency=usd        Currency for prices (default: usd)

Examples:
  node watchlist.mjs add bitcoin ethereum solana
  node watchlist.mjs add AAPL GOOGL --type=stock
  node watchlist.mjs prices
  node watchlist.mjs prices --currency=idr
  `);
}
