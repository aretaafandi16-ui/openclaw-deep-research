#!/usr/bin/env node
/**
 * agent-context CLI
 */

import { ContextManager, MODEL_PRESETS, estimateTokens, createContextForModel } from './index.mjs';

const [,, cmd, ...args] = process.argv;

const help = `
agent-context — Context window manager for AI agents

COMMANDS:
  add <role> <content>          Add a message (role: system|user|assistant|tool)
  get                           Get fitted messages (respects max tokens)
  stats                         Show context statistics
  budget                        Show budget breakdown
  compress                      Compress context (dedup + strip)
  clear                         Clear non-persistent messages
  configure --model <name>      Configure model preset
  estimate <text>               Estimate token count
  models                        List available model presets
  breakdown                     Per-message token breakdown
  last [n]                      Show last N messages
  find <role>                   Find messages by role
  export                        Export as JSON
  template <name>               Apply template (chat|coding|analysis|creative|agent|summarizer)
  demo                          Run demo
  mcp                           Start MCP server
  serve [port]                  Start HTTP server (default 3116)
  help                          Show this help

FLAGS:
  --max-tokens <n>              Set max context tokens
  --reserve-output <n>          Reserve tokens for output
  --model <name>                Use model preset (gpt-4o, claude-3-opus, etc.)
  --strategy <s>                Truncation strategy (sliding_window|priority|summarize|hybrid)
  --budget-system <n>           System message token budget
  --budget-tools <n>            Tool definitions token budget
  --budget-conversation <n>     Conversation token budget
  --persistent                  Mark message as persistent
  --priority <n>                Message priority (0-100)
`;

function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1];
}

function getBoolFlag(name) {
  return args.includes(`--${name}`);
}

let ctx = new ContextManager({
  maxTokens: parseInt(getFlag('max-tokens', '0')) || undefined,
  reserveOutput: parseInt(getFlag('reserve-output', '0')) || undefined,
  model: getFlag('model', undefined),
});

switch (cmd) {
  case 'add': {
    const [role, ...contentParts] = args.filter(a => !a.startsWith('--'));
    const content = contentParts.join(' ');
    if (!role || !content) { console.error('Usage: add <role> <content>'); process.exit(1); }
    const msg = ctx.add({
      role,
      content,
      priority: parseInt(getFlag('priority', '0')) || undefined,
      _persistent: getBoolFlag('persistent'),
    });
    console.log(`Added ${msg.role} message: ${msg._tokens} tokens (id: ${msg._id})`);
    console.log(`Total: ${ctx.inputTokens} / ${ctx.availableTokens} tokens (${ctx.utilizationPercent}%)`);
    break;
  }
  
  case 'get': {
    const strategy = getFlag('strategy', 'hybrid');
    const msgs = ctx.getMessages({ strategy });
    console.log(JSON.stringify(msgs, null, 2));
    break;
  }
  
  case 'stats': {
    const stats = ctx.getStats();
    console.log(`Context Window: ${stats.currentTokens} / ${stats.maxTokens} tokens (${stats.utilizationPercent}%)`);
    console.log(`Available: ${stats.availableTokens} | Remaining: ${stats.remainingTokens}`);
    console.log(`Messages: ${stats.messageCount} | Peak: ${stats.peakTokens}`);
    console.log(`Model: ${stats.model || 'custom'}`);
    console.log(`\nBy Role:`);
    for (const [role, count] of Object.entries(stats.roleCounts)) {
      console.log(`  ${role}: ${count} msgs, ${stats.roleTokens[role]} tokens`);
    }
    console.log(`\nOperations: +${stats.totalAdded} added, ${stats.totalTruncated} truncated, ${stats.totalCompressed} compressed`);
    break;
  }
  
  case 'budget': {
    const breakdown = ctx.getBudgetBreakdown();
    console.log(`System:       ${breakdown.system.used} tokens (budget: ${breakdown.system.budget || 'uncapped'}) ${breakdown.system.over ? '⚠️ OVER' : '✅'}`);
    console.log(`Tools:        ${breakdown.tools.used} tokens (budget: ${breakdown.tools.budget || 'uncapped'}) ${breakdown.tools.over ? '⚠️ OVER' : '✅'}`);
    console.log(`Conversation: ${breakdown.conversation.used} tokens (budget: ${breakdown.conversation.budget || 'uncapped'}) ${breakdown.conversation.over ? '⚠️ OVER' : '✅'}`);
    console.log(`Total:        ${breakdown.total.used} / ${breakdown.total.available} tokens`);
    break;
  }
  
  case 'compress': {
    const result = ctx.compress();
    console.log(`Compressed: ${result.before} → ${result.after} tokens (saved ${result.saved}, ${result.ratio}%)`);
    break;
  }
  
  case 'clear': {
    const keep = !getBoolFlag('no-keep');
    ctx.clear(keep);
    console.log(`Cleared. Remaining: ${ctx.messages.length} messages`);
    break;
  }
  
  case 'configure': {
    const model = getFlag('model');
    if (model) {
      const preset = MODEL_PRESETS[model];
      if (!preset) { console.error(`Unknown model: ${model}`); process.exit(1); }
      ctx.model = model;
      ctx.maxTokens = preset.maxTokens;
      ctx.reserveOutput = preset.reserveOutput;
      console.log(`Configured for ${model}: ${ctx.maxTokens} tokens, ${ctx.reserveOutput} reserved`);
    }
    const bs = parseInt(getFlag('budget-system', '0'));
    const bt = parseInt(getFlag('budget-tools', '0'));
    const bc = parseInt(getFlag('budget-conversation', '0'));
    if (bs || bt || bc) {
      ctx.setBudgets({ system: bs || null, tools: bt || null, conversation: bc || null });
      console.log('Budgets updated');
    }
    break;
  }
  
  case 'estimate': {
    const text = args.filter(a => !a.startsWith('--')).join(' ');
    console.log(`"${text.slice(0, 60)}..." → ${estimateTokens(text)} tokens`);
    break;
  }
  
  case 'models': {
    console.log('Available Model Presets:\n');
    for (const [name, preset] of Object.entries(MODEL_PRESETS)) {
      console.log(`  ${name.padEnd(24)} ${preset.maxTokens.toLocaleString().padStart(10)} tokens  (reserve: ${preset.reserveOutput})`);
    }
    break;
  }
  
  case 'breakdown': {
    const breakdown = ctx.getTokenBreakdown();
    for (const item of breakdown) {
      console.log(`  ${item.role.padEnd(10)} ${String(item.tokens).padStart(6)} tok  ${item.preview}`);
    }
    break;
  }
  
  case 'last': {
    const n = parseInt(args.filter(a => !a.startsWith('--'))[0] || '5');
    const msgs = ctx.last(n);
    for (const m of msgs) {
      const preview = typeof m.content === 'string' ? m.content.slice(0, 100) : '[complex]';
      console.log(`[${m.role}] ${preview}`);
    }
    break;
  }
  
  case 'find': {
    const role = args.filter(a => !a.startsWith('--'))[0];
    if (!role) { console.error('Usage: find <role>'); process.exit(1); }
    const found = ctx.find(role);
    console.log(`Found ${found.length} ${role} messages`);
    for (const m of found) {
      console.log(`  [${m._id}] ${m._tokens} tokens: ${(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 80)}`);
    }
    break;
  }
  
  case 'export': {
    console.log(JSON.stringify(ctx.export(), null, 2));
    break;
  }
  
  case 'template': {
    const name = args.filter(a => !a.startsWith('--'))[0];
    if (!name) { console.error('Usage: template <name>'); process.exit(1); }
    ctx.applyTemplate(name);
    console.log(`Applied template: ${name}`);
    console.log(`System messages: ${ctx.messages.length}, Tokens: ${ctx.inputTokens}`);
    break;
  }
  
  case 'demo': {
    console.log('=== agent-context Demo ===\n');
    
    // Configure for GPT-4o
    ctx = createContextForModel('gpt-4o');
    console.log(`Model: gpt-4o | Max: ${ctx.maxTokens.toLocaleString()} tokens\n`);
    
    // Add system
    ctx.addSystem('You are a helpful coding assistant. Be concise and accurate.');
    console.log(`System: ${ctx.inputTokens} tokens`);
    
    // Simulate conversation
    const messages = [
      { role: 'user', content: 'Write a Python function to find prime numbers up to N using the Sieve of Eratosthenes.' },
      { role: 'assistant', content: 'Here\'s an implementation:\n\n```python\ndef sieve_of_eratosthenes(n):\n    if n < 2:\n        return []\n    is_prime = [True] * (n + 1)\n    is_prime[0] = is_prime[1] = False\n    for i in range(2, int(n**0.5) + 1):\n        if is_prime[i]:\n            for j in range(i*i, n + 1, i):\n                is_prime[j] = False\n    return [i for i in range(2, n + 1) if is_prime[i]]\n```\n\nTime complexity: O(n log log n), Space: O(n)' },
      { role: 'user', content: 'Can you add a way to also return the prime factorization of each number?' },
      { role: 'assistant', content: 'Here\'s the enhanced version:\n\n```python\ndef prime_sieve_with_factors(n):\n    if n < 2:\n        return [], {}\n    spf = list(range(n + 1))  # smallest prime factor\n    for i in range(2, int(n**0.5) + 1):\n        if spf[i] == i:\n            for j in range(i*i, n + 1, i):\n                if spf[j] == j:\n                    spf[j] = i\n    primes = [i for i in range(2, n + 1) if spf[i] == i]\n    factors = {}\n    for num in range(2, n + 1):\n        f = []\n        x = num\n        while x > 1:\n            f.append(spf[x])\n            x //= spf[x]\n        factors[num] = f\n    return primes, factors\n```' },
      { role: 'user', content: 'What\'s the time complexity of this approach?' },
      { role: 'assistant', content: 'The enhanced version has:\n- **Sieve construction**: O(n log log n) — same as standard Eratosthenes\n- **Factorization**: O(n log n) total — each number is divided by its smallest prime factor repeatedly. For any number k, the factorization takes O(log k) steps.\n- **Space**: O(n) for the SPF array + O(n log n) for storing all factorizations\n\nOverall: **O(n log n)** time, **O(n log n)** space.' },
    ];
    
    for (const msg of messages) {
      const added = ctx.add(msg);
      console.log(`${msg.role.padEnd(10)} +${added._tokens} tokens → ${ctx.inputTokens} total`);
    }
    
    // Show stats
    console.log('\n--- Stats ---');
    const stats = ctx.getStats();
    console.log(`Total: ${stats.currentTokens} / ${stats.maxTokens} (${stats.utilizationPercent}%)`);
    
    // Test compression
    console.log('\n--- Compress ---');
    const result = ctx.compress({ stripWhitespace: true, deduplicate: true });
    console.log(`Before: ${result.before} → After: ${result.after} (saved ${result.saved})`);
    
    // Test truncation with tiny budget
    console.log('\n--- Truncate (1000 token budget) ---');
    const truncated = ctx.getMessages({ maxTokens: 1000, strategy: 'hybrid' });
    console.log(`Kept ${truncated.length} of ${ctx.messages.length} messages`);
    for (const m of truncated) {
      console.log(`  [${m.role}] ${(typeof m.content === 'string' ? m.content : '').slice(0, 60)}...`);
    }
    
    // Budget breakdown
    console.log('\n--- Budget Breakdown ---');
    ctx.setBudgets({ system: 200, conversation: 5000 });
    const budget = ctx.getBudgetBreakdown();
    console.log(`System: ${budget.system.used}/${budget.system.budget || '∞'}`);
    console.log(`Conversation: ${budget.conversation.used}/${budget.conversation.budget || '∞'}`);
    
    // Token estimation
    console.log('\n--- Token Estimation ---');
    console.log(`"Hello world" → ${estimateTokens('Hello world')} tokens`);
    console.log(`1000 chars of English → ${estimateTokens('a'.repeat(1000))} tokens`);
    console.log(`Chinese: "你好世界" → ${estimateTokens('你好世界')} tokens`);
    console.log(`Code: "fn main() { println!(\\\"hi\\\"); }" → ${estimateTokens('fn main() { println!("hi"); }')} tokens`);
    
    console.log('\n✅ Demo complete!');
    break;
  }
  
  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }
  
  case 'serve': {
    const port = parseInt(args.filter(a => !a.startsWith('--'))[0] || '3116');
    await import('./server.mjs');
    break;
  }
  
  case 'help':
  default:
    console.log(help);
    break;
}
