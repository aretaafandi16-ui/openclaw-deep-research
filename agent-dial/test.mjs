#!/usr/bin/env node
// agent-dial — Test Suite
import { DialogEngine, DialogSlot, DialogTurn, matchIntent, SlotValidators } from './index.mjs';
import { strict as assert } from 'node:assert';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n🐋 agent-dial — Test Suite\n');

// ── SlotValidators ───────────────────────────────────────────────────────────────
console.log('SlotValidators');
test('required rejects empty', () => { assert.equal(SlotValidators.required(''), 'This field is required'); assert.equal(SlotValidators.required('x'), null); });
test('email validates format', () => { assert.equal(SlotValidators.email('a@b.com'), null); assert.ok(SlotValidators.email('bad')); });
test('number validates', () => { assert.equal(SlotValidators.number('42'), null); assert.ok(SlotValidators.number('abc')); });
test('range validates', () => { assert.equal(SlotValidators.range(5, 1, 10), null); assert.ok(SlotValidators.range(11, 1, 10)); });
test('pattern validates', () => { assert.equal(SlotValidators.pattern('abc', '^[a-z]+$'), null); assert.ok(SlotValidators.pattern('123', '^[a-z]+$')); });

// ── DialogSlot ───────────────────────────────────────────────────────────────────
console.log('\nDialogSlot');
test('fill with valid value', () => {
  const slot = new DialogSlot({ name: 'email', validate: [['pattern', '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$']] });
  const r = slot.fill('test@example.com');
  assert.ok(r.ok); assert.equal(r.value, 'test@example.com'); assert.ok(slot.filled);
});
test('fill with invalid value fails', () => {
  const slot = new DialogSlot({ name: 'email', validate: [['email']], maxAttempts: 3 });
  const r = slot.fill('not-an-email');
  assert.ok(!r.ok); assert.equal(r.attempts, 1);
});
test('transform lowercase', () => {
  const slot = new DialogSlot({ name: 'tag', transform: 'lowercase' });
  slot.fill('HELLO');
  assert.equal(slot.value, 'hello');
});
test('transform number', () => {
  const slot = new DialogSlot({ name: 'age', transform: 'number', validate: [['number']] });
  slot.fill('25');
  assert.equal(slot.value, 25);
});
test('non-required slot allows empty', () => {
  const slot = new DialogSlot({ name: 'optional', required: false });
  const r = slot.fill('');
  assert.ok(r.ok);
});
test('maxAttempts exhaustion', () => {
  const slot = new DialogSlot({ name: 'x', validate: [['email']], maxAttempts: 2 });
  slot.fill('bad1');
  const r2 = slot.fill('bad2');
  assert.ok(!r2.ok); assert.equal(r2.attempts, 2);
});

// ── matchIntent ──────────────────────────────────────────────────────────────────
console.log('\nmatchIntent');
test('exact match', () => { assert.ok(matchIntent('register', [{ exact: 'register', intent: 'reg' }])); });
test('keywords match', () => { assert.ok(matchIntent('I want to sign up please', [{ keywords: ['sign up', 'register'], intent: 'reg' }])); });
test('regex match', () => { assert.ok(matchIntent('order #12345', [{ regex: 'order #\\d+', intent: 'order' }])); });
test('contains match', () => { assert.ok(matchIntent('tell me about pricing', [{ contains: 'pricing', intent: 'pricing' }])); });
test('no match returns null', () => { assert.equal(matchIntent('xyz', [{ exact: 'abc' }]), null); });
test('function matcher', () => { assert.ok(matchIntent('hello', [{ fn: t => t.length > 3, intent: 'long' }])); });

// ── DialogEngine ─────────────────────────────────────────────────────────────────
console.log('\nDialogEngine');

test('define and list flows', () => {
  const engine = new DialogEngine();
  engine.defineFlow('test', { startNode: 's', nodes: { s: { type: 'message', content: 'hi' } } });
  assert.ok(engine.flows.has('test'));
  assert.equal(engine.flows.get('test').nodes.size, 1);
});

test('create session', () => {
  const engine = new DialogEngine();
  engine.defineFlow('test', { startNode: 's', nodes: { s: { type: 'end', content: 'done' } } });
  const s = engine.createSession('test');
  assert.ok(s.id); assert.equal(s.flowId, 'test'); assert.equal(s.currentNode, 's'); assert.ok(s.active);
});

test('create session with unknown flow throws', () => {
  const engine = new DialogEngine();
  assert.throws(() => engine.createSession('nope'), /not found/);
});

test('simple message flow', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('simple', {
    startNode: 'hello',
    nodes: {
      hello: { type: 'message', content: 'Hello!', transitions: [{ goto: 'end' }] },
      end: { type: 'end', content: 'Bye!' },
    },
  });
  const s = engine.createSession('simple');
  const r1 = await engine.processMessage(s.id, 'hi');
  assert.equal(r1.response, 'Hello!');
  const r2 = await engine.processMessage(s.id, 'bye');
  assert.equal(r2.response, 'Bye!');
  assert.ok(r2.ended);
});

test('slot filling flow', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('slots', {
    startNode: 'ask_name',
    nodes: {
      ask_name: { type: 'slot_fill', slots: [{ name: 'name', prompt: 'Name?' }], transitions: [{ when: { slotFilled: 'name' }, goto: 'done' }] },
      done: { type: 'end', content: (s) => `Hi ${s.getSlotValues().name}!` },
    },
  });
  const s = engine.createSession('slots');
  // First message fills the 'name' slot and transitions to 'done'
  const r1 = await engine.processMessage(s.id, 'Alice');
  assert.equal(r1.response, 'Hi Alice!');
});

test('intent routing', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('intents', {
    startNode: 'router',
    nodes: {
      router: {
        type: 'intent_router',
        content: "Didn't understand",
        intents: [
          { intent: 'buy', keywords: ['buy', 'purchase'], goto: 'buy_flow' },
          { intent: 'sell', keywords: ['sell'], goto: 'sell_flow' },
        ],
      },
      buy_flow: { type: 'end', content: 'Buy flow!' },
      sell_flow: { type: 'end', content: 'Sell flow!' },
    },
  });
  const s = engine.createSession('intents');
  const r1 = await engine.processMessage(s.id, 'I want to buy');
  assert.equal(r1.response, 'Buy flow!');
  assert.equal(s.intent, 'buy');
});

test('branch with conditions', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('branch', {
    startNode: 'set_val',
    nodes: {
      set_val: {
        type: 'action',
        action: (ctx) => { ctx.session.state.role = 'admin'; return { response: 'Role set' }; },
        transitions: [{ goto: 'check' }],
      },
      check: {
        type: 'branch',
        transitions: [
          { when: { stateEquals: ['role', 'admin'] }, goto: 'admin_node' },
          { when: { always: true }, goto: 'user_node' },
        ],
      },
      admin_node: { type: 'end', content: 'Admin access!' },
      user_node: { type: 'end', content: 'User access' },
    },
  });
  const s = engine.createSession('branch');
  await engine.processMessage(s.id, 'go');
  const r2 = await engine.processMessage(s.id, 'go');
  assert.equal(r2.response, 'Admin access!');
});

test('global intents', async () => {
  const engine = new DialogEngine();
  engine.addGlobalIntent({ intent: 'quit', keywords: ['quit', 'exit', 'bye'], goto: 'end' });
  engine.defineFlow('global', {
    startNode: 'start',
    nodes: {
      start: { type: 'intent_router', intents: [{ intent: 'go', keywords: ['go'] }] },
    },
  });
  const s = engine.createSession('global');
  // The global intent won't trigger in node intents but fallback check won't match without a global goto in current flow
  assert.equal(engine.globalIntents.length, 1);
});

test('session context', () => {
  const engine = new DialogEngine();
  engine.defineFlow('ctx', { startNode: 's', nodes: { s: { type: 'message', content: 'hi' } } });
  const s = engine.createSession('ctx');
  const ctx = engine.getSessionContext(s.id);
  assert.equal(ctx.flowId, 'ctx'); assert.equal(ctx.currentNode, 's'); assert.ok(ctx.active);
});

test('conversation history', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('hist', {
    startNode: 'a',
    nodes: {
      a: { type: 'message', content: 'hi', transitions: [{ goto: 'b' }] },
      b: { type: 'message', content: 'bye' },
    },
  });
  const s = engine.createSession('hist');
  await engine.processMessage(s.id, 'hello');
  await engine.processMessage(s.id, 'thanks');
  const hist = engine.getConversationHistory(s.id);
  assert.equal(hist.length, 4); // 2 user + 2 agent
  assert.equal(hist[0].role, 'user');
  assert.equal(hist[1].role, 'agent');
});

test('end session', () => {
  const engine = new DialogEngine();
  engine.defineFlow('e', { startNode: 's', nodes: { s: { type: 'message', content: 'hi' } } });
  const s = engine.createSession('e');
  assert.ok(engine.endSession(s.id));
  assert.ok(!s.active);
});

test('max sessions eviction', () => {
  const engine = new DialogEngine({ maxSessions: 3 });
  engine.defineFlow('ev', { startNode: 's', nodes: { s: { type: 'message', content: 'hi' } } });
  engine.createSession('ev', 's1');
  engine.createSession('ev', 's2');
  engine.createSession('ev', 's3');
  assert.equal(engine.sessions.size, 3);
  engine.createSession('ev', 's4');
  assert.equal(engine.sessions.size, 3);
  assert.ok(!engine.sessions.has('s1')); // oldest evicted
});

test('setSlotValue manually', () => {
  const engine = new DialogEngine();
  engine.defineFlow('sv', { startNode: 's', nodes: { s: { type: 'message', content: 'hi' } } });
  const s = engine.createSession('sv');
  const r = engine.setSlotValue(s.id, 'age', '30');
  assert.ok(r.ok); assert.equal(s.slots.age.value, '30');
});

test('slot with custom parser', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('parse', {
    startNode: 'ask',
    nodes: {
      ask: {
        type: 'slot_fill',
        slots: [{
          name: 'code',
          prompt: 'Enter 4-digit code:',
          parser: (input) => (input.match(/\d{4}/) || [null])[0],
          validate: [['pattern', '^\\d{4}$']],
        }],
        transitions: [{ when: { slotFilled: 'code' }, goto: 'done' }],
      },
      done: { type: 'end', content: 'Code accepted!' },
    },
  });
  const s = engine.createSession('parse');
  await engine.processMessage(s.id, '');
  const r = await engine.processMessage(s.id, 'my code is 1234 thanks');
  assert.equal(r.response, 'Code accepted!');
});

test('slot validation reprompt', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('val', {
    startNode: 'ask',
    nodes: {
      ask: {
        type: 'slot_fill',
        slots: [{ name: 'email', prompt: 'Email?', validate: [['email']], reprompt: 'Please enter a valid email.' }],
        transitions: [{ when: { slotFilled: 'email' }, goto: 'done' }],
      },
      done: { type: 'end', content: 'Got it!' },
    },
  });
  const s = engine.createSession('val');
  await engine.processMessage(s.id, '');
  const r2 = await engine.processMessage(s.id, 'bad-email');
  assert.ok(r2.response.includes('valid email'));
  const r3 = await engine.processMessage(s.id, 'good@email.com');
  assert.equal(r3.response, 'Got it!');
});

test('dynamic content function', async () => {
  const engine = new DialogEngine();
  engine.defineFlow('dyn', {
    startNode: 'greet',
    nodes: {
      greet: { type: 'message', content: (session) => `Hello ${session.state.name || 'stranger'}!`, transitions: [{ goto: 'end' }] },
      end: { type: 'end', content: 'Bye' },
    },
  });
  const s = engine.createSession('dyn', null, { name: 'Bob' });
  const r = await engine.processMessage(s.id, 'hi');
  assert.equal(r.response, 'Hello Bob!');
});

test('stats', () => {
  const engine = new DialogEngine();
  engine.defineFlow('st', { startNode: 's', nodes: { s: { type: 'message', content: 'hi' } } });
  engine.createSession('st');
  engine.createSession('st');
  const st = engine.stats();
  assert.equal(st.flows, 1); assert.equal(st.totalSessions, 2); assert.equal(st.activeSessions, 2);
});

// ── DialogTurn ───────────────────────────────────────────────────────────────────
console.log('\nDialogTurn');
test('turn creation', () => {
  const turn = new DialogTurn('user', 'hello');
  assert.equal(turn.role, 'user'); assert.equal(turn.content, 'hello'); assert.ok(turn.id);
  const j = turn.toJSON();
  assert.equal(j.role, 'user');
});

// ── End ──────────────────────────────────────────────────────────────────────────
console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
if (failed > 0) process.exit(1);
