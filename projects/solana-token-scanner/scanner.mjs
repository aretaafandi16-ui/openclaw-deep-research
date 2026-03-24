#!/usr/bin/env node

/**
 * Solana Token Scanner — AI Agent Safety Tool
 * Lightweight, zero-dependency token risk assessment for agents
 */

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// --- Helpers ---

async function rpcCall(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC Error: ${JSON.stringify(data.error)}`);
  return data.result;
}

function decodeString(buf) {
  try {
    return new TextDecoder().decode(buf).replace(/\0/g, '').trim();
  } catch {
    return null;
  }
}

function decodeU64LE(buf, offset = 0) {
  let val = 0n;
  for (let i = 7; i >= 0; i--) {
    val = (val << 8n) | BigInt(buf[offset + i] ?? 0);
  }
  return val;
}

// --- Token Account Parsing ---

function parseMintAccount(data) {
  // SPL Token Mint Layout (82 bytes):
  // [0-36]: mintAuthority option + pubkey
  // [36-44]: supply (u64 LE)
  // [44]: decimals (u8)
  // [45]: isInitialized (bool)
  // [46-82]: freezeAuthority option + pubkey
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');

  const mintAuthOption = buf[4];
  let mintAuthority = null;
  if (mintAuthOption === 1) {
    mintAuthority = buf.slice(4, 36).toString('base64');
    // Convert to base58-ish display
    mintAuthority = bs58Encode(buf.slice(4, 36));
  }

  const supply = decodeU64LE(buf, 36);
  const decimals = buf[44];
  const isInitialized = buf[45] === 1;

  const freezeAuthOption = buf[46];
  let freezeAuthority = null;
  if (freezeAuthOption === 1) {
    freezeAuthority = bs58Encode(buf.slice(48, 80));
  }

  return { mintAuthority, supply, decimals, isInitialized, freezeAuthority };
}

// Minimal base58 encoder (no deps)
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function bs58Encode(bytes) {
  let result = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < result.length; j++) {
      carry += result[j] << 8;
      result[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      result.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result.push(0);
  }
  return result.reverse().map(c => ALPHABET[c]).join('');
}

// --- Token Metadata (Metaplex) ---

async function getTokenMetadata(mintAddress) {
  try {
    // Metaplex Token Metadata Program ID
    const META_PID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
    
    // Derive metadata PDA
    const { PublicKey } = await import('@solana/web3.js').catch(() => ({ PublicKey: null }));
    
    // Fallback: use getTokenAccountBalance for basic info, then try Helius/DAS
    // For simplicity, try Helius DAS API first (free tier available)
    const heliusKey = process.env.HELIUS_API_KEY;
    if (heliusKey) {
      const res = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAsset',
            params: { id: mintAddress },
          }),
        }
      );
      const data = await res.json();
      if (data.result) {
        return {
          name: data.result.content?.metadata?.name || null,
          symbol: data.result.content?.metadata?.symbol || null,
          uri: data.result.content?.json_uri || null,
          source: 'helius',
        };
      }
    }
    
    return { name: null, symbol: null, uri: null, source: 'none' };
  } catch {
    return { name: null, symbol: null, uri: null, source: 'error' };
  }
}

// --- Holder Analysis ---

async function getTopHolders(mintAddress, limit = 10) {
  try {
    const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const result = await rpcCall('getTokenLargestAccounts', [mintAddress]);
    
    if (!result || !result.value) return { holders: [], totalAnalyzed: 0 };
    
    const holders = result.value.map((acc, i) => ({
      rank: i + 1,
      address: acc.address,
      amount: acc.uiAmount || 0,
      amountRaw: acc.amount,
      decimals: acc.decimals,
    }));
    
    return { holders: holders.slice(0, limit), totalAnalyzed: result.value.length };
  } catch (err) {
    return { holders: [], totalAnalyzed: 0, error: err.message };
  }
}

async function getHolderCount(mintAddress) {
  try {
    // Use getTokenAccountsByOwner for a count approximation via largest accounts
    const largest = await rpcCall('getTokenLargestAccounts', [mintAddress]);
    // This gives top 20, not total count. For full count need indexing service.
    return { approximate: largest?.value?.length || 0, note: 'Top accounts only; full count requires indexer' };
  } catch {
    return { approximate: 0, note: 'Could not fetch' };
  }
}

// --- Risk Scoring ---

function calculateRiskScore(mintInfo, metadata, holderData) {
  let score = 0;
  const flags = [];

  // Freeze authority is a major red flag
  if (mintInfo.freezeAuthority) {
    score += 40;
    flags.push({
      level: 'HIGH',
      message: 'Freeze authority is ACTIVE — creator can freeze your tokens at any time',
      field: 'freezeAuthority',
    });
  }

  // Mint authority means infinite supply
  if (mintInfo.mintAuthority) {
    score += 35;
    flags.push({
      level: 'HIGH',
      message: 'Mint authority is ACTIVE — creator can mint unlimited additional tokens',
      field: 'mintAuthority',
    });
  }

  // Concentration analysis
  if (holderData.holders.length > 0) {
    const totalSupply = BigInt(mintInfo.supply || '0');
    if (totalSupply > 0n) {
      const topHolderPct = Number(BigInt(holderData.holders[0].amountRaw || '0') * 10000n / totalSupply) / 100;
      if (topHolderPct > 30) {
        score += 20;
        flags.push({
          level: 'HIGH',
          message: `Top holder owns ${topHolderPct.toFixed(1)}% of supply — extreme concentration`,
          field: 'topHolder',
        });
      } else if (topHolderPct > 20) {
        score += 10;
        flags.push({
          level: 'MEDIUM',
          message: `Top holder owns ${topHolderPct.toFixed(1)}% of supply — notable concentration`,
          field: 'topHolder',
        });
      }
    }
  }

  // No metadata is suspicious
  if (!metadata.name && !metadata.symbol) {
    score += 10;
    flags.push({
      level: 'MEDIUM',
      message: 'No token metadata found — token may be unaudited or very new',
      field: 'metadata',
    });
  }

  // Low holder count
  if (holderData.totalAnalyzed > 0 && holderData.totalAnalyzed < 5) {
    score += 15;
    flags.push({
      level: 'MEDIUM',
      message: `Very few holders detected (${holderData.totalAnalyzed}) — extremely illiquid`,
      field: 'holders',
    });
  }

  // Determine verdict
  let verdict;
  if (score >= 60) verdict = 'HIGH_RISK';
  else if (score >= 30) verdict = 'MEDIUM_RISK';
  else if (score >= 10) verdict = 'LOW_RISK';
  else verdict = 'LIKELY_SAFE';

  return { score: Math.min(score, 100), flags, verdict };
}

// --- Formatted Output ---

function printReport(result, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    return;
  }

  const { mint, metadata, mintInfo, holders, risk } = result;
  
  console.log('');
  console.log('🐋 SOLANA TOKEN SAFETY REPORT');
  console.log('═'.repeat(50));
  console.log(`📍 Mint:    ${mint}`);
  console.log(`📛 Name:    ${metadata.name || 'Unknown'}`);
  console.log(`🏷️  Symbol:  ${metadata.symbol || 'Unknown'}`);
  console.log(`📊 Supply:  ${formatSupply(mintInfo.supply, mintInfo.decimals)}`);
  console.log(`🔢 Decimals: ${mintInfo.decimals}`);
  console.log('');
  
  console.log('🔐 AUTHORITY STATUS');
  console.log('─'.repeat(40));
  console.log(`   Freeze: ${mintInfo.freezeAuthority ? '🔴 ACTIVE (' + mintInfo.freezeAuthority.slice(0, 8) + '...)' : '✅ None (safe)'}`);
  console.log(`   Mint:   ${mintInfo.mintAuthority ? '🔴 ACTIVE (' + mintInfo.mintAuthority.slice(0, 8) + '...)' : '✅ None (safe)'}`);
  console.log('');
  
  if (holders.holders.length > 0) {
    console.log('👥 TOP HOLDERS');
    console.log('─'.repeat(40));
    for (const h of holders.holders.slice(0, 5)) {
      console.log(`   #${h.rank}: ${h.address.slice(0, 12)}... — ${h.amount.toLocaleString()} tokens`);
    }
    console.log('');
  }
  
  console.log('⚠️  RISK ASSESSMENT');
  console.log('─'.repeat(40));
  
  const verdictEmoji = {
    LIKELY_SAFE: '✅',
    LOW_RISK: '🟢',
    MEDIUM_RISK: '🟡',
    HIGH_RISK: '🔴',
  };
  console.log(`   Score:  ${risk.score}/100 ${verdictEmoji[risk.verdict] || '❓'} ${risk.verdict}`);
  
  if (risk.flags.length > 0) {
    console.log('');
    console.log('   Flags:');
    for (const f of risk.flags) {
      const icon = f.level === 'HIGH' ? '🔴' : f.level === 'MEDIUM' ? '🟡' : '⚪';
      console.log(`   ${icon} ${f.message}`);
    }
  }
  console.log('');
}

function formatSupply(supply, decimals) {
  try {
    const big = BigInt(supply);
    const divisor = BigInt(10 ** decimals);
    const whole = big / divisor;
    return whole.toLocaleString();
  } catch {
    return supply;
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const mintAddress = args.find(a => !a.startsWith('--'));
  
  if (!mintAddress) {
    console.error('Usage: node scanner.mjs [--json] <TOKEN_MINT_ADDRESS>');
    console.error('');
    console.error('Options:');
    console.error('  --json    Output as JSON for agent integration');
    console.error('');
    console.error('Environment:');
    console.error('  SOLANA_RPC_URL    Custom RPC endpoint (default: mainnet-beta)');
    console.error('  HELIUS_API_KEY    Helius API key for metadata enrichment');
    process.exit(1);
  }
  
  if (!jsonMode) console.log('🔍 Scanning token...');
  
  // Validate address format (base58, 32-44 chars)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress)) {
    console.error('❌ Invalid Solana address format');
    process.exit(1);
  }
  
  try {
    // Fetch data in parallel
    const [accountInfo, metadata, holders] = await Promise.all([
      rpcCall('getAccountInfo', [mintAddress, { encoding: 'base64' }]),
      getTokenMetadata(mintAddress),
      getTopHolders(mintAddress),
    ]);
    
    if (!accountInfo?.value?.data) {
      console.error('❌ Token account not found or invalid');
      process.exit(1);
    }
    
    const mintInfo = parseMintAccount(accountInfo.value.data[0]);
    const holderCount = await getHolderCount(mintAddress);
    const risk = calculateRiskScore(mintInfo, metadata, holders);
    
    const result = {
      mint: mintAddress,
      metadata,
      mintInfo,
      holders,
      holderCount,
      risk,
      scannedAt: new Date().toISOString(),
      rpcUrl: RPC_URL.replace(/api-key=[^&]+/, 'api-key=***'),
    };
    
    printReport(result, jsonMode);
    
    // Exit code reflects risk level for agent integration
    process.exit(risk.verdict === 'HIGH_RISK' ? 2 : risk.verdict === 'MEDIUM_RISK' ? 1 : 0);
    
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(3);
  }
}

main();
