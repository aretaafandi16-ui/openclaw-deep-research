/**
 * agent-chain v1.0 — Zero-dep reasoning chain engine for AI agents
 *
 * Features:
 *  - Multi-step reasoning chains (linear + tree-of-thought)
 *  - Branching with merge/evaluate/score
 *  - Backtracking to any step
 *  - Confidence scoring per step (0-1)
 *  - Chain templates & presets
 *  - Branch-and-bound search with pruning
 *  - Serialization/persistence (JSON + JSONL)
 *  - EventEmitter for real-time events
 *  - Reasoning strategies: chain-of-thought, tree-of-thought, self-consistency, react
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

let _id = 0;
function uid(prefix = 'step') { return `${prefix}_${Date.now()}_${++_id}`; }
function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function now() { return Date.now(); }

// ─── Reasoning Step ────────────────────────────────────────────────
export class Step {
  constructor({ id, label, thought, result, confidence = 0.5, metadata = {}, parentId = null, children = [] } = {}) {
    this.id = id || uid();
    this.label = label || '';
    this.thought = thought || '';
    this.result = result || null;
    this.confidence = clamp(confidence);
    this.metadata = { ...metadata };
    this.parentId = parentId;
    this.children = [...children];
    this.timestamp = now();
    this.evaluated = false;
    this.score = null;
    this.tags = [];
  }

  toJSON() {
    return { id: this.id, label: this.label, thought: this.thought, result: this.result,
      confidence: this.confidence, metadata: this.metadata, parentId: this.parentId,
      children: this.children, timestamp: this.timestamp, evaluated: this.evaluated,
      score: this.score, tags: this.tags };
  }

  static fromJSON(o) {
    const s = new Step(o);
    s.timestamp = o.timestamp;
    s.evaluated = o.evaluated;
    s.score = o.score;
    s.tags = o.tags || [];
    return s;
  }
}

// ─── Reasoning Chain ───────────────────────────────────────────────
export class ReasoningChain extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = opts.id || uid('chain');
    this.name = opts.name || 'Unnamed Chain';
    this.strategy = opts.strategy || 'chain-of-thought'; // chain-of-thought | tree-of-thought | self-consistency | react
    this.steps = new Map(); // id → Step
    this.currentStepId = null;
    this.rootStepId = null;
    this.history = []; // ordered step ids
    this.branches = new Map(); // branchName → stepId
    this.conclusion = null;
    this.conclusionConfidence = 0;
    this.created = now();
    this.updated = now();
    this.maxDepth = opts.maxDepth || 20;
    this.confidenceThreshold = opts.confidenceThreshold ?? 0.7;
    this.autoscore = opts.autoscore ?? true;
  }

  // ── Add a step ───────────────────────────────────────────────
  addStep({ label, thought, result, confidence, metadata, parentId, tags } = {}) {
    const pid = parentId ?? this.currentStepId;
    const step = new Step({ label, thought, result, confidence, metadata, parentId: pid });
    if (tags) step.tags = tags;
    this.steps.set(step.id, step);
    if (pid && this.steps.has(pid)) {
      this.steps.get(pid).children.push(step.id);
    }
    if (!this.rootStepId) this.rootStepId = step.id;
    this.currentStepId = step.id;
    this.history.push(step.id);
    this.updated = now();
    if (this.autoscore) this._autoscore(step);
    this.emit('step', step.toJSON());
    return step;
  }

  // ── Branch from a step ──────────────────────────────────────
  branch(stepId, name) {
    if (!this.steps.has(stepId)) throw new Error(`Step ${stepId} not found`);
    this.branches.set(name || uid('branch'), stepId);
    this.currentStepId = stepId;
    this.emit('branch', { from: stepId, name });
    return this;
  }

  // ── Backtrack to a step ─────────────────────────────────────
  backtrack(stepId) {
    if (!this.steps.has(stepId)) throw new Error(`Step ${stepId} not found`);
    // Remove all steps that came after this one (that descend from it)
    const toRemove = [];
    for (const [id, step] of this.steps) {
      if (id !== stepId && this._isDescendant(id, stepId)) toRemove.push(id);
    }
    for (const id of toRemove) {
      this.steps.delete(id);
      const hi = this.history.indexOf(id);
      if (hi >= 0) this.history.splice(hi, 1);
    }
    // Clean parent references
    for (const step of this.steps.values()) {
      step.children = step.children.filter(c => this.steps.has(c));
    }
    this.currentStepId = stepId;
    this.updated = now();
    this.emit('backtrack', { to: stepId, removed: toRemove.length });
    return this;
  }

  _isDescendant(stepId, ancestorId) {
    let cur = this.steps.get(stepId);
    while (cur) {
      if (cur.parentId === ancestorId) return true;
      cur = cur.parentId ? this.steps.get(cur.parentId) : null;
    }
    return false;
  }

  // ── Evaluate & score ────────────────────────────────────────
  evaluate(stepId, score, notes) {
    const step = this.steps.get(stepId);
    if (!step) throw new Error(`Step ${stepId} not found`);
    step.evaluated = true;
    step.score = clamp(score, -1, 1);
    if (notes) step.metadata.evalNotes = notes;
    this.updated = now();
    this.emit('evaluate', { id: stepId, score: step.score, notes });
    return this;
  }

  // ── Conclude ────────────────────────────────────────────────
  conclude(text, confidence) {
    this.conclusion = text;
    this.conclusionConfidence = clamp(confidence ?? this._avgConfidence());
    this.updated = now();
    this.emit('conclude', { conclusion: text, confidence: this.conclusionConfidence });
    return this;
  }

  // ── Search: find best path through tree ─────────────────────
  searchBestPath(stepId, scorer) {
    const sid = stepId || this.rootStepId;
    if (!sid) return [];
    const scoreFn = scorer || (s => s.confidence * (s.score ?? 0.5));
    let best = { path: [sid], score: scoreFn(this.steps.get(sid)) };
    const dfs = (id, path, cumScore) => {
      const step = this.steps.get(id);
      if (!step || step.children.length === 0) {
        if (cumScore > best.score) best = { path: [...path], score: cumScore };
        return;
      }
      for (const cid of step.children) {
        const child = this.steps.get(cid);
        if (!child) continue;
        path.push(cid);
        dfs(cid, path, cumScore + scoreFn(child));
        path.pop();
      }
    };
    dfs(sid, [sid], best.score);
    return best;
  }

  // ── Branch-and-bound ────────────────────────────────────────
  branchAndBound(opts = {}) {
    const { maxBranches = 3, scoreThreshold = 0.3, maxDepth = this.maxDepth } = opts;
    const rootId = this.rootStepId;
    if (!rootId) return [];
    const queue = [{ id: rootId, depth: 0, path: [rootId], score: this.steps.get(rootId).confidence }];
    const results = [];
    let bestScore = -Infinity;

    while (queue.length > 0) {
      queue.sort((a, b) => b.score - a.score);
      const { id, depth, path, score } = queue.shift();
      if (score < bestScore * scoreThreshold) continue; // prune
      if (depth >= maxDepth) { results.push({ path, score }); continue; }
      const step = this.steps.get(id);
      if (!step || step.children.length === 0) {
        if (score > bestScore) bestScore = score;
        results.push({ path, score });
        continue;
      }
      const scored = step.children.map(cid => {
        const c = this.steps.get(cid);
        return { id: cid, depth: depth + 1, path: [...path, cid], score: score + (c ? c.confidence : 0) };
      }).sort((a, b) => b.score - a.score).slice(0, maxBranches);
      queue.push(...scored);
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // ── Get reasoning path ──────────────────────────────────────
  getPath(stepId) {
    const path = [];
    let cur = stepId ? this.steps.get(stepId) : this.steps.get(this.currentStepId);
    while (cur) {
      path.unshift(cur.toJSON());
      cur = cur.parentId ? this.steps.get(cur.parentId) : null;
    }
    return path;
  }

  // ── Get tree ────────────────────────────────────────────────
  getTree(rootId) {
    const rid = rootId || this.rootStepId;
    if (!rid) return null;
    const build = (id) => {
      const step = this.steps.get(id);
      if (!step) return null;
      return { ...step.toJSON(), children: step.children.map(build).filter(Boolean) };
    };
    return build(rid);
  }

  // ── Merge chains ────────────────────────────────────────────
  merge(other, strategy = 'best') {
    // strategy: 'best' (take higher confidence), 'append', 'union'
    if (strategy === 'append') {
      for (const [id, step] of other.steps) {
        if (!this.steps.has(id)) this.steps.set(id, step);
      }
    } else if (strategy === 'best') {
      for (const [id, step] of other.steps) {
        const existing = this.steps.get(id);
        if (!existing || step.confidence > existing.confidence) this.steps.set(id, step);
      }
    } else { // union
      for (const [id, step] of other.steps) {
        if (!this.steps.has(id)) this.steps.set(id, step);
      }
    }
    this.updated = now();
    this.emit('merge', { from: other.id, strategy });
    return this;
  }

  // ── Self-consistency: run N chains, pick best ───────────────
  static selfConsistency(chains, scorer) {
    if (!chains.length) return null;
    const scoreFn = scorer || (c => c.conclusionConfidence);
    return chains.reduce((best, c) => scoreFn(c) > scoreFn(best) ? c : best, chains[0]);
  }

  // ── ReAct pattern step ──────────────────────────────────────
  reactStep({ thought, action, observation, confidence } = {}) {
    return this.addStep({
      label: 'react',
      thought,
      result: { action, observation },
      confidence,
      metadata: { type: 'react' },
      tags: ['react']
    });
  }

  // ── Auto-score ──────────────────────────────────────────────
  _autoscore(step) {
    // Simple heuristic: longer thoughts = more considered = higher confidence
    const lenBonus = Math.min(step.thought.length / 500, 0.2);
    step.confidence = clamp(step.confidence + lenBonus);
  }

  _avgConfidence() {
    let sum = 0, n = 0;
    for (const s of this.steps.values()) { sum += s.confidence; n++; }
    return n > 0 ? sum / n : 0;
  }

  // ── Serialization ───────────────────────────────────────────
  toJSON() {
    return {
      id: this.id, name: this.name, strategy: this.strategy,
      steps: Object.fromEntries([...this.steps].map(([k, v]) => [k, v.toJSON()])),
      currentStepId: this.currentStepId, rootStepId: this.rootStepId,
      history: this.history, branches: Object.fromEntries(this.branches),
      conclusion: this.conclusion, conclusionConfidence: this.conclusionConfidence,
      created: this.created, updated: this.updated, maxDepth: this.maxDepth,
      confidenceThreshold: this.confidenceThreshold
    };
  }

  static fromJSON(o) {
    const c = new ReasoningChain({ id: o.id, name: o.name, strategy: o.strategy,
      maxDepth: o.maxDepth, confidenceThreshold: o.confidenceThreshold });
    c.steps = new Map(Object.entries(o.steps || {}).map(([k, v]) => [k, Step.fromJSON(v)]));
    c.currentStepId = o.currentStepId;
    c.rootStepId = o.rootStepId;
    c.history = o.history || [];
    c.branches = new Map(Object.entries(o.branches || {}));
    c.conclusion = o.conclusion;
    c.conclusionConfidence = o.conclusionConfidence;
    c.created = o.created;
    c.updated = o.updated;
    return c;
  }

  // ── Stats ───────────────────────────────────────────────────
  stats() {
    const steps = [...this.steps.values()];
    const confidences = steps.map(s => s.confidence);
    const scores = steps.filter(s => s.score != null).map(s => s.score);
    return {
      id: this.id, name: this.name, strategy: this.strategy,
      totalSteps: steps.length, branches: this.branches.size,
      avgConfidence: confidences.length ? (confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0,
      minConfidence: confidences.length ? Math.min(...confidences) : 0,
      maxConfidence: confidences.length ? Math.max(...confidences) : 0,
      evaluated: steps.filter(s => s.evaluated).length,
      avgScore: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      conclusion: this.conclusion, conclusionConfidence: this.conclusionConfidence,
      depth: this._depth(), created: this.created, updated: this.updated
    };
  }

  _depth() {
    let max = 0;
    for (const step of this.steps.values()) {
      let d = 0, cur = step;
      while (cur.parentId) { d++; cur = this.steps.get(cur.parentId) || null; if (!cur) break; }
      max = Math.max(max, d);
    }
    return max;
  }

  toMarkdown() {
    const lines = [`# ${this.name}`, `Strategy: ${this.strategy}`, ''];
    const tree = this.getTree();
    if (tree) {
      const render = (node, indent = 0) => {
        const prefix = '  '.repeat(indent) + (indent > 0 ? '- ' : '');
        const conf = `(${(node.confidence * 100).toFixed(0)}%)`;
        lines.push(`${prefix}**${node.label || node.id}** ${conf}: ${node.thought || '(no thought)'}`);
        if (node.result != null) lines.push('  '.repeat(indent + 1) + `→ ${typeof node.result === 'object' ? JSON.stringify(node.result) : node.result}`);
        for (const child of node.children) render(child, indent + 1);
      };
      render(tree);
    }
    if (this.conclusion) {
      lines.push('', `## Conclusion (${(this.conclusionConfidence * 100).toFixed(0)}%)`, this.conclusion);
    }
    return lines.join('\n');
  }
}

// ─── Chain Manager ─────────────────────────────────────────────────
export class ChainManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.chains = new Map();
    this.dataDir = opts.dataDir || null;
    if (this.dataDir && !existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    if (this.dataDir) this._load();
  }

  create(opts = {}) {
    const chain = new ReasoningChain(opts);
    this.chains.set(chain.id, chain);
    chain.on('step', e => this.emit('step', { chainId: chain.id, ...e }));
    chain.on('conclude', e => this.emit('conclude', { chainId: chain.id, ...e }));
    this._persist(chain);
    this.emit('create', chain.id);
    return chain;
  }

  get(id) { return this.chains.get(id) || null; }

  remove(id) {
    const c = this.chains.get(id);
    if (!c) return false;
    this.chains.delete(id);
    this.emit('remove', id);
    return true;
  }

  list() {
    return [...this.chains.values()].map(c => c.stats());
  }

  search(query) {
    const q = query.toLowerCase();
    return [...this.chains.values()].filter(c => {
      if (c.name.toLowerCase().includes(q)) return true;
      for (const s of c.steps.values()) {
        if (s.thought.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)) return true;
      }
      return false;
    }).map(c => c.stats());
  }

  globalStats() {
    const chains = [...this.chains.values()];
    return {
      totalChains: chains.length,
      totalSteps: chains.reduce((a, c) => a + c.steps.size, 0),
      strategies: [...new Set(chains.map(c => c.strategy))],
      avgConfidence: chains.length ? chains.reduce((a, c) => a + c.stats().avgConfidence, 0) / chains.length : 0,
      withConclusions: chains.filter(c => c.conclusion).length
    };
  }

  // ── Persistence ─────────────────────────────────────────────
  _persist(chain) {
    if (!this.dataDir) return;
    const file = join(this.dataDir, `${chain.id}.json`);
    writeFileSync(file, JSON.stringify(chain.toJSON(), null, 2));
    const logFile = join(this.dataDir, 'chains.jsonl');
    appendFileSync(logFile, JSON.stringify({ action: 'update', id: chain.id, ts: now() }) + '\n');
  }

  save(chainId) {
    const chain = chainId ? this.chains.get(chainId) : null;
    if (chainId && chain) this._persist(chain);
    else for (const c of this.chains.values()) this._persist(c);
  }

  _load() {
    if (!this.dataDir || !existsSync(this.dataDir)) return;
    try {
      const { readdirSync } = require('node:fs');
      for (const f of readdirSync(this.dataDir)) {
        if (!f.endsWith('.json') || f === 'chains.jsonl') continue;
        try {
          const data = JSON.parse(readFileSync(join(this.dataDir, f), 'utf8'));
          const chain = ReasoningChain.fromJSON(data);
          this.chains.set(chain.id, chain);
        } catch {}
      }
    } catch {}
  }
}

// ─── Presets ───────────────────────────────────────────────────────
export const PRESETS = {
  'chain-of-thought': { strategy: 'chain-of-thought', maxDepth: 15, confidenceThreshold: 0.7 },
  'tree-of-thought': { strategy: 'tree-of-thought', maxDepth: 10, confidenceThreshold: 0.5 },
  'self-consistency': { strategy: 'self-consistency', maxDepth: 8, confidenceThreshold: 0.8 },
  'react': { strategy: 'react', maxDepth: 20, confidenceThreshold: 0.6 },
  'decompose': { strategy: 'chain-of-thought', maxDepth: 25, confidenceThreshold: 0.5 },
  'verify': { strategy: 'chain-of-thought', maxDepth: 5, confidenceThreshold: 0.9 }
};

export default { ReasoningChain, ChainManager, Step, PRESETS };
