#!/usr/bin/env node
/**
 * Price Check — Fetch current prices for crypto and stocks
 * Usage: node price-check.mjs <asset> [--currency=usd] [--type=crypto|stock]
 * 
 * Examples:
 *   node price-check.mjs bitcoin
 *   node price-check.mjs bitcoin ethereum solana
 *   node price-check.mjs bitcoin --currency=idr
 *   node price-check.mjs AAPL --type=stock
 *   node price-check.mjs bitcoin --json
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Parse CLI args
const args = process.argv.slice(2);
const flags = {};
const assets = [];

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, val] = arg.slice(2).split('=');
    flags[key] = val || true;
  } else {
    assets.push(arg.toLowerCase());
  }
}

if (assets.length === 0) {
  console.error('Usage: node price-check.mjs <asset> [asset2...] [--currency=usd] [--type=crypto|stock] [--json]');
  process.exit(1);
}

const currency = (flags.currency || 'usd').toLowerCase();
const type = flags.type || 'crypto';
const jsonOutput = flags.json === true;

// Format number with commas
function formatPrice(num, curr = 'usd') {
  const symbols = { usd: '$', eur: '€', idr: 'Rp', gbp: '£', jpy: '¥', sgd: 'S$', aud: 'A$', cad: 'C$' };
  const sym = symbols[curr] || curr.toUpperCase() + ' ';
  
  if (num >= 1) {
    return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (num >= 0.0001) {
    return `${sym}${num.toFixed(6)}`;
  } else {
    return `${sym}${num.toExponential(4)}`;
  }
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

// Fetch crypto prices from CoinGecko
async function getCryptoPrices(coinIds, curr) {
  const ids = coinIds.join(',');
  const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=${curr}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'OpenClaw-PriceTracker/1.0' }
  });
  
  if (!resp.ok) {
    if (resp.status === 429) {
      throw new Error('Rate limited by CoinGecko. Wait a minute and try again.');
    }
    throw new Error(`CoinGecko API error: ${resp.status} ${resp.statusText}`);
  }
  
  return resp.json();
}

// Resolve common coin name aliases
function resolveCoinId(input) {
  const aliases = {
    'btc': 'bitcoin',
    'eth': 'ethereum',
    'sol': 'solana',
    'bnb': 'binancecoin',
    'xrp': 'ripple',
    'ada': 'cardano',
    'doge': 'dogecoin',
    'avax': 'avalanche-2',
    'dot': 'polkadot',
    'matic': 'matic-network',
    'link': 'chainlink',
    'uni': 'uniswap',
    'ltc': 'litecoin',
    'atom': 'cosmos',
    'near': 'near',
    'ftm': 'fantom',
    'arb': 'arbitrum',
    'op': 'optimism',
    'sui': 'sui',
    'pepe': 'pepe',
    'shib': 'shiba-inu',
    'trx': 'tron',
    'ton': 'the-open-network',
  };
  
  return aliases[input] || input;
}

// Fetch stock price via Yahoo Finance
async function getStockPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  if (!resp.ok) {
    throw new Error(`Yahoo Finance error: ${resp.status} for symbol ${symbol}`);
  }
  
  const data = await resp.json();
  const result = data.chart?.result?.[0];
  
  if (!result) throw new Error(`No data found for ${symbol}`);
  
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  const change = price - prevClose;
  const changePct = (change / prevClose) * 100;
  
  return {
    symbol: symbol.toUpperCase(),
    name: meta.shortName || meta.longName || symbol,
    price,
    currency: meta.currency || 'USD',
    change,
    changePct,
    prevClose,
    marketState: meta.marketState || 'UNKNOWN',
    volume: meta.regularMarketVolume,
  };
}

// Main
async function main() {
  try {
    if (type === 'stock') {
      // Stock prices
      const results = [];
      for (const asset of assets) {
        try {
          const data = await getStockPrice(asset);
          results.push(data);
        } catch (err) {
          results.push({ symbol: asset.toUpperCase(), error: err.message });
        }
        // Small delay between requests
        if (assets.length > 1) await new Promise(r => setTimeout(r, 500));
      }
      
      if (jsonOutput) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      
      console.log('\n📊 Stock Prices\n');
      for (const r of results) {
        if (r.error) {
          console.log(`❌ ${r.symbol}: ${r.error}`);
          continue;
        }
        const emoji = pctEmoji(r.changePct);
        const stateEmoji = r.marketState === 'REGULAR' ? '🟢' : r.marketState === 'PRE' ? '🟡' : '🔴';
        console.log(`${stateEmoji} ${r.symbol} (${r.name})`);
        console.log(`   Price: ${formatPrice(r.price, r.currency.toLowerCase())}`);
        console.log(`   Change: ${formatPct(r.changePct)} ${emoji} (${formatPrice(Math.abs(r.change), r.currency.toLowerCase())})`);
        console.log('');
      }
    } else {
      // Crypto prices
      const coinIds = assets.map(resolveCoinId);
      const data = await getCryptoPrices(coinIds, currency);
      
      if (jsonOutput) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      
      console.log(`\n💰 Crypto Prices (${currency.toUpperCase()})\n`);
      
      for (const [id, info] of Object.entries(data)) {
        const priceKey = currency;
        const changeKey = `${currency}_24h_change`;
        const mcapKey = `${currency}_market_cap`;
        const volKey = `${currency}_24h_vol`;
        
        const price = info[priceKey];
        const change = info[changeKey];
        const mcap = info[mcapKey];
        const vol = info[volKey];
        
        if (!price) {
          console.log(`❌ ${id}: Price not available`);
          continue;
        }
        
        const emoji = pctEmoji(change || 0);
        const displayName = id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        
        console.log(`${emoji} ${displayName}`);
        console.log(`   Price: ${formatPrice(price, currency)}`);
        if (change !== undefined) {
          console.log(`   24h: ${formatPct(change)}`);
        }
        if (mcap) {
          console.log(`   MCap: ${formatPrice(mcap, currency)}`);
        }
        if (vol) {
          console.log(`   Vol:  ${formatPrice(vol, currency)}`);
        }
        console.log('');
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
