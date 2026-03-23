import { getSolBalance, getTokenAccounts, getRecentTransactions, shortenAddress } from 'solana-agent-lite';

/**
 * OpenClaw skill handler for Solana wallet operations.
 * Usage via exec: node skill.mjs balance <address>
 */

const [,, action, address] = process.argv;

async function main() {
  if (!address) {
    console.log('Usage: node skill.mjs <balance|tokens|transactions> <address>');
    process.exit(1);
  }

  switch (action) {
    case 'balance': {
      const bal = await getSolBalance(address);
      console.log(`🐋 ${shortenAddress(address)}: ${bal.sol.toFixed(4)} SOL (${bal.lamports} lamports)`);
      break;
    }
    case 'tokens': {
      const tokens = await getTokenAccounts(address);
      if (tokens.length === 0) {
        console.log('No token accounts found.');
      } else {
        console.log(`Tokens for ${shortenAddress(address)}:`);
        tokens.filter(t => t.uiAmount > 0).forEach(t => {
          console.log(`  • ${shortenAddress(t.mint, 6)}: ${t.uiAmount}`);
        });
      }
      break;
    }
    case 'transactions': {
      const txs = await getRecentTransactions(address, 5);
      console.log(`Recent transactions for ${shortenAddress(address)}:`);
      txs.forEach(tx => {
        const status = tx.err ? '❌' : '✅';
        const time = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'pending';
        console.log(`  ${status} ${shortenAddress(tx.signature, 8)} — ${time}`);
      });
      break;
    }
    default:
      console.log('Unknown action. Use: balance, tokens, transactions');
  }
}

main().catch(console.error);
