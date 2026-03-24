#!/usr/bin/env node
// agent-diff — Zero-dep deep diff, patch & merge engine for AI agents
import { EventEmitter } from 'node:events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Deep Diff ───────────────────────────────────────────────────────────────

function deepDiff(old, nu, path = '') {
  const ops = [];
  if (old === nu) return ops;
  const tOld = typeOf(old), tNew = typeOf(nu);
  if (tOld !== tNew) {
    ops.push({ op: 'replace', path, old: old, value: nu });
    return ops;
  }
  if (tOld === 'object') {
    const allKeys = new Set([...Object.keys(old || {}), ...Object.keys(nu || {})]);
    for (const k of allKeys) {
      const p = path ? `${path}.${k}` : `.${k}`;
      if (!(k in old)) ops.push({ op: 'add', path: p, value: nu[k] });
      else if (!(k in nu)) ops.push({ op: 'remove', path: p, old: old[k] });
      else ops.push(...deepDiff(old[k], nu[k], p));
    }
  } else if (tOld === 'array') {
    const max = Math.max(old.length, nu.length);
    for (let i = 0; i < max; i++) {
      const p = `${path}[${i}]`;
      if (i >= old.length) ops.push({ op: 'add', path: p, value: nu[i] });
      else if (i >= nu.length) ops.push({ op: 'remove', path: p, old: old[i] });
      else ops.push(...deepDiff(old[i], nu[i], p));
    }
  } else {
    ops.push({ op: 'replace', path, old: old, value: nu });
  }
  return ops;
}

// ─── JSON Patch (RFC 6902–style) ─────────────────────────────────────────────

function jsonPatch(old, nu) {
  const diffs = deepDiff(old, nu);
  return diffs.map(d => {
    // Convert .a.b -> /a/b, [0] -> /0, .a[0].b -> /a/0/b
    let p = d.path;
    if (p.startsWith('.')) p = p.slice(1);
    p = p.replace(/\[(\d+)\]/g, '/$1');
    // Split remaining dots into path segments
    p = p.replace(/\./g, '/');
    if (p && !p.startsWith('/')) p = '/' + p;
    if (d.op === 'add') return { op: 'add', path: p, value: d.value };
    if (d.op === 'remove') return { op: 'remove', path: p };
    return { op: 'replace', path: p, value: d.value };
  });
}

function applyPatch(doc, patches) {
  let result = structuredClone(doc);
  for (const p of patches) {
    result = applySingle(result, p);
  }
  return result;
}

function applySingle(doc, patch) {
  const { op, path, value } = patch;
  const segments = parsePath(path);
  if (segments.length === 0) {
    if (op === 'replace') return structuredClone(value);
    if (op === 'add') return structuredClone(value);
    if (op === 'remove') return undefined;
  }
  let target = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    target = getSegment(target, segments[i]);
    if (target === undefined) throw new Error(`Path not found: ${path}`);
  }
  const last = segments[segments.length - 1];
  if (op === 'add' || op === 'replace') {
    setSegment(target, last, structuredClone(value));
  } else if (op === 'remove') {
    deleteSegment(target, last);
  }
  return doc;
}

function parsePath(path) {
  if (path.startsWith('/')) path = path.slice(1);
  // Handle both /0 and /[0] notation
  return path.split('/').filter(Boolean).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getSegment(obj, seg) {
  if (Array.isArray(obj)) return obj[parseInt(seg, 10)];
  return obj[seg];
}

function setSegment(obj, seg, val) {
  if (Array.isArray(obj)) obj[parseInt(seg, 10)] = val;
  else obj[seg] = val;
}

function deleteSegment(obj, seg) {
  if (Array.isArray(obj)) obj.splice(parseInt(seg, 10), 1);
  else delete obj[seg];
}

// ─── Merge Strategies ────────────────────────────────────────────────────────

function deepMerge(base, override, strategy = 'override') {
  if (strategy === 'override') return mergeOverride(base, override);
  if (strategy === 'base') return structuredClone(base);
  if (strategy === 'shallow') return { ...base, ...override };
  if (strategy === 'concat') return mergeConcat(base, override);
  if (strategy === 'deep') return mergeDeep(base, override);
  if (strategy === 'array_union') return mergeArrayUnion(base, override);
  return mergeOverride(base, override);
}

function mergeOverride(base, over) {
  if (isPlainObj(base) && isPlainObj(over)) {
    const result = { ...base };
    for (const k of Object.keys(over)) {
      result[k] = mergeOverride(base[k], over[k]);
    }
    return result;
  }
  return structuredClone(over ?? base);
}

function mergeDeep(base, over) {
  if (isPlainObj(base) && isPlainObj(over)) {
    const result = {};
    const allKeys = new Set([...Object.keys(base), ...Object.keys(over)]);
    for (const k of allKeys) {
      if (k in over && k in base) result[k] = mergeDeep(base[k], over[k]);
      else if (k in over) result[k] = structuredClone(over[k]);
      else result[k] = structuredClone(base[k]);
    }
    return result;
  }
  if (Array.isArray(base) && Array.isArray(over)) return [...base, ...over];
  return structuredClone(over ?? base);
}

function mergeConcat(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) return [...base, ...over];
  if (isPlainObj(base) && isPlainObj(over)) {
    const result = { ...base };
    for (const k of Object.keys(over)) {
      if (k in result && Array.isArray(result[k]) && Array.isArray(over[k])) {
        result[k] = [...result[k], ...over[k]];
      } else {
        result[k] = over[k];
      }
    }
    return result;
  }
  return structuredClone(over);
}

function mergeArrayUnion(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) {
    const seen = new Set(base.map(x => JSON.stringify(x)));
    const result = [...base];
    for (const item of over) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) { result.push(item); seen.add(key); }
    }
    return result;
  }
  if (isPlainObj(base) && isPlainObj(over)) {
    const result = { ...base };
    for (const k of Object.keys(over)) {
      result[k] = mergeArrayUnion(base[k], over[k]);
    }
    return result;
  }
  return structuredClone(over);
}

// ─── Text Diff (LCS-based line diff) ─────────────────────────────────────────

function textDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lcs = lcsMatrix(oldLines, newLines);
  const hunks = [];
  let oi = oldLines.length, ni = newLines.length;
  const changes = [];

  while (oi > 0 || ni > 0) {
    if (oi > 0 && ni > 0 && oldLines[oi - 1] === newLines[ni - 1]) {
      changes.unshift({ type: 'equal', oldLine: oi, newLine: ni, content: oldLines[oi - 1] });
      oi--; ni--;
    } else if (ni > 0 && (oi === 0 || lcs[oi][ni - 1] >= lcs[oi - 1][ni])) {
      changes.unshift({ type: 'add', newLine: ni, content: newLines[ni - 1] });
      ni--;
    } else {
      changes.unshift({ type: 'remove', oldLine: oi, content: oldLines[oi - 1] });
      oi--;
    }
  }

  // Group into hunks
  let i = 0;
  while (i < changes.length) {
    if (changes[i].type === 'equal') { i++; continue; }
    const start = Math.max(0, i - 3);
    const hunk = [];
    for (let j = start; j < Math.min(changes.length, i + 10); j++) {
      hunk.push(changes[j]);
    }
    hunks.push(hunk);
    i = start + hunk.length;
  }

  return { hunks, stats: textStats(changes), changes };
}

function lcsMatrix(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function textStats(changes) {
  let added = 0, removed = 0, equal = 0;
  for (const c of changes) {
    if (c.type === 'add') added++;
    else if (c.type === 'remove') removed++;
    else equal++;
  }
  return { added, removed, equal, total: changes.length, similarity: equal / Math.max(1, changes.length) };
}

// ─── Word-level Diff ─────────────────────────────────────────────────────────

function wordDiff(oldText, newText) {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);
  const lcs = lcsMatrix(oldWords, newWords);
  const result = [];
  let oi = oldWords.length, ni = newWords.length;

  while (oi > 0 || ni > 0) {
    if (oi > 0 && ni > 0 && oldWords[oi - 1] === newWords[ni - 1]) {
      result.unshift({ type: 'equal', content: oldWords[oi - 1] });
      oi--; ni--;
    } else if (ni > 0 && (oi === 0 || lcs[oi][ni - 1] >= lcs[oi - 1][ni])) {
      result.unshift({ type: 'add', content: newWords[ni - 1] });
      ni--;
    } else {
      result.unshift({ type: 'remove', content: oldWords[oi - 1] });
      oi--;
    }
  }
  return result;
}

// ─── Patch Format ────────────────────────────────────────────────────────────

function toUnifiedDiff(filename, oldText, newText) {
  const { hunks, stats } = textDiff(oldText, newText);
  const lines = [
    `--- a/${filename}`,
    `+++ b/${filename}`,
  ];
  for (const hunk of hunks) {
    const oldStart = hunk.find(c => c.oldLine)?.oldLine || 1;
    const newStart = hunk.find(c => c.newLine)?.newLine || 1;
    lines.push(`@@ -${oldStart},${hunk.filter(c => c.type !== 'add').length} +${newStart},${hunk.filter(c => c.type !== 'remove').length} @@`);
    for (const c of hunk) {
      if (c.type === 'equal') lines.push(` ${c.content}`);
      else if (c.type === 'remove') lines.push(`-${c.content}`);
      else lines.push(`+${c.content}`);
    }
  }
  return { unified: lines.join('\n'), stats };
}

// ─── Three-Way Merge ─────────────────────────────────────────────────────────

function threeWayMerge(base, ours, theirs, strategy = 'override') {
  const baseOurs = deepDiff(base, ours);
  const baseTheirs = deepDiff(base, theirs);
  const conflicts = [];

  // Find conflicting changes
  const ourPaths = new Set(baseOurs.map(d => d.path));
  const theirPaths = new Set(baseTheirs.map(d => d.path));
  for (const p of ourPaths) {
    if (theirPaths.has(p)) {
      const oChange = baseOurs.find(d => d.path === p);
      const tChange = baseTheirs.find(d => d.path === p);
      if (oChange.value !== tChange.value) {
        conflicts.push({ path: p, ours: oChange, theirs: tChange });
      }
    }
  }

  // Apply non-conflicting changes
  let result = structuredClone(base);
  const conflictPaths = new Set(conflicts.map(c => c.path));

  for (const change of baseOurs) {
    if (!conflictPaths.has(change.path)) {
      try {
        result = applyDiffOp(result, change);
      } catch {}
    }
  }
  for (const change of baseTheirs) {
    if (!conflictPaths.has(change.path) && !ourPaths.has(change.path)) {
      try {
        result = applyDiffOp(result, change);
      } catch {}
    }
  }

  // Resolve conflicts with strategy
  for (const conflict of conflicts) {
    if (strategy === 'ours') result = applyDiffOp(result, conflict.ours);
    else if (strategy === 'theirs') result = applyDiffOp(result, conflict.theirs);
    // 'manual' leaves conflict info only
  }

  return { merged: result, conflicts, hasConflicts: conflicts.length > 0 };
}

function applyDiffOp(obj, diff) {
  const result = structuredClone(obj);
  const segments = diff.path.split('.').filter(Boolean).map(s => {
    const m = s.match(/^(.+?)\[(\d+)\]$/);
    return m ? [m[1], parseInt(m[2])] : [s];
  }).flat();

  let target = result;
  for (let i = 0; i < segments.length - 1; i++) {
    target = target[segments[i]];
    if (target === undefined) return result;
  }
  const last = segments[segments.length - 1];
  if (diff.op === 'add' || diff.op === 'replace') target[last] = structuredClone(diff.value);
  else if (diff.op === 'remove') {
    if (Array.isArray(target)) target.splice(parseInt(last, 10), 1);
    else delete target[last];
  }
  return result;
}

// ─── Change Tracker ──────────────────────────────────────────────────────────

class ChangeTracker {
  constructor(opts = {}) {
    this.maxHistory = opts.maxHistory || 1000;
    this.history = [];
    this.snapshots = new Map();
  }

  track(id, oldVal, newVal) {
    const diff = deepDiff(oldVal, newVal);
    const entry = { id, timestamp: Date.now(), diff, stats: { changes: diff.length } };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
    return entry;
  }

  snapshot(id, value) {
    this.snapshots.set(id, { value: structuredClone(value), timestamp: Date.now() });
  }

  diffSnapshots(id1, id2) {
    const s1 = this.snapshots.get(id1), s2 = this.snapshots.get(id2);
    if (!s1 || !s2) return null;
    return { from: id1, to: id2, diff: deepDiff(s1.value, s2.value) };
  }

  getHistory(id) {
    return id ? this.history.filter(h => h.id === id) : this.history;
  }

  clear() {
    this.history = [];
    this.snapshots.clear();
  }
}

// ─── Patch Queue ─────────────────────────────────────────────────────────────

class PatchQueue {
  constructor(target) {
    this.target = structuredClone(target);
    this.queue = [];
    this.applied = [];
    this.rolledBack = [];
  }

  enqueue(patches, label = '') {
    const entry = { patches, label, timestamp: Date.now(), id: this.queue.length };
    this.queue.push(entry);
    return entry;
  }

  apply() {
    if (!this.queue.length) return null;
    const entry = this.queue.shift();
    const before = structuredClone(this.target);
    try {
      this.target = applyPatch(this.target, entry.patches);
      this.applied.push({ ...entry, before });
      return { success: true, id: entry.id, label: entry.label };
    } catch (e) {
      this.queue.unshift(entry);
      return { success: false, error: e.message, id: entry.id };
    }
  }

  applyAll() {
    const results = [];
    while (this.queue.length) results.push(this.apply());
    return results;
  }

  rollback() {
    if (!this.applied.length) return null;
    const entry = this.applied.pop();
    this.target = entry.before;
    this.rolledBack.push(entry);
    return { success: true, id: entry.id, label: entry.label };
  }

  status() {
    return { queued: this.queue.length, applied: this.applied.length, rolledBack: this.rolledBack.length };
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function typeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPlainObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function flatKeys(obj, prefix = '') {
  const keys = [];
  if (isPlainObj(obj)) {
    for (const k of Object.keys(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      keys.push(path, ...flatKeys(obj[k], path));
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((_, i) => {
      const path = `${prefix}[${i}]`;
      keys.push(path, ...flatKeys(obj[i], path));
    });
  }
  return keys;
}

function pick(obj, paths) {
  const result = {};
  for (const p of paths) {
    const segs = p.split('.').filter(Boolean);
    let val = obj;
    for (const s of segs) {
      val = val?.[s];
      if (val === undefined) break;
    }
    if (val !== undefined) setNested(result, p, val);
  }
  return result;
}

function setNested(obj, path, val) {
  const segs = path.split('.').filter(Boolean);
  let target = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!(segs[i] in target)) target[segs[i]] = {};
    target = target[segs[i]];
  }
  target[segs[segs.length - 1]] = val;
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class AgentDiff extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.tracker = new ChangeTracker(opts);
    this.persistPath = opts.persistPath || null;
  }

  // Deep diff two objects
  diff(old, nu) {
    const result = deepDiff(old, nu);
    this.emit('diff', { changes: result.length });
    return result;
  }

  // Generate JSON patch
  patch(old, nu) {
    return jsonPatch(old, nu);
  }

  // Apply JSON patch
  applyPatch(doc, patches) {
    const result = applyPatch(doc, patches);
    this.emit('patch', { patches: patches.length });
    return result;
  }

  // Deep merge with strategy
  merge(base, override, strategy = 'override') {
    const result = deepMerge(base, override, strategy);
    this.emit('merge', { strategy });
    return result;
  }

  // Three-way merge
  threeWay(base, ours, theirs, strategy = 'override') {
    const result = threeWayMerge(base, ours, theirs, strategy);
    this.emit('threeWay', { conflicts: result.conflicts.length });
    return result;
  }

  // Text diff
  textDiff(old, nu) {
    return textDiff(old, nu);
  }

  // Word-level diff
  wordDiff(old, nu) {
    return wordDiff(old, nu);
  }

  // Unified diff format
  unifiedDiff(filename, old, nu) {
    return toUnifiedDiff(filename, old, nu);
  }

  // Track changes
  track(id, old, nu) {
    return this.tracker.track(id, old, nu);
  }

  // Snapshot
  snapshot(id, value) {
    this.tracker.snapshot(id, value);
  }

  // Diff snapshots
  diffSnapshots(id1, id2) {
    return this.tracker.diffSnapshots(id1, id2);
  }

  // Create patch queue
  createPatchQueue(target) {
    return new PatchQueue(target);
  }

  // Check equality
  isEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Get changed keys
  changedKeys(old, nu) {
    return this.diff(old, nu).map(d => d.path).filter(Boolean);
  }

  // Stats
  stats(old, nu) {
    const d = this.diff(old, nu);
    let adds = 0, removes = 0, replaces = 0;
    for (const op of d) {
      if (op.op === 'add') adds++;
      else if (op.op === 'remove') removes++;
      else replaces++;
    }
    return { total: d.length, adds, removes, replaces, paths: d.map(x => x.path) };
  }
}

export { deepDiff, jsonPatch, applyPatch, deepMerge, threeWayMerge, textDiff, wordDiff, toUnifiedDiff, ChangeTracker, PatchQueue };
export default AgentDiff;
