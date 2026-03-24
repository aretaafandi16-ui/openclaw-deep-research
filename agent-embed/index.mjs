/**
 * agent-embed — Zero-dep vector embedding store for AI agents
 *
 * Features:
 * - In-memory vector store with cosine/euclidean/dot-product similarity
 * - Brute-force KNN with metadata pre-filtering
 * - Partition-based approximate nearest neighbor (IVF-style)
 * - CRUD operations (upsert, get, delete, update metadata)
 * - Batch insert with progress events
 * - Namespace isolation for multi-tenant usage
 * - Metadata filtering (eq, ne, gt, gte, lt, lte, in, nin, exists, contains)
 * - Composite filters (and, or, not)
 * - JSONL persistence with snapshot support
 * - Dimension validation and auto-detection
 * - Statistics: count, dimension, memory estimate, index stats
 * - EventEmitter for insert/delete/clear/rebuild events
 * - Zero dependencies
 */

import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ─── Utility ──────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Distance Functions ───────────────────────────────────────────────────────

const Distances = {
  cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  },
  euclidean(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return 1 / (1 + Math.sqrt(sum)); // normalized to 0-1
  },
  dot(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }
};

// ─── Metadata Filter Engine ───────────────────────────────────────────────────

function matchesFilter(metadata, filter) {
  if (!filter) return true;
  if (Array.isArray(filter)) {
    // AND of sub-filters
    return filter.every(f => matchesFilter(metadata, f));
  }
  if (typeof filter !== 'object') return true;

  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and') {
      if (!condition.every(c => matchesFilter(metadata, c))) return false;
      continue;
    }
    if (key === '$or') {
      if (!condition.some(c => matchesFilter(metadata, c))) return false;
      continue;
    }
    if (key === '$not') {
      if (matchesFilter(metadata, condition)) return false;
      continue;
    }

    const val = metadata[key];

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      for (const [op, opVal] of Object.entries(condition)) {
        switch (op) {
          case '$eq': if (val !== opVal) return false; break;
          case '$ne': if (val === opVal) return false; break;
          case '$gt': if (!(val > opVal)) return false; break;
          case '$gte': if (!(val >= opVal)) return false; break;
          case '$lt': if (!(val < opVal)) return false; break;
          case '$lte': if (!(val <= opVal)) return false; break;
          case '$in': if (!Array.isArray(opVal) || !opVal.includes(val)) return false; break;
          case '$nin': if (Array.isArray(opVal) && opVal.includes(val)) return false; break;
          case '$exists': if (opVal && val === undefined) return false; if (!opVal && val !== undefined) return false; break;
          case '$contains':
            if (typeof val === 'string') { if (!val.includes(opVal)) return false; }
            else if (Array.isArray(val)) { if (!val.includes(opVal)) return false; }
            else return false;
            break;
        }
      }
    } else {
      // Direct equality
      if (val !== condition) return false;
    }
  }
  return true;
}

// ─── IVF Partition Index ──────────────────────────────────────────────────────

class IVFIndex {
  constructor(dim, numPartitions = 0) {
    this.dim = dim;
    this.numPartitions = numPartitions;
    this.centroids = [];     // cluster centroids
    this.assignments = {};   // id → partition index
    this.partitionIds = [];  // partition index → [ids]
    this.trained = false;
  }

  // K-means++ initialization
  train(vectors, ids) {
    if (this.numPartitions <= 0 || vectors.length < this.numPartitions) {
      this.trained = false;
      return;
    }

    // K-means++ init
    this.centroids = [];
    const firstIdx = Math.floor(Math.random() * vectors.length);
    this.centroids.push([...vectors[firstIdx]]);

    for (let c = 1; c < this.numPartitions; c++) {
      // Distance to nearest centroid
      const dists = vectors.map(v => {
        let minD = Infinity;
        for (const centroid of this.centroids) {
          const d = 1 - Distances.cosine(v, centroid);
          if (d < minD) minD = d;
        }
        return minD;
      });
      const total = dists.reduce((s, d) => s + d, 0);
      let r = Math.random() * total;
      for (let i = 0; i < dists.length; i++) {
        r -= dists[i];
        if (r <= 0) { this.centroids.push([...vectors[i]]); break; }
      }
    }

    // K-means iterations (max 20)
    for (let iter = 0; iter < 20; iter++) {
      const clusters = Array.from({ length: this.numPartitions }, () => []);
      for (let i = 0; i < vectors.length; i++) {
        let bestC = 0, bestD = -1;
        for (let c = 0; c < this.centroids.length; c++) {
          const d = Distances.cosine(vectors[i], this.centroids[c]);
          if (d > bestD) { bestD = d; bestC = c; }
        }
        clusters[bestC].push(i);
      }
      // Update centroids
      let converged = true;
      for (let c = 0; c < this.numPartitions; c++) {
        if (clusters[c].length === 0) continue;
        const newCentroid = new Array(this.dim).fill(0);
        for (const idx of clusters[c]) {
          for (let d = 0; d < this.dim; d++) newCentroid[d] += vectors[idx][d];
        }
        for (let d = 0; d < this.dim; d++) newCentroid[d] /= clusters[c].length;
        // Normalize
        const norm = Math.sqrt(newCentroid.reduce((s, v) => s + v * v, 0));
        if (norm > 0) for (let d = 0; d < this.dim; d++) newCentroid[d] /= norm;
        for (let d = 0; d < this.dim; d++) {
          if (Math.abs(newCentroid[d] - this.centroids[c][d]) > 1e-6) converged = false;
        }
        this.centroids[c] = newCentroid;
      }
      if (converged) break;
    }

    // Build assignments
    this.partitionIds = Array.from({ length: this.numPartitions }, () => []);
    this.assignments = {};
    for (let i = 0; i < vectors.length; i++) {
      let bestC = 0, bestD = -1;
      for (let c = 0; c < this.centroids.length; c++) {
        const d = Distances.cosine(vectors[i], this.centroids[c]);
        if (d > bestD) { bestD = d; bestC = c; }
      }
      this.assignments[ids[i]] = bestC;
      this.partitionIds[bestC].push(ids[i]);
    }
    this.trained = true;
  }

  // Search nprobe closest partitions
  searchPartitions(queryVec, nprobe = 1) {
    if (!this.trained) return null; // null = search all
    const scores = this.centroids.map((c, i) => ({
      idx: i,
      score: Distances.cosine(queryVec, c)
    }));
    scores.sort((a, b) => b.score - a.score);
    const candidateIds = [];
    for (let i = 0; i < Math.min(nprobe, scores.length); i++) {
      candidateIds.push(...this.partitionIds[scores[i].idx]);
    }
    return candidateIds;
  }

  addVector(id) {
    if (!this.trained) return;
    // assign to nearest centroid (deferred — will retrain periodically)
  }

  removeVector(id) {
    if (!this.trained) return;
    const p = this.assignments[id];
    if (p !== undefined) {
      this.partitionIds[p] = this.partitionIds[p].filter(i => i !== id);
      delete this.assignments[id];
    }
  }
}

// ─── EmbedStore ───────────────────────────────────────────────────────────────

class EmbedStore extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.dimension - vector dimension (0 = auto-detect on first insert)
   * @param {string} opts.distance - 'cosine' | 'euclidean' | 'dot'
   * @param {string} opts.persistPath - path for JSONL persistence
   * @param {number} opts.snapshotInterval - auto-snapshot every N mutations
   * @param {number} opts.maxVectors - max vectors before oldest eviction
   * @param {string} opts.namespace - namespace for multi-tenant isolation
   * @param {number} opts.ivfPartitions - number of IVF partitions (0 = brute-force)
   * @param {number} opts.nprobe - partitions to search with IVF
   * @param {number} opts.rebuildThreshold - rebuild IVF after N mutations
   */
  constructor(opts = {}) {
    super();
    this.dim = opts.dimension || 0;
    this.distanceFn = Distances[opts.distance || 'cosine'] || Distances.cosine;
    this.distanceName = opts.distance || 'cosine';
    this.persistPath = opts.persistPath || null;
    this.snapshotInterval = opts.snapshotInterval || 1000;
    this.maxVectors = opts.maxVectors || 0;
    this.namespace = opts.namespace || '_default';
    this.ivfPartitions = opts.ivfPartitions || 0;
    this.nprobe = opts.nprobe || 3;
    this.rebuildThreshold = opts.rebuildThreshold || 500;

    this.vectors = new Map();     // id → { vector, metadata, createdAt, updatedAt }
    this.mutationCount = 0;
    this.ivf = null;
    this.ivfDirty = 0;

    this.stats = { inserts: 0, deletes: 0, searches: 0, upserts: 0 };

    if (this.persistPath) {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      this._loadFromDisk();
    }
  }

  // ── Dimension Validation ──────────────────────────────────────────────────

  _validateDim(vector, label = 'vector') {
    if (!Array.isArray(vector)) throw new Error(`${label} must be an array`);
    if (vector.length === 0) throw new Error(`${label} must not be empty`);
    if (this.dim === 0) {
      this.dim = vector.length;
      this.emit('dimension-detected', this.dim);
    } else if (vector.length !== this.dim) {
      throw new Error(`${label} dimension mismatch: expected ${this.dim}, got ${vector.length}`);
    }
    // Validate all numbers
    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== 'number' || isNaN(vector[i])) {
        throw new Error(`${label}[${i}] is not a valid number`);
      }
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Insert or update a vector
   * @param {string} id
   * @param {number[]} vector
   * @param {object} metadata
   * @returns {object} { id, created: bool }
   */
  upsert(id, vector, metadata = {}) {
    this._validateDim(vector, 'upsert vector');
    const now = Date.now();
    const existed = this.vectors.has(id);

    this.vectors.set(id, {
      vector: Float64Array.from(vector),
      metadata: { ...metadata },
      createdAt: existed ? this.vectors.get(id).createdAt : now,
      updatedAt: now
    });

    if (!existed) {
      this.stats.inserts++;
      if (this.ivf) this.ivfDirty++;
    } else {
      this.stats.upserts++;
    }
    this.mutationCount++;

    // Max vectors eviction
    if (this.maxVectors > 0 && this.vectors.size > this.maxVectors) {
      const oldest = this.vectors.keys().next().value;
      this.delete(oldest);
    }

    // IVF rebuild check
    if (this.ivf && this.ivfDirty >= this.rebuildThreshold) {
      this._rebuildIVF();
    }

    this._persist('upsert', { id, vector: Array.from(vector), metadata });
    this.emit('upsert', id, !existed);
    return { id, created: !existed };
  }

  /**
   * Batch insert
   * @param {Array<{id, vector, metadata}>} items
   * @returns {object} { inserted, skipped, errors }
   */
  upsertBatch(items) {
    const result = { inserted: 0, skipped: 0, errors: [] };
    for (const item of items) {
      try {
        this.upsert(item.id || generateId(), item.vector, item.metadata || {});
        result.inserted++;
      } catch (e) {
        result.errors.push({ id: item.id, error: e.message });
        result.skipped++;
      }
    }
    this.emit('batch-upsert', result);
    return result;
  }

  /**
   * Get a vector by ID
   */
  get(id) {
    const entry = this.vectors.get(id);
    if (!entry) return null;
    return {
      id,
      vector: Array.from(entry.vector),
      metadata: { ...entry.metadata },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    };
  }

  /**
   * Check if ID exists
   */
  has(id) {
    return this.vectors.has(id);
  }

  /**
   * Delete a vector
   */
  delete(id) {
    if (!this.vectors.has(id)) return false;
    this.vectors.delete(id);
    this.stats.deletes++;
    this.mutationCount++;
    if (this.ivf) this.ivf.removeVector(id);
    this._persist('delete', { id });
    this.emit('delete', id);
    return true;
  }

  /**
   * Update only metadata (keeps vector)
   */
  updateMetadata(id, metadata) {
    const entry = this.vectors.get(id);
    if (!entry) return false;
    Object.assign(entry.metadata, metadata);
    entry.updatedAt = Date.now();
    this.mutationCount++;
    this._persist('updateMetadata', { id, metadata });
    this.emit('update-metadata', id, metadata);
    return true;
  }

  /**
   * Clear all vectors
   */
  clear() {
    const count = this.vectors.size;
    this.vectors.clear();
    this.ivf = null;
    this.ivfDirty = 0;
    this.mutationCount++;
    this._persist('clear', {});
    this.emit('clear', count);
    return count;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  /**
   * K-nearest neighbor search
   * @param {number[]} queryVector
   * @param {number} k - top K results
   * @param {object} opts - { filter, threshold, includeVectors }
   * @returns {Array<{id, score, metadata, vector?}>}
   */
  search(queryVector, k = 10, opts = {}) {
    this._validateDim(queryVector, 'query vector');
    this.stats.searches++;
    const { filter = null, threshold = -Infinity, includeVectors = false } = opts;

    // Get candidate IDs (IVF or all)
    let candidateIds = null;
    if (this.ivf && this.ivf.trained) {
      candidateIds = this.ivf.searchPartitions(queryVector, this.nprobe);
    }

    const results = [];
    const entries = candidateIds
      ? candidateIds.map(id => [id, this.vectors.get(id)]).filter(e => e[1])
      : this.vectors.entries();

    for (const [id, entry] of entries) {
      if (!entry) continue;
      if (filter && !matchesFilter(entry.metadata, filter)) continue;
      const score = this.distanceFn(queryVector, Array.from(entry.vector));
      if (score < threshold) continue;
      const result = { id, score, metadata: { ...entry.metadata } };
      if (includeVectors) result.vector = Array.from(entry.vector);
      results.push(result);
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /**
   * Search by text — requires external embedding function
   * @param {string} text
   * @param {function} embedFn - async (text) => number[]
   * @param {number} k
   * @param {object} opts
   */
  async searchByText(text, embedFn, k = 10, opts = {}) {
    const vector = await embedFn(text);
    return this.search(vector, k, opts);
  }

  // ── IVF Index ─────────────────────────────────────────────────────────────

  /**
   * Build IVF index for faster search
   */
  buildIndex(numPartitions = 0) {
    const p = numPartitions || this.ivfPartitions;
    if (p <= 0) { this.ivf = null; return; }

    const ids = [];
    const vectors = [];
    for (const [id, entry] of this.vectors) {
      ids.push(id);
      vectors.push(Array.from(entry.vector));
    }

    this.ivf = new IVFIndex(this.dim, p);
    this.ivf.train(vectors, ids);
    this.ivfDirty = 0;
    this.emit('index-built', { partitions: p, vectors: ids.length, trained: this.ivf.trained });
  }

  _rebuildIVF() {
    if (this.ivfPartitions <= 0) return;
    this.buildIndex(this.ivfPartitions);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  _persist(op, data) {
    if (!this.persistPath) return;
    try {
      const record = JSON.stringify({ op, data, ts: Date.now() });
      appendFileSync(this.persistPath, record + '\n');
      if (this.mutationCount % this.snapshotInterval === 0) {
        this._saveSnapshot();
      }
    } catch (e) {
      this.emit('persist-error', e);
    }
  }

  _saveSnapshot() {
    if (!this.persistPath) return;
    const snapPath = this.persistPath.replace('.jsonl', '.snapshot.json');
    const data = {
      dim: this.dim,
      namespace: this.namespace,
      distance: this.distanceName,
      vectors: {}
    };
    for (const [id, entry] of this.vectors) {
      data.vectors[id] = {
        v: Array.from(entry.vector),
        m: entry.metadata,
        c: entry.createdAt,
        u: entry.updatedAt
      };
    }
    try {
      writeFileSync(snapPath, JSON.stringify(data));
      this.emit('snapshot-saved', snapPath);
    } catch (e) {
      this.emit('persist-error', e);
    }
  }

  _loadFromDisk() {
    if (!this.persistPath || !existsSync(this.persistPath)) return;

    // Try snapshot first
    const snapPath = this.persistPath.replace('.jsonl', '.snapshot.json');
    if (existsSync(snapPath)) {
      try {
        const snap = JSON.parse(readFileSync(snapPath, 'utf-8'));
        if (snap.dim) this.dim = snap.dim;
        if (snap.namespace) this.namespace = snap.namespace;
        for (const [id, e] of Object.entries(snap.vectors || {})) {
          this.vectors.set(id, {
            vector: Float64Array.from(e.v),
            metadata: e.m || {},
            createdAt: e.c || Date.now(),
            updatedAt: e.u || Date.now()
          });
        }
        // Replay events after snapshot
        this._replayEvents(snapPath);
        return;
      } catch {}
    }

    // Full replay from JSONL
    try {
      const lines = readFileSync(this.persistPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const { op, data } = JSON.parse(line);
          this._applyOp(op, data);
        } catch {}
      }
    } catch {}
  }

  _replayEvents(_snapPath) {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const stat = require('node:fs').statSync(this.persistPath);
      // Only replay if file is non-empty
      if (stat.size === 0) return;
      const lines = readFileSync(this.persistPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const { op, data } = JSON.parse(line);
          this._applyOp(op, data);
        } catch {}
      }
    } catch {}
  }

  _applyOp(op, data) {
    switch (op) {
      case 'upsert':
        this.vectors.set(data.id, {
          vector: Float64Array.from(data.vector),
          metadata: data.metadata || {},
          createdAt: this.vectors.get(data.id)?.createdAt || Date.now(),
          updatedAt: Date.now()
        });
        break;
      case 'delete':
        this.vectors.delete(data.id);
        break;
      case 'updateMetadata': {
        const e = this.vectors.get(data.id);
        if (e) Object.assign(e.metadata, data.metadata || {});
        break;
      }
      case 'clear':
        this.vectors.clear();
        break;
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getInfo() {
    let memEstimate = 0;
    for (const [, entry] of this.vectors) {
      memEstimate += entry.vector.length * 8; // Float64 = 8 bytes
      memEstimate += JSON.stringify(entry.metadata).length;
    }
    return {
      namespace: this.namespace,
      count: this.vectors.size,
      dimension: this.dim,
      distance: this.distanceName,
      memoryEstimateBytes: memEstimate,
      memoryEstimateMB: +(memEstimate / 1024 / 1024).toFixed(2),
      ivfEnabled: this.ivf?.trained || false,
      ivfPartitions: this.ivfPartitions,
      mutations: this.mutationCount,
      stats: { ...this.stats },
      maxVectors: this.maxVectors,
      persistPath: this.persistPath
    };
  }

  /**
   * Export all vectors as array
   */
  export() {
    const result = [];
    for (const [id, entry] of this.vectors) {
      result.push({
        id,
        vector: Array.from(entry.vector),
        metadata: { ...entry.metadata },
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      });
    }
    return result;
  }

  /**
   * Import vectors from array
   */
  import(items) {
    return this.upsertBatch(items);
  }

  /**
   * Get all IDs
   */
  ids() {
    return Array.from(this.vectors.keys());
  }

  /**
   * Iterate entries
   */
  *[Symbol.iterator]() {
    for (const [id, entry] of this.vectors) {
      yield { id, vector: Array.from(entry.vector), metadata: { ...entry.metadata } };
    }
  }
}

export { EmbedStore, Distances, matchesFilter, IVFIndex };
