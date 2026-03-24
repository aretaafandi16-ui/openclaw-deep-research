import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── UUID (zero-dep) ──────────────────────────────────────────────────────────
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((v, i) => [4, 6, 8, 10].includes(i) ? `-${v.toString(16).padStart(2, '0')}` : v.toString(16).padStart(2, '0')).join('');
}

// ─── DAG Validator ─────────────────────────────────────────────────────────────
function validateDAG(steps) {
  const adj = new Map();
  const nodes = new Set();
  for (const s of steps) {
    nodes.add(s.id);
    adj.set(s.id, []);
  }
  for (const s of steps) {
    for (const dep of (s.dependsOn || [])) {
      if (!nodes.has(dep)) throw new Error(`Step "${s.id}" depends on unknown step "${dep}"`);
      adj.get(dep).push(s.id);
    }
  }
  // Kahn's algorithm for cycle detection
  const inDeg = new Map();
  for (const n of nodes) inDeg.set(n, 0);
  for (const s of steps) {
    for (const dep of (s.dependsOn || [])) {
      inDeg.set(s.id, (inDeg.get(s.id) || 0) + 1);
    }
  }
  const queue = [...nodes].filter(n => inDeg.get(n) === 0);
  let visited = 0;
  while (queue.length) {
    const n = queue.shift();
    visited++;
    for (const child of (adj.get(n) || [])) {
      inDeg.set(child, inDeg.get(child) - 1);
      if (inDeg.get(child) === 0) queue.push(child);
    }
  }
  if (visited !== nodes.size) throw new Error('Workflow contains a cycle');
  return true;
}

// ─── Topological Sort ──────────────────────────────────────────────────────────
function topoSort(steps) {
  const inDeg = new Map();
  const adj = new Map();
  const stepMap = new Map();
  for (const s of steps) {
    stepMap.set(s.id, s);
    adj.set(s.id, []);
    inDeg.set(s.id, 0);
  }
  for (const s of steps) {
    for (const dep of (s.dependsOn || [])) {
      adj.get(dep).push(s.id);
      inDeg.set(s.id, inDeg.get(s.id) + 1);
    }
  }
  // Group by depth level for parallel execution
  const levels = [];
  const remaining = new Map(inDeg);
  while (remaining.size > 0) {
    const level = [...remaining.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    if (level.length === 0) throw new Error('Cycle detected during sort');
    levels.push(level.map(id => stepMap.get(id)));
    for (const id of level) {
      remaining.delete(id);
      for (const child of (adj.get(id) || [])) {
        remaining.set(child, remaining.get(child) - 1);
      }
    }
  }
  return levels;
}

// ─── Step Runner ───────────────────────────────────────────────────────────────
async function runStep(step, context, workflow) {
  const timeout = step.timeout || workflow._opts.defaultTimeout || 30000;
  const maxRetries = step.retries ?? workflow._opts.defaultRetries ?? 0;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      let result;
      if (step.type === 'task') {
        result = await step.run(context, ac.signal);
      } else if (step.type === 'transform') {
        const input = step.input ? context.outputs.get(step.input) : context.data;
        result = await step.transform(input, context);
      } else if (step.type === 'condition') {
        const cond = await step.condition(context);
        result = { branch: cond ? 'true' : 'false' };
      } else if (step.type === 'parallel') {
        const tasks = step.tasks.map(t => runStep(t, context, workflow));
        result = await Promise.all(tasks);
      } else if (step.type === 'loop') {
        const results = [];
        let i = 0;
        while (i < (step.maxIterations || 100)) {
          const shouldContinue = await step.condition(context, i, results);
          if (!shouldContinue) break;
          const r = await step.run(context, i, results);
          results.push(r);
          i++;
        }
        result = results;
      } else if (step.type === 'workflow') {
        const sub = new Workflow(step.workflow, workflow._opts);
        result = await sub.run(context.data);
        result = result.outputs;
      } else if (step.type === 'log') {
        const msg = typeof step.message === 'function' ? await step.message(context) : step.message;
        workflow.emit('log', { step: step.id, message: msg });
        result = msg;
      } else if (step.type === 'set') {
        const val = typeof step.value === 'function' ? await step.value(context) : step.value;
        context.set(step.key, val);
        result = val;
      } else if (step.type === 'delay') {
        await new Promise(r => setTimeout(r, step.ms || 1000));
        result = { delayed: step.ms || 1000 };
      } else if (step.type === 'assert') {
        const ok = await step.assert(context);
        if (!ok) throw new Error(`Assertion failed: ${step.message || step.id}`);
        result = true;
      } else if (step.type === 'switch') {
        const val = typeof step.value === 'function' ? await step.value(context) : context.get(step.value);
        const branch = step.cases[val] || step.cases['default'] || step.cases['_'] || null;
        if (branch) {
          result = await runStep({ ...branch, id: `${step.id}:${val}` }, context, workflow);
        } else {
          result = { skipped: true, reason: `No case for ${val}` };
        }
      } else {
        throw new Error(`Unknown step type: ${step.type}`);
      }
      clearTimeout(timer);
      return { success: true, result, attempts: attempt + 1 };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (step.fallback) {
        try {
          const fb = await step.fallback(context, err);
          return { success: true, result: fb, fallback: true, error: err.message };
        } catch { /* fallback also failed */ }
      }
    }
  }
  return { success: false, error: lastErr?.message, attempts: maxRetries + 1 };
}

// ─── Context ───────────────────────────────────────────────────────────────────
class WorkflowContext {
  constructor(data = {}) {
    this.data = data;
    this.outputs = new Map();
    this._vars = new Map();
  }
  get(key) { return this._vars.has(key) ? this._vars.get(key) : this.data[key]; }
  set(key, val) { this._vars.set(key, val); }
  toJSON() {
    return {
      data: this.data,
      outputs: Object.fromEntries(this.outputs),
      vars: Object.fromEntries(this._vars),
    };
  }
}

// ─── Workflow Class ────────────────────────────────────────────────────────────
export class Workflow extends EventEmitter {
  constructor(definition, opts = {}) {
    super();
    this._opts = { persistDir: null, defaultTimeout: 30000, defaultRetries: 0, maxConcurrency: 0, ...opts };
    this.id = definition.id || uuid();
    this.name = definition.name || 'unnamed';
    this.steps = (definition.steps || []).map(s => ({ ...s }));
    this._validate();
    this._runs = [];
    if (this._opts.persistDir) {
      const dir = this._opts.persistDir;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this._logPath = join(dir, `${this.id}.jsonl`);
      this._snapPath = join(dir, `${this.id}.json`);
    }
  }

  _validate() {
    const ids = new Set();
    for (const s of this.steps) {
      if (!s.id) throw new Error('Every step needs an id');
      if (ids.has(s.id)) throw new Error(`Duplicate step id: ${s.id}`);
      ids.add(s.id);
      if (!s.type) s.type = 'task';
    }
    validateDAG(this.steps);
  }

  async run(data = {}) {
    const runId = uuid();
    const ctx = new WorkflowContext(data);
    const stepMap = new Map(this.steps.map(s => [s.id, s]));
    const results = new Map();
    const levels = topoSort(this.steps);
    const startTime = Date.now();

    const run = { id: runId, workflowId: this.id, status: 'running', startedAt: new Date().toISOString(), results: {}, duration: 0 };
    this._runs.push(run);
    this._persistRun(run);
    this.emit('start', { runId, workflow: this.name, data });

    try {
      for (const level of levels) {
        // Filter steps whose conditions are met
        const eligible = [];
        for (const step of level) {
          if (step.when) {
            try {
              const ok = await step.when(ctx);
              if (!ok) {
                results.set(step.id, { success: true, skipped: true });
                this.emit('step:skipped', { runId, step: step.id });
                continue;
              }
            } catch { /* when threw, skip */ results.set(step.id, { success: true, skipped: true }); continue; }
          }
          eligible.push(step);
        }

        // Parallel execution within level
        const concurrency = this._opts.maxConcurrency || eligible.length;
        const batches = [];
        for (let i = 0; i < eligible.length; i += concurrency) {
          batches.push(eligible.slice(i, i + concurrency));
        }

        for (const batch of batches) {
          const promises = batch.map(async (step) => {
            this.emit('step:start', { runId, step: step.id, type: step.type });
            const result = await runStep(step, ctx, this);
            results.set(step.id, result);
            ctx.outputs.set(step.id, result.result);
            this._persistStep(runId, step.id, result);
            this.emit(result.success ? 'step:success' : 'step:fail', { runId, step: step.id, result });
            return result;
          });
          const batchResults = await Promise.all(promises);
          // Check for failures — stop if any step failed and no continueOnError
          const hasFailure = batchResults.some(r => !r.success);
          if (hasFailure && !this._opts.continueOnError) {
            throw new Error(`Step failed in workflow`);
          }
        }
      }

      const duration = Date.now() - startTime;
      run.status = 'completed';
      run.duration = duration;
      run.results = Object.fromEntries([...results.entries()].map(([k, v]) => [k, v]));
      run.completedAt = new Date().toISOString();
      this._persistRun(run);
      this.emit('complete', { runId, duration, outputs: ctx.toJSON() });
      return { runId, status: 'completed', duration, outputs: ctx.toJSON(), results: run.results };
    } catch (err) {
      const duration = Date.now() - startTime;
      run.status = 'failed';
      run.duration = duration;
      run.error = err.message;
      run.results = Object.fromEntries([...results.entries()].map(([k, v]) => [k, v]));
      run.completedAt = new Date().toISOString();
      this._persistRun(run);
      this.emit('fail', { runId, error: err.message, duration });
      return { runId, status: 'failed', duration, error: err.message, outputs: ctx.toJSON(), results: run.results };
    }
  }

  // ─── Serialization ────────────────────────────────────────────────────────
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      steps: this.steps.map(s => {
        const out = { ...s };
        delete out.run; delete out.transform; delete out.condition;
        delete out.fallback; delete out.when; delete out.assert;
        delete out.tasks; delete out.message; delete out.value;
        out._hasFn = !!(s.run || s.transform || s.condition || s.fallback || s.when || s.assert);
        return out;
      }),
    };
  }

  // ─── DAG Visualization ────────────────────────────────────────────────────
  toMermaid() {
    let out = 'graph TD\n';
    for (const s of this.steps) {
      const label = s.name || s.id;
      const shape = s.type === 'condition' ? `{${label}}` : s.type === 'parallel' ? `[[${label}]]` : `[${label}]`;
      out += `  ${s.id}${shape}\n`;
      for (const dep of (s.dependsOn || [])) {
        out += `  ${dep} --> ${s.id}\n`;
      }
    }
    return out;
  }

  toDot() {
    let out = 'digraph workflow {\n  rankdir=LR;\n  node [shape=box];\n';
    for (const s of this.steps) {
      const shape = s.type === 'condition' ? 'diamond' : s.type === 'parallel' ? 'parallelogram' : 'box';
      out += `  ${s.id} [label="${s.name || s.id}" shape=${shape}];\n`;
      for (const dep of (s.dependsOn || [])) {
        out += `  ${dep} -> ${s.id};\n`;
      }
    }
    out += '}';
    return out;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────
  get stats() {
    const completed = this._runs.filter(r => r.status === 'completed');
    const failed = this._runs.filter(r => r.status === 'failed');
    return {
      totalRuns: this._runs.length,
      completed: completed.length,
      failed: failed.length,
      successRate: this._runs.length ? Math.round(completed.length / this._runs.length * 100) : 0,
      avgDuration: completed.length ? Math.round(completed.reduce((a, r) => a + r.duration, 0) / completed.length) : 0,
      lastRun: this._runs.length ? this._runs[this._runs.length - 1] : null,
    };
  }

  get runs() { return [...this._runs]; }

  // ─── Persistence ──────────────────────────────────────────────────────────
  _persistRun(run) {
    if (!this._logPath) return;
    try { appendFileSync(this._logPath, JSON.stringify({ type: 'run', ...run }) + '\n'); } catch {}
  }
  _persistStep(runId, stepId, result) {
    if (!this._logPath) return;
    try { appendFileSync(this._logPath, JSON.stringify({ type: 'step', runId, stepId, ...result, ts: new Date().toISOString() }) + '\n'); } catch {}
  }

  // ─── Builder helpers ──────────────────────────────────────────────────────
  addStep(step) { this.steps.push(step); this._validate(); return this; }
  removeStep(id) { this.steps = this.steps.filter(s => s.id !== id); this._validate(); return this; }
}

// ─── Registry ──────────────────────────────────────────────────────────────────
export class WorkflowRegistry extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._opts = opts;
    this._workflows = new Map();
    this._allRuns = [];
  }

  create(definition, opts = {}) {
    const wf = new Workflow(definition, { ...this._opts, ...opts });
    wf.on('start', (e) => this.emit('workflow:start', e));
    wf.on('complete', (e) => this.emit('workflow:complete', e));
    wf.on('fail', (e) => this.emit('workflow:fail', e));
    wf.on('step:start', (e) => this.emit('step:start', e));
    wf.on('step:success', (e) => this.emit('step:success', e));
    wf.on('step:fail', (e) => this.emit('step:fail', e));
    this._workflows.set(wf.id, wf);
    this.emit('registered', { id: wf.id, name: wf.name });
    return wf;
  }

  get(id) { return this._workflows.get(id); }
  list() { return [...this._workflows.values()].map(w => ({ id: w.id, name: w.name, steps: w.steps.length, stats: w.stats })); }
  remove(id) { return this._workflows.delete(id); }

  async run(id, data) {
    const wf = this._workflows.get(id);
    if (!wf) throw new Error(`Workflow "${id}" not found`);
    const result = await wf.run(data);
    this._allRuns.push(result);
    return result;
  }

  get globalStats() {
    const allRuns = [...this._workflows.values()].flatMap(w => w.runs);
    const completed = allRuns.filter(r => r.status === 'completed');
    return {
      workflows: this._workflows.size,
      totalRuns: allRuns.length,
      completed: completed.length,
      failed: allRuns.filter(r => r.status === 'failed').length,
      successRate: allRuns.length ? Math.round(completed.length / allRuns.length * 100) : 0,
    };
  }
}

export { WorkflowContext, validateDAG, topoSort, uuid };
