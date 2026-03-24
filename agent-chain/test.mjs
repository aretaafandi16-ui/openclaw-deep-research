#!/usr/bin/env node
/**
 * agent-chain test suite — 32 tests
 */
import { ReasoningChain, ChainManager, Step, PRESETS } from './index.mjs';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

function test(name, fn) {
  try { fn(); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log('agent-chain test suite\n');

// ─── Step ──────────────────────────────────────────────────────────
test('Step: create with defaults', () => {
  const s = new Step();
  assert(s.id, 'has id');
  assert(s.confidence === 0.5, 'default confidence 0.5');
  assert(s.timestamp > 0, 'has timestamp');
});

test('Step: create with props', () => {
  const s = new Step({ label: 'test', thought: 'thinking', result: 42, confidence: 0.8 });
  assert(s.label === 'test', 'label');
  assert(s.thought === 'thinking', 'thought');
  assert(s.result === 42, 'result');
  assert(s.confidence === 0.8, 'confidence');
});

test('Step: confidence clamped', () => {
  assert(new Step({ confidence: 1.5 }).confidence === 1, 'clamped to 1');
  assert(new Step({ confidence: -0.5 }).confidence === 0, 'clamped to 0');
});

test('Step: toJSON/fromJSON roundtrip', () => {
  const s = new Step({ label: 'x', thought: 'y', confidence: 0.9 });
  s.score = 0.7;
  s.evaluated = true;
  s.tags = ['test'];
  const j = s.toJSON();
  const s2 = Step.fromJSON(j);
  assert(s2.label === 'x', 'label');
  assert(s2.score === 0.7, 'score');
  assert(s2.evaluated === true, 'evaluated');
  assert(s2.tags[0] === 'test', 'tags');
});

// ─── ReasoningChain ────────────────────────────────────────────────
test('ReasoningChain: create', () => {
  const c = new ReasoningChain({ name: 'Test Chain' });
  assert(c.name === 'Test Chain', 'name');
  assert(c.strategy === 'chain-of-thought', 'default strategy');
  assert(c.steps.size === 0, 'no steps');
});

test('ReasoningChain: add steps', () => {
  const c = new ReasoningChain();
  const s1 = c.addStep({ label: 'step1', thought: 'first', confidence: 0.8 });
  const s2 = c.addStep({ label: 'step2', thought: 'second', confidence: 0.7 });
  assert(c.steps.size === 2, '2 steps');
  assert(s2.parentId === s1.id, 'parent linked');
  assert(s1.children.includes(s2.id), 'child linked');
  assert(c.currentStepId === s2.id, 'current step');
  assert(c.rootStepId === s1.id, 'root step');
});

test('ReasoningChain: branching', () => {
  const c = new ReasoningChain();
  const s1 = c.addStep({ label: 'root' });
  const s2 = c.addStep({ label: 'branch-a' });
  c.branch(s1.id, 'alt');
  const s3 = c.addStep({ label: 'branch-b' });
  assert(s3.parentId === s1.id, 'branch from root');
  assert(c.branches.has('alt'), 'branch registered');
  assert(c.steps.get(s1.id).children.length === 2, 'root has 2 children');
});

test('ReasoningChain: backtrack removes descendants', () => {
  const c = new ReasoningChain();
  const s1 = c.addStep({ label: 'step1' });
  const s2 = c.addStep({ label: 'step2' });
  const s3 = c.addStep({ label: 'step3' });
  assert(c.steps.size === 3, '3 steps before');
  c.backtrack(s1.id);
  assert(c.steps.size === 1, '1 step after backtrack');
  assert(c.currentStepId === s1.id, 'current is s1');
});

test('ReasoningChain: evaluate step', () => {
  const c = new ReasoningChain();
  const s = c.addStep({ label: 'test' });
  c.evaluate(s.id, 0.9, 'great reasoning');
  assert(c.steps.get(s.id).score === 0.9, 'score set');
  assert(c.steps.get(s.id).evaluated === true, 'evaluated flag');
});

test('ReasoningChain: conclude', () => {
  const c = new ReasoningChain();
  c.addStep({ label: 'step1', confidence: 0.8 });
  c.conclude('The answer is 42', 0.95);
  assert(c.conclusion === 'The answer is 42', 'conclusion text');
  assert(c.conclusionConfidence === 0.95, 'conclusion confidence');
});

test('ReasoningChain: getPath returns ordered ancestors', () => {
  const c = new ReasoningChain();
  const s1 = c.addStep({ label: 'first' });
  const s2 = c.addStep({ label: 'second' });
  const s3 = c.addStep({ label: 'third' });
  const path = c.getPath(s3.id);
  assert(path.length === 3, '3 steps in path');
  assert(path[0].id === s1.id, 'first in path');
  assert(path[2].id === s3.id, 'last in path');
});

test('ReasoningChain: getTree returns nested structure', () => {
  const c = new ReasoningChain();
  const s1 = c.addStep({ label: 'root' });
  c.addStep({ label: 'child1' });
  c.branch(s1.id);
  c.addStep({ label: 'child2' });
  const tree = c.getTree();
  assert(tree.label === 'root', 'root label');
  assert(tree.children.length === 2, '2 children');
});

test('ReasoningChain: searchBestPath', () => {
  const c = new ReasoningChain();
  const s1 = c.addStep({ label: 'root', confidence: 0.9 });
  c.addStep({ label: 'good', confidence: 0.8 });
  c.branch(s1.id);
  c.addStep({ label: 'bad', confidence: 0.2 });
  const best = c.searchBestPath(s1.id);
  assert(best.path.length >= 2, 'found path');
  assert(best.score > 0, 'has score');
});

test('ReasoningChain: branchAndBound', () => {
  const c = new ReasoningChain();
  c.addStep({ label: 'root', confidence: 0.9 });
  c.addStep({ label: 'a', confidence: 0.8 });
  c.addStep({ label: 'b', confidence: 0.7 });
  const results = c.branchAndBound();
  assert(Array.isArray(results), 'returns array');
  assert(results.length > 0, 'has results');
});

test('ReasoningChain: merge chains', () => {
  const c1 = new ReasoningChain();
  c1.addStep({ label: 'step1', confidence: 0.5 });
  const c2 = new ReasoningChain();
  c2.addStep({ label: 'step2', confidence: 0.9 });
  c1.merge(c2, 'union');
  assert(c1.steps.size === 2, 'merged steps');
});

test('ReasoningChain: toJSON/fromJSON roundtrip', () => {
  const c = new ReasoningChain({ name: 'RT Test', strategy: 'react' });
  c.addStep({ label: 'step1', thought: 'thinking', confidence: 0.8 });
  c.conclude('result', 0.9);
  const j = c.toJSON();
  const c2 = ReasoningChain.fromJSON(j);
  assert(c2.name === 'RT Test', 'name');
  assert(c2.strategy === 'react', 'strategy');
  assert(c2.steps.size === 1, 'steps');
  assert(c2.conclusion === 'result', 'conclusion');
});

test('ReasoningChain: stats', () => {
  const c = new ReasoningChain();
  c.addStep({ label: 'a', confidence: 0.8 });
  c.addStep({ label: 'b', confidence: 0.6 });
  c.conclude('done', 0.7);
  const s = c.stats();
  assert(s.totalSteps === 2, 'total steps');
  assert(s.avgConfidence > 0, 'avg confidence');
  assert(s.conclusion === 'done', 'conclusion');
});

test('ReasoningChain: toMarkdown', () => {
  const c = new ReasoningChain({ name: 'MD Test' });
  c.addStep({ label: 'step1', thought: 'thinking', confidence: 0.8 });
  const md = c.toMarkdown();
  assert(md.includes('# MD Test'), 'has title');
  assert(md.includes('step1'), 'has step');
});

test('ReasoningChain: react step', () => {
  const c = new ReasoningChain();
  const s = c.reactStep({ thought: 'I need to search', action: 'search("test")', observation: 'found results', confidence: 0.7 });
  assert(s.tags.includes('react'), 'react tag');
  assert(s.metadata.type === 'react', 'react metadata');
  assert(s.result.action === 'search("test")', 'action');
});

test('ReasoningChain: maxDepth setting', () => {
  const c = new ReasoningChain({ maxDepth: 5 });
  assert(c.maxDepth === 5, 'maxDepth set');
});

test('ReasoningChain: confidenceThreshold', () => {
  const c = new ReasoningChain({ confidenceThreshold: 0.9 });
  assert(c.confidenceThreshold === 0.9, 'threshold set');
});

// ─── ChainManager ──────────────────────────────────────────────────
test('ChainManager: create and list', () => {
  const m = new ChainManager();
  m.create({ name: 'chain1' });
  m.create({ name: 'chain2' });
  assert(m.list().length === 2, '2 chains');
});

test('ChainManager: get', () => {
  const m = new ChainManager();
  const c = m.create({ name: 'test' });
  assert(m.get(c.id) === c, 'found by id');
  assert(m.get('nonexistent') === null, 'null for missing');
});

test('ChainManager: remove', () => {
  const m = new ChainManager();
  const c = m.create({ name: 'temp' });
  assert(m.remove(c.id) === true, 'removed');
  assert(m.get(c.id) === null, 'gone');
  assert(m.remove('nonexistent') === false, 'false for missing');
});

test('ChainManager: search', () => {
  const m = new ChainManager();
  const c = m.create({ name: 'Weather Analysis' });
  c.addStep({ label: 'forecast', thought: 'predicting rain' });
  assert(m.search('weather').length === 1, 'found weather');
  assert(m.search('rain').length === 1, 'found rain');
  assert(m.search('nonexistent').length === 0, 'not found');
});

test('ChainManager: globalStats', () => {
  const m = new ChainManager();
  m.create({ name: 'a' });
  m.create({ name: 'b' });
  const s = m.globalStats();
  assert(s.totalChains === 2, '2 chains');
});

test('ChainManager: events', () => {
  const m = new ChainManager();
  let createFired = false;
  m.on('create', () => { createFired = true; });
  m.create({ name: 'evt' });
  assert(createFired, 'create event fired');
});

test('ChainManager: events on step', () => {
  const m = new ChainManager();
  let stepFired = false;
  m.on('step', () => { stepFired = true; });
  const c = m.create({ name: 'evt2' });
  c.addStep({ label: 'test' });
  assert(stepFired, 'step event propagated');
});

// ─── Presets ───────────────────────────────────────────────────────
test('PRESETS: all presets exist', () => {
  assert(PRESETS['chain-of-thought'], 'chain-of-thought');
  assert(PRESETS['tree-of-thought'], 'tree-of-thought');
  assert(PRESETS['self-consistency'], 'self-consistency');
  assert(PRESETS['react'], 'react');
  assert(PRESETS['decompose'], 'decompose');
  assert(PRESETS['verify'], 'verify');
});

// ─── Self-consistency ──────────────────────────────────────────────
test('selfConsistency: picks best chain', () => {
  const c1 = new ReasoningChain();
  c1.conclude('answer A', 0.6);
  const c2 = new ReasoningChain();
  c2.conclude('answer B', 0.9);
  const best = ReasoningChain.selfConsistency([c1, c2]);
  assert(best === c2, 'picked highest confidence');
});

// ─── Depth calculation ─────────────────────────────────────────────
test('ReasoningChain: depth calculation', () => {
  const c = new ReasoningChain();
  c.addStep({ label: 'd0' });
  c.addStep({ label: 'd1' });
  c.addStep({ label: 'd2' });
  assert(c.stats().depth === 2, 'depth 2');
});

// ─── Autoscore ─────────────────────────────────────────────────────
test('ReasoningChain: autoscore boosts confidence', () => {
  const c = new ReasoningChain({ autoscore: true });
  const longThought = 'a'.repeat(600);
  const s = c.addStep({ label: 'test', thought: longThought, confidence: 0.5 });
  assert(s.confidence > 0.5, 'confidence boosted');
});

// ─── Summary ───────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed out of ${pass + fail} tests`);
process.exit(fail > 0 ? 1 : 0);
