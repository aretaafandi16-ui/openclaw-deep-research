#!/usr/bin/env node
/**
 * agent-context test suite
 */

import { ContextManager, estimateTokens, estimateMessageTokens, MODEL_PRESETS, createContextForModel } from './index.mjs';
import assert from 'assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

console.log('agent-context tests\n');

// ─── Token Estimation ───────────────────────────────────────────────────────

console.log('Token Estimation');

test('estimateTokens: empty string', () => {
  assert.strictEqual(estimateTokens(''), 0);
});

test('estimateTokens: simple text', () => {
  const tokens = estimateTokens('Hello world');
  assert(tokens > 0 && tokens < 10);
});

test('estimateTokens: long text', () => {
  const tokens = estimateTokens('a'.repeat(400));
  assert(tokens > 80 && tokens < 120); // ~100 tokens for 400 chars
});

test('estimateTokens: CJK characters', () => {
  const ascii = estimateTokens('a'.repeat(10));
  const cjk = estimateTokens('你好世界测试');
  // CJK should use fewer chars per token
  assert(cjk > 0);
});

test('estimateTokens: code patterns', () => {
  const tokens = estimateTokens('fn main() { let x = 1 + 2; }');
  assert(tokens > 0);
});

test('estimateMessageTokens: basic message', () => {
  const tokens = estimateMessageTokens({ role: 'user', content: 'Hello' });
  assert(tokens > 4); // overhead + content
});

test('estimateMessageTokens: tool calls', () => {
  const tokens = estimateMessageTokens({
    role: 'assistant',
    content: null,
    tool_calls: [{ function: { name: 'test', arguments: '{}' } }],
  });
  assert(tokens > 10);
});

// ─── Model Presets ──────────────────────────────────────────────────────────

console.log('\nModel Presets');

test('all presets have required fields', () => {
  for (const [name, preset] of Object.entries(MODEL_PRESETS)) {
    assert(preset.maxTokens > 0, `${name} missing maxTokens`);
    assert(preset.reserveOutput > 0, `${name} missing reserveOutput`);
  }
});

test('createContextForModel: gpt-4o', () => {
  const ctx = createContextForModel('gpt-4o');
  assert.strictEqual(ctx.maxTokens, 128000);
  assert.strictEqual(ctx.model, 'gpt-4o');
});

test('createContextForModel: claude-3-opus', () => {
  const ctx = createContextForModel('claude-3-opus');
  assert.strictEqual(ctx.maxTokens, 200000);
});

test('createContextForModel: unknown model throws', () => {
  assert.throws(() => createContextForModel('nonexistent'), /Unknown model/);
});

// ─── Context Manager: Basic ─────────────────────────────────────────────────

console.log('\nContext Manager: Basic');

test('add message', () => {
  const ctx = new ContextManager();
  const msg = ctx.add({ role: 'user', content: 'Hello' });
  assert(msg._id);
  assert(msg._tokens > 0);
  assert.strictEqual(ctx.messages.length, 1);
});

test('addSystem', () => {
  const ctx = new ContextManager();
  const msg = ctx.addSystem('You are helpful');
  assert.strictEqual(msg.role, 'system');
  assert(msg._persistent);
  assert.strictEqual(msg._priority, 100);
});

test('addUser', () => {
  const ctx = new ContextManager();
  const msg = ctx.addUser('Hello');
  assert.strictEqual(msg.role, 'user');
});

test('addAssistant', () => {
  const ctx = new ContextManager();
  const msg = ctx.addAssistant('Hi there');
  assert.strictEqual(msg.role, 'assistant');
});

test('addToolResult', () => {
  const ctx = new ContextManager();
  const msg = ctx.addToolResult('call_123', '{"result": 42}');
  assert.strictEqual(msg.role, 'tool');
  assert.strictEqual(msg.tool_call_id, 'call_123');
});

test('remove message', () => {
  const ctx = new ContextManager();
  const msg = ctx.addUser('Hello');
  assert.strictEqual(ctx.messages.length, 1);
  ctx.remove(msg._id);
  assert.strictEqual(ctx.messages.length, 0);
});

test('clear (keeps persistent)', () => {
  const ctx = new ContextManager();
  ctx.addSystem('Keep me');
  ctx.addUser('Remove me');
  ctx.clear(true);
  assert.strictEqual(ctx.messages.length, 1);
  assert.strictEqual(ctx.messages[0].role, 'system');
});

test('clear (removes all)', () => {
  const ctx = new ContextManager();
  ctx.addSystem('System');
  ctx.addUser('User');
  ctx.clear(false);
  assert.strictEqual(ctx.messages.length, 0);
});

// ─── Context Manager: Token Tracking ────────────────────────────────────────

console.log('\nToken Tracking');

test('inputTokens updates on add', () => {
  const ctx = new ContextManager();
  assert.strictEqual(ctx.inputTokens, 0);
  ctx.addUser('Hello world');
  assert(ctx.inputTokens > 0);
});

test('availableTokens', () => {
  const ctx = new ContextManager({ maxTokens: 1000, reserveOutput: 200 });
  assert.strictEqual(ctx.availableTokens, 800);
});

test('remainingTokens', () => {
  const ctx = new ContextManager({ maxTokens: 1000, reserveOutput: 200 });
  ctx.addUser('Hello');
  assert(ctx.remainingTokens < 800);
});

test('utilizationPercent', () => {
  const ctx = new ContextManager({ maxTokens: 100, reserveOutput: 0 });
  ctx.addUser('Hello world this is a test message');
  assert(ctx.utilizationPercent > 0 && ctx.utilizationPercent <= 100);
});

// ─── Context Manager: Get Messages ──────────────────────────────────────────

console.log('\nGet Messages');

test('getMessages returns all when under budget', () => {
  const ctx = new ContextManager({ maxTokens: 100000 });
  ctx.addSystem('System');
  ctx.addUser('Hello');
  ctx.addAssistant('Hi');
  const msgs = ctx.getMessages();
  assert.strictEqual(msgs.length, 3);
});

test('getMessages truncates with sliding_window', () => {
  const ctx = new ContextManager({ maxTokens: 500, reserveOutput: 0 });
  ctx.addSystem('System prompt');
  for (let i = 0; i < 50; i++) {
    ctx.addUser(`Message ${i}: This is a somewhat longer message to consume tokens.`);
  }
  const msgs = ctx.getMessages({ strategy: 'sliding_window', maxTokens: 300 });
  assert(msgs.length < 50);
  assert(msgs.some(m => m.role === 'system')); // system preserved
});

test('getMessages truncates with priority', () => {
  const ctx = new ContextManager({ maxTokens: 500, reserveOutput: 0 });
  ctx.addSystem('System');
  ctx.addUser('Important', { priority: 90 });
  for (let i = 0; i < 20; i++) {
    ctx.addUser(`Low priority message ${i}`);
  }
  const msgs = ctx.getMessages({ strategy: 'priority', maxTokens: 300 });
  // Important message should be preserved due to high priority
  assert(msgs.some(m => m.content === 'Important'));
});

test('getMessages with summarize strategy', () => {
  const ctx = new ContextManager({ maxTokens: 500, reserveOutput: 0 });
  ctx.addSystem('System');
  for (let i = 0; i < 30; i++) {
    ctx.addUser(`Message ${i}: This is a longer message with substantial content that will consume tokens and force truncation when the budget is tight enough that not all messages can fit.`);
  }
  const msgs = ctx.getMessages({ strategy: 'summarize', maxTokens: 200 });
  assert(msgs.length < 30);
  // Should have a summary message
  assert(msgs.some(m => m._isSummary));
});

test('last(n)', () => {
  const ctx = new ContextManager();
  for (let i = 0; i < 10; i++) ctx.addUser(`msg ${i}`);
  const last3 = ctx.last(3);
  assert.strictEqual(last3.length, 3);
  assert(last3[2].content.includes('msg 9'));
});

test('find by role', () => {
  const ctx = new ContextManager();
  ctx.addSystem('System');
  ctx.addUser('User 1');
  ctx.addUser('User 2');
  const users = ctx.find('user');
  assert.strictEqual(users.length, 2);
});

test('find by predicate', () => {
  const ctx = new ContextManager();
  ctx.addUser('hello', { _tags: ['greeting'] });
  ctx.addUser('bye', { _tags: ['farewell'] });
  const found = ctx.find(m => m._tags.includes('greeting'));
  assert.strictEqual(found.length, 1);
});

// ─── Compression ────────────────────────────────────────────────────────────

console.log('\nCompression');

test('compress: strip whitespace', () => {
  const ctx = new ContextManager();
  ctx.addUser('Hello\n\n\n\n\n\nWorld');
  const result = ctx.compress({ stripWhitespace: true, deduplicate: false });
  assert(result.saved >= 0);
});

test('compress: deduplicate', () => {
  const ctx = new ContextManager();
  ctx.addUser('Same message');
  ctx.addUser('Same message');
  ctx.addUser('Same message');
  const result = ctx.compress({ deduplicate: true });
  assert.strictEqual(ctx.messages.length, 1);
});

test('compress: merge consecutive', () => {
  const ctx = new ContextManager();
  ctx.addUser('Part 1');
  ctx.addUser('Part 2');
  ctx.compress({ mergeConsecutive: true });
  assert.strictEqual(ctx.messages.length, 1);
  assert(ctx.messages[0].content.includes('Part 1'));
  assert(ctx.messages[0].content.includes('Part 2'));
});

// ─── Budgets ────────────────────────────────────────────────────────────────

console.log('\nBudgets');

test('setBudgets', () => {
  const ctx = new ContextManager();
  ctx.setBudgets({ system: 500, tools: 1000, conversation: 5000 });
  assert.strictEqual(ctx.budgets.system, 500);
});

test('getBudgetBreakdown', () => {
  const ctx = new ContextManager();
  ctx.addSystem('System');
  ctx.addUser('User');
  const breakdown = ctx.getBudgetBreakdown();
  assert(breakdown.system.used > 0);
  assert(breakdown.conversation.used > 0);
});

test('enforceBudgets', () => {
  const ctx = new ContextManager();
  ctx.setBudgets({ conversation: 200 });
  ctx.addSystem('System');
  for (let i = 0; i < 20; i++) ctx.addUser(`Message ${i}: some longer content here`);
  const result = ctx.enforceBudgets();
  assert(result.conversation.used <= 200 || ctx.messages.length < 21);
});

// ─── Tool Definitions ───────────────────────────────────────────────────────

console.log('\nTool Definitions');

test('setToolDefinitions', () => {
  const ctx = new ContextManager();
  ctx.setToolDefinitions([
    { name: 'search', description: 'Search the web' },
    { name: 'calc', description: 'Calculate' },
  ]);
  assert.strictEqual(ctx._toolDefinitions.length, 2);
  assert(ctx._toolDefTokens > 0);
});

// ─── Statistics ─────────────────────────────────────────────────────────────

console.log('\nStatistics');

test('getStats structure', () => {
  const ctx = new ContextManager();
  ctx.addSystem('System');
  ctx.addUser('User');
  const stats = ctx.getStats();
  assert.strictEqual(stats.messageCount, 2);
  assert(stats.roleCounts.system === 1);
  assert(stats.roleCounts.user === 1);
  assert(stats.totalAdded >= 2);
  assert(stats.peakTokens > 0);
});

test('getTokenBreakdown', () => {
  const ctx = new ContextManager();
  ctx.addUser('Test');
  const breakdown = ctx.getTokenBreakdown();
  assert.strictEqual(breakdown.length, 1);
  assert(breakdown[0].tokens > 0);
  assert(breakdown[0].role === 'user');
});

// ─── Templates ──────────────────────────────────────────────────────────────

console.log('\nTemplates');

test('applyTemplate: chat', () => {
  const ctx = new ContextManager();
  ctx.applyTemplate('chat');
  assert.strictEqual(ctx.messages.length, 1);
  assert(ctx.messages[0].content.includes('helpful'));
});

test('applyTemplate: coding', () => {
  const ctx = new ContextManager();
  ctx.applyTemplate('coding');
  assert(ctx.messages[0].content.includes('programmer'));
});

test('applyTemplate: with vars', () => {
  const ctx = new ContextManager();
  ctx.applyTemplate('agent', { systemPrompt: 'Custom agent prompt' });
  assert(ctx.messages[0].content.includes('Custom agent prompt'));
});

test('applyTemplate: unknown throws', () => {
  const ctx = new ContextManager();
  assert.throws(() => ctx.applyTemplate('nonexistent'), /Unknown template/);
});

// ─── Export/Import ──────────────────────────────────────────────────────────

console.log('\nExport/Import');

test('export/import round-trip', () => {
  const ctx1 = new ContextManager({ model: 'gpt-4o' });
  ctx1.addSystem('System');
  ctx1.addUser('User');
  const data = ctx1.export();
  
  const ctx2 = new ContextManager();
  ctx2.import(data);
  assert.strictEqual(ctx2.messages.length, 2);
  assert.strictEqual(ctx2.model, 'gpt-4o');
});

test('clone', () => {
  const ctx = new ContextManager({ model: 'gpt-4o' });
  ctx.addUser('Hello');
  const clone = ctx.clone();
  assert.strictEqual(clone.messages.length, 1);
  assert.strictEqual(clone.model, 'gpt-4o');
  clone.addUser('World');
  assert.strictEqual(ctx.messages.length, 1); // original unchanged
});

// ─── Events ─────────────────────────────────────────────────────────────────

console.log('\nEvents');

test('emits message:added', (done) => {
  const ctx = new ContextManager();
  let emitted = false;
  ctx.on('message:added', () => { emitted = true; });
  ctx.addUser('Test');
  assert(emitted);
});

test('emits message:removed', () => {
  const ctx = new ContextManager();
  let emitted = false;
  ctx.on('message:removed', () => { emitted = true; });
  const msg = ctx.addUser('Test');
  ctx.remove(msg._id);
  assert(emitted);
});

test('emits truncated', () => {
  const ctx = new ContextManager({ maxTokens: 500, reserveOutput: 0 });
  let emitted = false;
  ctx.on('truncated', () => { emitted = true; });
  ctx.addSystem('System');
  for (let i = 0; i < 30; i++) ctx.addUser(`Message ${i} with enough content to fill the window`);
  ctx.getMessages({ maxTokens: 200 });
  assert(emitted);
});

test('emits compressed', () => {
  const ctx = new ContextManager();
  let emitted = false;
  ctx.on('compressed', () => { emitted = true; });
  ctx.addUser('Test');
  ctx.compress();
  assert(emitted);
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

console.log('\nEdge Cases');

test('empty context', () => {
  const ctx = new ContextManager();
  assert.strictEqual(ctx.inputTokens, 0);
  assert.strictEqual(ctx.getMessages().length, 0);
});

test('very long message', () => {
  const ctx = new ContextManager();
  const long = 'word '.repeat(10000);
  const msg = ctx.addUser(long);
  assert(msg._tokens > 1000);
});

test('messages with complex content', () => {
  const ctx = new ContextManager();
  const msg = ctx.add({
    role: 'user',
    content: [
      { type: 'text', text: 'Analyze this' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ],
  });
  assert(msg._tokens > 80); // image tokens included
});

test('getRange', () => {
  const ctx = new ContextManager();
  for (let i = 0; i < 10; i++) ctx.addUser(`msg ${i}`);
  const range = ctx.getRange(2, 5);
  assert.strictEqual(range.length, 3);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log('All tests passed! ✅');
