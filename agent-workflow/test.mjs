import { Workflow, WorkflowRegistry, WorkflowContext, validateDAG, topoSort, uuid } from './index.mjs';
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0, failed = 0;
function ok(name, fn) {
  return test(name, async () => {
    try { await fn(); passed++; }
    catch (e) { failed++; throw e; }
  });
}

describe('UUID', () => {
  ok('generates valid UUID v4', () => {
    const id = uuid();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  ok('generates unique UUIDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    assert.equal(ids.size, 100);
  });
});

describe('DAG Validation', () => {
  ok('accepts valid DAG', () => {
    assert.doesNotThrow(() => validateDAG([
      { id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a'] }, { id: 'd', dependsOn: ['b', 'c'] }
    ]));
  });
  ok('rejects cycle', () => {
    assert.throws(() => validateDAG([
      { id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }
    ]), /cycle/i);
  });
  ok('rejects missing dependency', () => {
    assert.throws(() => validateDAG([
      { id: 'a', dependsOn: ['missing'] }
    ]), /unknown/i);
  });
  ok('rejects duplicate ids', () => {
    assert.throws(() => new Workflow({ name: 't', steps: [{ id: 'a' }, { id: 'a' }] }), /Duplicate/i);
  });
});

describe('Topological Sort', () => {
  ok('sorts linear chain', () => {
    const levels = topoSort([
      { id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] }
    ]);
    assert.equal(levels.length, 3);
    assert.deepEqual(levels[0].map(s => s.id), ['a']);
    assert.deepEqual(levels[1].map(s => s.id), ['b']);
    assert.deepEqual(levels[2].map(s => s.id), ['c']);
  });
  ok('groups parallel steps', () => {
    const levels = topoSort([
      { id: 'a' }, { id: 'b' }, { id: 'c', dependsOn: ['a', 'b'] }
    ]);
    assert.equal(levels.length, 2);
    assert.equal(levels[0].length, 2);
    assert.deepEqual(levels[1].map(s => s.id), ['c']);
  });
});

describe('Workflow Context', () => {
  ok('stores and retrieves data', () => {
    const ctx = new WorkflowContext({ foo: 'bar' });
    assert.equal(ctx.get('foo'), 'bar');
    ctx.set('key', 'val');
    assert.equal(ctx.get('key'), 'val');
  });
  ok('serializes to JSON', () => {
    const ctx = new WorkflowContext({ x: 1 });
    ctx.set('y', 2);
    ctx.outputs.set('a', { result: true });
    const j = ctx.toJSON();
    assert.equal(j.data.x, 1);
    assert.equal(j.vars.y, 2);
    assert.deepEqual(j.outputs.a, { result: true });
  });
});

describe('Workflow Execution', () => {
  ok('runs single task', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => 42 }
    ]});
    const result = await wf.run();
    assert.equal(result.status, 'completed');
    assert.equal(result.results.a.result, 42);
  });

  ok('runs linear chain', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => 10 },
      { id: 'b', type: 'task', dependsOn: ['a'], run: async (ctx) => ctx.outputs.get('a') * 2 },
    ]});
    const result = await wf.run();
    assert.equal(result.results.b.result, 20);
  });

  ok('runs parallel steps', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => 'a' },
      { id: 'b', type: 'task', run: async () => 'b' },
      { id: 'c', type: 'task', dependsOn: ['a', 'b'], run: async (ctx) => ctx.outputs.get('a') + ctx.outputs.get('b') },
    ]});
    const result = await wf.run();
    assert.equal(result.results.c.result, 'ab');
  });

  ok('handles transform type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => ({ val: 5 }) },
      { id: 'b', type: 'transform', dependsOn: ['a'], input: 'a', transform: async (input) => ({ doubled: input.val * 2 }) },
    ]});
    const result = await wf.run();
    assert.deepEqual(result.results.b.result, { doubled: 10 });
  });

  ok('handles condition type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'condition', condition: async () => true },
    ]});
    const result = await wf.run();
    assert.deepEqual(result.results.a.result, { branch: 'true' });
  });

  ok('handles loop type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'loop', type: 'loop', condition: async (_ctx, i) => i < 3, run: async (_ctx, i) => i * 10 },
    ]});
    const result = await wf.run();
    assert.deepEqual(result.results.loop.result, [0, 10, 20]);
  });

  ok('handles log type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'log', type: 'log', message: 'hello' },
    ]});
    const result = await wf.run();
    assert.equal(result.results.log.result, 'hello');
  });

  ok('handles set type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'set', type: 'set', key: 'myKey', value: 'myVal' },
    ]});
    const result = await wf.run();
    assert.equal(result.results.set.result, 'myVal');
    assert.equal(result.outputs.vars.myKey, 'myVal');
  });

  ok('handles delay type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'd', type: 'delay', ms: 50 },
    ]});
    const start = Date.now();
    const result = await wf.run();
    assert.ok(Date.now() - start >= 40);
  });

  ok('handles assert type', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'set', type: 'set', key: 'x', value: 5 },
      { id: 'assert', type: 'assert', dependsOn: ['set'], assert: async (ctx) => ctx.get('x') === 5 },
    ]});
    const result = await wf.run();
    assert.equal(result.status, 'completed');
  });

  ok('retries on failure', async () => {
    let count = 0;
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', retries: 2, run: async () => { count++; if (count < 3) throw new Error('fail'); return 'ok'; } },
    ]});
    const result = await wf.run();
    assert.equal(result.results.a.result, 'ok');
    assert.equal(result.results.a.attempts, 3);
  });

  ok('handles fallback', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => { throw new Error('fail'); },
        fallback: async () => 'fallback_value' },
    ]});
    const result = await wf.run();
    assert.equal(result.results.a.result, 'fallback_value');
    assert.ok(result.results.a.fallback);
  });

  ok('handles when predicate', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => 'ran' },
      { id: 'b', type: 'task', dependsOn: ['a'], when: async () => false, run: async () => 'should not run' },
    ]});
    const result = await wf.run();
    assert.equal(result.results.a.result, 'ran');
    assert.ok(result.results.b.skipped);
  });

  ok('handles failure with no fallback', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => { throw new Error('boom'); } },
    ]});
    const result = await wf.run();
    assert.equal(result.status, 'failed');
    assert.ok(result.error);
  });

  ok('passes data to workflow', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async (ctx) => ctx.data.input * 2 },
    ]});
    const result = await wf.run({ input: 21 });
    assert.equal(result.results.a.result, 42);
  });
});

describe('Visualization', () => {
  ok('generates Mermaid', () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', name: 'Start' }, { id: 'b', name: 'End', dependsOn: ['a'] }
    ]});
    const m = wf.toMermaid();
    assert.ok(m.includes('graph TD'));
    assert.ok(m.includes('a --> b'));
  });
  ok('generates DOT', () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a' }, { id: 'b', dependsOn: ['a'] }
    ]});
    const d = wf.toDot();
    assert.ok(d.includes('digraph'));
    assert.ok(d.includes('a -> b'));
  });
});

describe('Serialization', () => {
  ok('toJSON includes step metadata', () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => 1, name: 'Test' },
    ]});
    const j = wf.toJSON();
    assert.equal(j.name, 't');
    assert.equal(j.steps[0].name, 'Test');
    assert.equal(j.steps[0]._hasFn, true);
  });
});

describe('Registry', () => {
  ok('creates and lists workflows', () => {
    const reg = new WorkflowRegistry();
    reg.create({ name: 'w1', steps: [{ id: 'a' }] });
    reg.create({ name: 'w2', steps: [{ id: 'b' }] });
    assert.equal(reg.list().length, 2);
  });
  ok('runs workflow by id', async () => {
    const reg = new WorkflowRegistry();
    const wf = reg.create({ name: 'w', steps: [{ id: 'a', type: 'task', run: async () => 99 }] });
    const result = await reg.run(wf.id);
    assert.equal(result.status, 'completed');
    assert.equal(result.results.a.result, 99);
  });
  ok('removes workflow', () => {
    const reg = new WorkflowRegistry();
    const wf = reg.create({ name: 'w', steps: [{ id: 'a' }] });
    assert.ok(reg.remove(wf.id));
    assert.equal(reg.list().length, 0);
  });
  ok('global stats', async () => {
    const reg = new WorkflowRegistry();
    const wf = reg.create({ name: 'w', steps: [{ id: 'a', type: 'task', run: async () => 1 }] });
    await reg.run(wf.id);
    const s = reg.globalStats;
    assert.equal(s.workflows, 1);
    assert.equal(s.totalRuns, 1);
    assert.equal(s.successRate, 100);
  });
  ok('emits events', async () => {
    const reg = new WorkflowRegistry();
    let started = false;
    reg.on('workflow:start', () => started = true);
    const wf = reg.create({ name: 'w', steps: [{ id: 'a', type: 'task', run: async () => 1 }] });
    await reg.run(wf.id);
    assert.ok(started);
  });
});

describe('Stats', () => {
  ok('tracks run statistics', async () => {
    const wf = new Workflow({ name: 't', steps: [
      { id: 'a', type: 'task', run: async () => 1 },
    ]});
    await wf.run();
    await wf.run();
    const s = wf.stats;
    assert.equal(s.totalRuns, 2);
    assert.equal(s.completed, 2);
    assert.equal(s.successRate, 100);
    assert.ok(s.avgDuration >= 0);
  });
});

describe('Nested Workflow', () => {
  ok('runs sub-workflow', async () => {
    const sub = {
      id: 'sub', name: 'sub', steps: [
        { id: 'x', type: 'task', run: async (ctx) => ctx.data.n * 3 }
      ]
    };
    const wf = new Workflow({ name: 'parent', steps: [
      { id: 'main', type: 'workflow', workflow: sub },
    ]});
    const result = await wf.run({ n: 7 });
    // sub-workflow outputs should be available
    assert.equal(result.status, 'completed');
  });
});

// node:test handles process exit
