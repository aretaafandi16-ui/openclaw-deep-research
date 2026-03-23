#!/usr/bin/env node
/**
 * agent-cost test suite
 */

import { CostTracker, PRICING } from './index.mjs';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';

const TEST_DIR = join(process.cwd(), '.agent-cost-test-' + Date.now());
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function test(name, fn) {
  console.log(`\n🧪 ${name}`);
  fn();
}

// ─── Tests ───────────────────────────────────────────────────────────

test('record usage and calculate cost', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t1' });
  const r = t.record('openai', 'gpt-4o', 1000, 500);
  assert(r.provider === 'openai', 'provider set');
  assert(r.model === 'gpt-4o', 'model set');
  assert(r.inputTokens === 1000, 'input tokens set');
  assert(r.outputTokens === 500, 'output tokens set');
  assert(r.totalCost > 0, 'cost calculated');
  assert(r.inputCost === 0.0025, 'input cost correct (0.0025/1K * 1K)');
  assert(r.outputCost === 0.005, 'output cost correct (0.01/1K * 0.5K)');
  assert(r.totalCost === 0.0075, 'total cost correct');
  assert(r.id.length > 0, 'id generated');
  assert(r.timestamp > 0, 'timestamp set');
});

test('estimate cost without recording', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t2' });
  const e = t.estimate('anthropic', 'claude-sonnet-4-20250514', 2000, 1000);
  assert(e.provider === 'anthropic', 'provider set');
  assert(e.totalCost === 0.021, 'cost correct (0.003/1K*2K + 0.015/1K*1K)');
  assert(t.allRecords().length === 0, 'no record created');
});

test('find cheapest model', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t3' });
  const results = t.findCheapest(1000, 500);
  assert(results.length > 0, 'results returned');
  assert(results[0].totalCost <= results[results.length - 1].totalCost, 'sorted by cost');
  
  // Filter by provider
  const openai = t.findCheapest(1000, 500, { provider: 'openai' });
  assert(openai.every(r => r.provider === 'openai'), 'provider filter works');
  
  // Filter by max cost
  const cheap = t.findCheapest(1000, 500, { maxCost: 0.001 });
  assert(cheap.every(r => r.totalCost <= 0.001), 'max cost filter works');
});

test('usage statistics', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t4' });
  t.record('openai', 'gpt-4o', 1000, 500);
  t.record('openai', 'gpt-4o-mini', 5000, 2000);
  t.record('anthropic', 'claude-sonnet-4-20250514', 2000, 1000);

  const s = t.stats();
  assert(s.totalRequests === 3, 'total requests');
  assert(s.totalInputTokens === 8000, 'total input tokens');
  assert(s.totalOutputTokens === 3500, 'total output tokens');
  assert(s.byProvider['openai'].requests === 2, 'openai requests');
  assert(s.byProvider['anthropic'].requests === 1, 'anthropic requests');
  assert(s.avgCostPerRequest > 0, 'avg cost calculated');
});

test('budget management', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t5', budgets: { daily: 0.01, hardLimit: false } });
  const config = t.getBudget();
  assert(config.daily === 0.01, 'daily budget set');
  
  t.setBudget({ monthly: 1.0 });
  assert(t.getBudget().monthly === 1.0, 'monthly budget added');
  assert(t.getBudget().daily === 0.01, 'daily budget preserved');
});

test('budget status with spending', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t6', budgets: { daily: 0.10 } });
  t.record('openai', 'gpt-4o', 5000, 2500);
  
  const statuses = t.budgetStatus();
  assert(statuses.length === 1, 'one budget status');
  assert(statuses[0].spent > 0, 'spent calculated');
  assert(statuses[0].remaining < statuses[0].limit, 'remaining less than limit');
  assert(statuses[0].percentUsed > 0, 'percent used calculated');
});

test('hard budget limit throws', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t7', budgets: { daily: 0.001, hardLimit: true } });
  t.record('openai', 'gpt-4o', 100, 50); // small, should be ok
  let threw = false;
  try {
    t.record('openai', 'gpt-4o', 10000, 5000); // big, should exceed
  } catch (e) {
    threw = true;
    assert(e.message.includes('budget exceeded'), 'error message mentions budget');
  }
  assert(threw, 'threw on budget exceed');
});

test('budget warning events', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t8', budgets: { daily: 0.01 } });
  let warned = false;
  t.on('budget:warning', (info) => {
    warned = true;
    assert(info.period === 'daily', 'warning period correct');
    assert(info.percentUsed >= 50, 'warning at threshold');
  });
  // Record enough to trigger warning
  t.record('openai', 'gpt-4o', 5000, 2500); // ~$0.0375 out of $0.01 = 375%
  assert(warned, 'budget warning emitted');
});

test('record event emitted', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t9' });
  let received = null;
  t.on('record', (r) => { received = r; });
  t.record('openai', 'gpt-4o', 1000, 500);
  assert(received !== null, 'record event emitted');
  assert(received.provider === 'openai', 'event has correct data');
});

test('custom pricing', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t10' });
  t.addPricing('custom', 'my-model', 0.001, 0.002);
  const e = t.estimate('custom', 'my-model', 1000, 1000);
  assert(e.totalCost === 0.003, 'custom pricing applied');
  
  const models = t.listModels('custom');
  assert(models['custom'].includes('my-model'), 'custom model listed');
});

test('CSV export', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t11' });
  t.record('openai', 'gpt-4o', 1000, 500);
  t.record('anthropic', 'claude-sonnet-4-20250514', 2000, 1000);
  
  const csv = t.toCSV();
  assert(csv.includes('provider'), 'CSV has header');
  assert(csv.includes('openai'), 'CSV has openai row');
  assert(csv.includes('anthropic'), 'CSV has anthropic row');
  const lines = csv.trim().split('\n');
  assert(lines.length === 3, 'CSV has 3 lines (header + 2 records)');
});

test('clear records', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t12' });
  t.record('openai', 'gpt-4o', 1000, 500);
  assert(t.allRecords().length === 1, 'has 1 record');
  t.clear();
  assert(t.allRecords().length === 0, 'records cleared');
});

test('recent records', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t13' });
  for (let i = 0; i < 25; i++) {
    t.record('openai', 'gpt-4o', 100, 50);
  }
  const recent = t.recent(10);
  assert(recent.length === 10, 'returns requested limit');
  assert(recent[0].timestamp >= recent[1].timestamp, 'sorted newest first');
});

test('list models', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t14' });
  const all = t.listModels();
  assert(all['openai'].includes('gpt-4o'), 'gpt-4o listed');
  assert(all['anthropic'].length > 0, 'anthropic models listed');
  assert(all['google'].length > 0, 'google models listed');
  
  const filtered = t.listModels('openai');
  assert(Object.keys(filtered).length === 1, 'filtered to one provider');
});

test('provider pricing includes all expected models', () => {
  assert(PRICING['openai']['gpt-4o'], 'gpt-4o exists');
  assert(PRICING['openai']['o1'], 'o1 exists');
  assert(PRICING['anthropic']['claude-sonnet-4-20250514'], 'claude-sonnet-4 exists');
  assert(PRICING['google']['gemini-2.0-flash'], 'gemini-2.0-flash exists');
  assert(PRICING['deepseek']['deepseek-r1'], 'deepseek-r1 exists');
  assert(PRICING['groq']['llama-3.1-8b-instant'], 'groq llama exists');
});

test('unknown provider throws', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t15' });
  let threw = false;
  try {
    t.estimate('nonexistent', 'model', 100, 50);
  } catch (e) {
    threw = true;
    assert(e.message.includes('Unknown provider'), 'error mentions unknown provider');
  }
  assert(threw, 'threw for unknown provider');
});

test('unknown model throws', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t16' });
  let threw = false;
  try {
    t.estimate('openai', 'nonexistent-model', 100, 50);
  } catch (e) {
    threw = true;
    assert(e.message.includes('Unknown model'), 'error mentions unknown model');
  }
  assert(threw, 'threw for unknown model');
});

test('persistence across instances', () => {
  const dir = TEST_DIR + '/t17';
  const t1 = new CostTracker({ dataPath: dir });
  t1.record('openai', 'gpt-4o', 1000, 500);
  t1.setBudget({ daily: 5.0 });
  
  const t2 = new CostTracker({ dataPath: dir });
  assert(t2.allRecords().length === 1, 'records persisted');
  assert(t2.getBudget().daily === 5.0, 'budget persisted');
});

test('period stats filtering', () => {
  const t = new CostTracker({ dataPath: TEST_DIR + '/t18' });
  t.record('openai', 'gpt-4o', 1000, 500);
  t.record('openai', 'gpt-4o-mini', 5000, 2000);
  
  const allTime = t.stats();
  const today = t.stats('day');
  assert(allTime.totalRequests === 2, 'all-time has 2');
  assert(today.totalRequests === 2, 'today has 2 (both just recorded)');
});

// ─── Cleanup ─────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(40)}`);

// Cleanup test dirs
for (let i = 1; i <= 18; i++) {
  const dir = TEST_DIR + '/t' + i;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });

process.exit(failed > 0 ? 1 : 0);
