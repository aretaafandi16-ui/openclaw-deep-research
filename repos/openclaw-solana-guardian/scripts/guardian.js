#!/usr/bin/env node
/**
 * Solana Portfolio Guardian — Portfolio risk analysis
 * Fetches balances via Solana RPC, prices via Jupiter, and computes risk metrics.
 */

const https = require('https');
const { execSync } = require('child_process');

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function getTokenPrices(mints) {
  const ids = mints.join(',');
  const data = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);
  return data.data || {};
}

async function analyzeWallet(walletAddress) {
  // Fetch token accounts via RPC
  const rpcBody = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
    params: [walletAddress, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
  });

  const solBalance = JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'getBalance',
    params: [walletAddress]
  });

  // This is a template — actual integration would use proper RPC calls
  console.log(JSON.stringify({
    status: 'template',
    wallet: walletAddress,
    note: 'Connect to Solana RPC for live data. See SKILL.md for integration guide.'
  }, null, 2));
}

// CLI entry
const wallet = process.argv[2];
if (!wallet) {
  console.error('Usage: node guardian.js <SOLANA_PUBKEY>');
  process.exit(1);
}
analyzeWallet(wallet).catch(console.error);
