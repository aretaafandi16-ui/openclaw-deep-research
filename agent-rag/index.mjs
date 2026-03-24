/**
 * agent-rag — Zero-dependency RAG (Retrieval-Augmented Generation) engine for AI agents
 *
 * Features:
 *   - Document chunking: fixed-size, sentence, paragraph, recursive (heading-aware)
 *   - TF-IDF indexing with cosine similarity
 *   - BM25 scoring (k1=1.5, b=0.75 default)
 *   - Hybrid search (TF-IDF + BM25 weighted combination)
 *   - Cross-encoder style re-ranking (context overlap, term proximity, field boosting)
 *   - Query expansion (bigram extraction, stopword removal)
 *   - Namespace isolation with cross-namespace search
 *   - JSONL persistence + snapshots
 *   - Document management (add/update/delete/get)
 *   - Chunk-level metadata and source tracking
 *   - EventEmitter for index/reindex/delete events
 */

import { EventEmitter } from 'events';
import { readFile, writeFile, mkdir, access, appendFile } from 'fs/promises';
import { dirname } from 'path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','can',
  'need','dare','ought','used','it','its','this','that','these','those','i',
  'me','my','we','us','our','you','your','he','him','his','she','her','they',
  'them','their','what','which','who','whom','when','where','why','how','all',
  'each','every','both','few','more','most','other','some','such','no','nor',
  'not','only','own','same','so','than','too','very','just','also','as','if',
  'then','there','here','about','into','through','during','before','after',
  'above','below','between','out','off','over','under','again','further',
  'once','up','down','any','because','until','while','s','t','re','ve','ll','d','m'
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function bigrams(tokens) {
  const bg = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bg.push(tokens[i] + '_' + tokens[i + 1]);
  }
  return bg;
}

function cosineSim(a, b) {
  let dot = 0, magA = 0, magB = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k] || 0;
    const vb = b[k] || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Chunkers ─────────────────────────────────────────────────────────────────

const Chunker = {
  fixed(text, size = 500, overlap = 50) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      const end = Math.min(i + size, text.length);
      chunks.push({ text: text.slice(i, end), start: i, end });
      if (end >= text.length) break;
      i += size - overlap;
    }
    return chunks;
  },

  sentence(text) {
    const parts = text.split(/(?<=[.!?])\s+/);
    return parts.filter(s => s.trim()).map((s, i) => ({
      text: s.trim(),
      start: 0,
      end: 0,
      index: i
    }));
  },

  paragraph(text) {
    return text.split(/\n\s*\n/).filter(p => p.trim()).map((p, i) => ({
      text: p.trim(),
      start: 0,
      end: 0,
      index: i
    }));
  },

  recursive(text, maxSize = 500, overlap = 50) {
    // Try paragraphs first, then sentences, then fixed-size
    const paras = text.split(/\n\s*\n/).filter(p => p.trim());
    const chunks = [];

    for (const para of paras) {
      if (para.length <= maxSize) {
        chunks.push({ text: para.trim() });
      } else {
        // Split long paragraphs by sentences
        const sents = para.split(/(?<=[.!?])\s+/).filter(s => s.trim());
        let buf = '';
        for (const sent of sents) {
          if ((buf + ' ' + sent).length > maxSize && buf) {
            chunks.push({ text: buf.trim() });
            buf = sent;
          } else {
            buf = buf ? buf + ' ' + sent : sent;
          }
        }
        if (buf.trim()) {
          if (buf.length > maxSize) {
            // Final fallback: fixed-size
            const fixed = Chunker.fixed(buf, maxSize, overlap);
            chunks.push(...fixed);
          } else {
            chunks.push({ text: buf.trim() });
          }
        }
      }
    }

    return chunks.map((c, i) => ({ ...c, index: i }));
  }
};

// ─── RAG Engine ───────────────────────────────────────────────────────────────

export class AgentRAG extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.persistPath = opts.persistPath || null;
    this.defaultNamespace = opts.namespace || 'default';
    this.chunkSize = opts.chunkSize || 500;
    this.chunkOverlap = opts.chunkOverlap || 50;
    this.chunkStrategy = opts.chunkStrategy || 'recursive'; // fixed|sentence|paragraph|recursive
    this.bm25_k1 = opts.bm25_k1 || 1.5;
    this.bm25_b = opts.bm25_b || 0.75;
    this.hybridAlpha = opts.hybridAlpha || 0.5; // 0=all BM25, 1=all TF-IDF
    this.rerankTopK = opts.rerankTopK || 20; // candidates before re-ranking
    this.enableBigrams = opts.enableBigrams !== false;
    this.maxDocs = opts.maxDocs || 10000;
    this.persistInterval = opts.persistInterval || 60000;

    // Internal state
    this._namespaces = new Map(); // namespace -> { docs: Map, chunks: [], tfidf: {}, df: {}, avgdl: number, totalDocs: number }
    this._persistTimer = null;

    if (this.persistPath) {
      this._persistTimer = setInterval(() => this.save().catch(() => {}), this.persistInterval);
    }
  }

  _ns(namespace) {
    const ns = namespace || this.defaultNamespace;
    if (!this._namespaces.has(ns)) {
      this._namespaces.set(ns, {
        docs: new Map(),       // docId -> { id, text, metadata, namespace, chunks, createdAt }
        chunks: [],            // [{ id, docId, text, index, tokens, bigrams, metadata }]
        tfidf: {},             // chunkId -> { term: tfidf_score }
        df: {},                // term -> document frequency
        avgdl: 0,
        totalDocs: 0
      });
    }
    return this._namespaces.get(ns);
  }

  // ─── Document Management ──────────────────────────────────────────────────

  addDocument(text, metadata = {}, namespace) {
    const ns = this._ns(namespace);
    const docId = id();
    const chunkerFn = Chunker[this.chunkStrategy] || Chunker.recursive;
    const rawChunks = chunkerFn(text, this.chunkSize, this.chunkOverlap);

    const chunks = rawChunks.map((c, i) => {
      const tokens = tokenize(c.text);
      const chunkId = `${docId}::${i}`;
      return {
        id: chunkId,
        docId,
        text: c.text,
        index: i,
        tokens,
        bigrams: this.enableBigrams ? bigrams(tokens) : [],
        metadata: { ...metadata, chunkIndex: i, totalChunks: rawChunks.length }
      };
    });

    const doc = { id: docId, text, metadata, namespace: namespace || this.defaultNamespace, chunks: chunks.map(c => c.id), createdAt: Date.now() };
    ns.docs.set(docId, doc);
    ns.chunks.push(...chunks);

    // Evict oldest if over maxDocs
    while (ns.docs.size > this.maxDocs) {
      const oldest = ns.docs.keys().next().value;
      this.deleteDocument(oldest, namespace);
    }

    this._rebuildIndex(ns);
    this.emit('documentAdded', { docId, namespace: doc.namespace, chunkCount: chunks.length });
    if (this.persistPath) this._logEvent('add_document', { docId, namespace: doc.namespace, chunkCount: chunks.length });
    return docId;
  }

  addDocuments(documents, namespace) {
    return documents.map(d => this.addDocument(
      typeof d === 'string' ? d : d.text,
      typeof d === 'string' ? {} : (d.metadata || {}),
      namespace
    ));
  }

  updateDocument(docId, text, metadata, namespace) {
    this.deleteDocument(docId, namespace);
    return this.addDocument(text, metadata || {}, namespace);
  }

  deleteDocument(docId, namespace) {
    const ns = this._ns(namespace);
    const doc = ns.docs.get(docId);
    if (!doc) return false;

    ns.chunks = ns.chunks.filter(c => c.docId !== docId);
    // Clean TF-IDF entries
    for (const chunkId of doc.chunks) {
      delete ns.tfidf[chunkId];
    }
    ns.docs.delete(docId);
    this._rebuildIndex(ns);
    this.emit('documentDeleted', { docId, namespace: namespace || this.defaultNamespace });
    if (this.persistPath) this._logEvent('delete_document', { docId });
    return true;
  }

  getDocument(docId, namespace) {
    const ns = this._ns(namespace);
    return ns.docs.get(docId) || null;
  }

  listDocuments(namespace, opts = {}) {
    const ns = this._ns(namespace);
    let docs = [...ns.docs.values()];
    if (opts.tag) docs = docs.filter(d => d.metadata && d.metadata.tag === opts.tag);
    if (opts.source) docs = docs.filter(d => d.metadata && d.metadata.source === opts.source);
    if (opts.limit) docs = docs.slice(0, opts.limit);
    return docs;
  }

  // ─── Indexing ──────────────────────────────────────────────────────────────

  _rebuildIndex(ns) {
    const N = ns.chunks.length;
    if (N === 0) { ns.tfidf = {}; ns.df = {}; ns.avgdl = 0; ns.totalDocs = 0; return; }

    // Compute DF
    const df = {};
    for (const chunk of ns.chunks) {
      const seen = new Set();
      for (const t of [...chunk.tokens, ...chunk.bigrams]) {
        if (!seen.has(t)) { df[t] = (df[t] || 0) + 1; seen.add(t); }
      }
    }
    ns.df = df;

    // Compute average document length
    let totalLen = 0;
    for (const chunk of ns.chunks) totalLen += chunk.tokens.length;
    ns.avgdl = totalLen / N;
    ns.totalDocs = N;

    // Compute TF-IDF for each chunk
    ns.tfidf = {};
    for (const chunk of ns.chunks) {
      const tf = {};
      const allTerms = [...chunk.tokens, ...chunk.bigrams];
      for (const t of allTerms) tf[t] = (tf[t] || 0) + 1;
      const vec = {};
      for (const [term, count] of Object.entries(tf)) {
        const tfVal = 1 + Math.log(count); // log-normalized TF
        const idfVal = Math.log((N + 1) / ((df[term] || 0) + 1)) + 1; // smoothed IDF
        vec[term] = tfVal * idfVal;
      }
      ns.tfidf[chunk.id] = vec;
    }

    this.emit('indexRebuilt', { namespace: ns.docs.size > 0 ? [...ns.docs.values()][0].namespace : 'unknown', chunks: N });
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  search(query, opts = {}) {
    const namespace = opts.namespace;
    const topK = opts.topK || 5;
    const minScore = opts.minScore || 0;
    const rerank = opts.rerank !== false;
    const searchK = rerank ? Math.max(topK, this.rerankTopK) : topK;
    const filters = opts.filters || null;

    const namespaces = namespace
      ? [this._ns(namespace)]
      : [...this._namespaces.values()];

    const queryTokens = tokenize(query);
    const queryBigrams = this.enableBigrams ? bigrams(queryTokens) : [];
    const allQueryTerms = [...queryTokens, ...queryBigrams];

    if (allQueryTerms.length === 0) return [];

    // Build query TF vector
    const queryTf = {};
    for (const t of allQueryTerms) queryTf[t] = (queryTf[t] || 0) + 1;
    const queryVec = {};
    for (const [term, count] of Object.entries(queryTf)) {
      queryVec[term] = 1 + Math.log(count);
    }

    let candidates = [];

    for (const ns of namespaces) {
      for (const chunk of ns.chunks) {
        // Apply metadata filters
        if (filters && !this._matchFilters(chunk.metadata, filters)) continue;

        // TF-IDF cosine similarity
        const tfidfScore = cosineSim(queryVec, ns.tfidf[chunk.id] || {});

        // BM25 score
        const bm25Score = this._bm25Score(allQueryTerms, chunk, ns);

        // Hybrid score
        const hybrid = this.hybridAlpha * tfidfScore + (1 - this.hybridAlpha) * bm25Score;

        if (hybrid > 0) {
          candidates.push({
            chunkId: chunk.id,
            docId: chunk.docId,
            text: chunk.text,
            metadata: chunk.metadata,
            scores: { tfidf: tfidfScore, bm25: bm25Score, hybrid },
            score: hybrid
          });
        }
      }
    }

    // Sort by hybrid score, take top candidates
    candidates.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, searchK);

    // Re-ranking
    if (rerank && candidates.length > 1) {
      candidates = this._rerank(query, queryTokens, candidates);
    }

    // Filter by minScore and return topK
    return candidates
      .filter(c => c.score >= minScore)
      .slice(0, topK);
  }

  _bm25Score(terms, chunk, ns) {
    let score = 0;
    const dl = chunk.tokens.length;
    const avgdl = ns.avgdl || 1;
    const N = ns.totalDocs || 1;

    for (const term of terms) {
      const tf = chunk.tokens.filter(t => t === term).length + chunk.bigrams.filter(b => b === term).length;
      if (tf === 0) continue;
      const df = ns.df[term] || 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (tf * (this.bm25_k1 + 1)) / (tf + this.bm25_k1 * (1 - this.bm25_b + this.bm25_b * dl / avgdl));
      score += idf * tfNorm;
    }
    return score;
  }

  _rerank(query, queryTokens, candidates) {
    const queryLower = query.toLowerCase();

    return candidates.map(c => {
      const textLower = c.text.toLowerCase();
      let rerankBoost = 0;

      // 1. Exact phrase match (big boost)
      if (textLower.includes(queryLower)) rerankBoost += 2.0;

      // 2. Term proximity — how close are query terms to each other in the chunk?
      const positions = [];
      for (const qt of queryTokens) {
        const idx = textLower.indexOf(qt);
        if (idx !== -1) positions.push(idx);
      }
      if (positions.length >= 2) {
        positions.sort((a, b) => a - b);
        const span = positions[positions.length - 1] - positions[0];
        const proximity = 1 / (1 + span / 100);
        rerankBoost += proximity * 0.5;
      }

      // 3. Query coverage — what fraction of query terms appear?
      const matchedTerms = queryTokens.filter(qt => textLower.includes(qt)).length;
      const coverage = matchedTerms / queryTokens.length;
      rerankBoost += coverage * 0.8;

      // 4. Field boosting — if metadata has boosted fields
      if (c.metadata && c.metadata.boost) {
        rerankBoost *= (1 + c.metadata.boost);
      }

      return {
        ...c,
        score: c.score + rerankBoost,
        rerankBoost
      };
    }).sort((a, b) => b.score - a.score);
  }

  _matchFilters(metadata, filters) {
    for (const [key, cond] of Object.entries(filters)) {
      const val = metadata[key];
      if (typeof cond === 'object' && cond !== null) {
        if (cond.$eq !== undefined && val !== cond.$eq) return false;
        if (cond.$ne !== undefined && val === cond.$ne) return false;
        if (cond.$gt !== undefined && !(val > cond.$gt)) return false;
        if (cond.$gte !== undefined && !(val >= cond.$gte)) return false;
        if (cond.$lt !== undefined && !(val < cond.$lt)) return false;
        if (cond.$lte !== undefined && !(val <= cond.$lte)) return false;
        if (cond.$in !== undefined && !cond.$in.includes(val)) return false;
        if (cond.$nin !== undefined && cond.$nin.includes(val)) return false;
        if (cond.$exists !== undefined) {
          const exists = val !== undefined && val !== null;
          if (cond.$exists && !exists) return false;
          if (!cond.$exists && exists) return false;
        }
        if (cond.$contains !== undefined && !(typeof val === 'string' && val.includes(cond.$contains))) return false;
      } else {
        if (val !== cond) return false;
      }
    }
    return true;
  }

  // ─── Convenience methods ───────────────────────────────────────────────────

  query(query, topK = 5, opts = {}) {
    return this.search(query, { ...opts, topK });
  }

  context(query, topK = 5, opts = {}) {
    const results = this.search(query, { ...opts, topK });
    return results.map(r => ({
      text: r.text,
      score: r.score,
      metadata: r.metadata,
      docId: r.docId
    }));
  }

  contextString(query, topK = 5, opts = {}) {
    const ctx = this.context(query, topK, opts);
    if (ctx.length === 0) return '';
    return ctx.map((c, i) => `[${i + 1}] (score: ${c.score.toFixed(3)}) ${c.text}`).join('\n\n');
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  stats(namespace) {
    if (namespace) {
      const ns = this._ns(namespace);
      return {
        namespace,
        documents: ns.docs.size,
        chunks: ns.chunks.length,
        uniqueTerms: Object.keys(ns.df).length,
        avgChunkLength: ns.chunks.length > 0
          ? Math.round(ns.chunks.reduce((s, c) => s + c.tokens.length, 0) / ns.chunks.length)
          : 0,
        totalTokens: ns.chunks.reduce((s, c) => s + c.tokens.length, 0)
      };
    }
    const all = {};
    for (const [name, ns] of this._namespaces) {
      all[name] = {
        documents: ns.docs.size,
        chunks: ns.chunks.length,
        uniqueTerms: Object.keys(ns.df).length
      };
    }
    return {
      namespaces: Object.keys(all).length,
      totalDocuments: Object.values(all).reduce((s, n) => s + n.documents, 0),
      totalChunks: Object.values(all).reduce((s, n) => s + n.chunks, 0),
      details: all
    };
  }

  namespaces() {
    return [...this._namespaces.keys()];
  }

  clear(namespace) {
    if (namespace) {
      this._namespaces.delete(namespace);
    } else {
      this._namespaces.clear();
    }
    this.emit('clear', { namespace });
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  async save(path) {
    const p = path || this.persistPath;
    if (!p) return;
    await mkdir(dirname(p), { recursive: true });
    const state = {};
    for (const [name, ns] of this._namespaces) {
      state[name] = {
        docs: [...ns.docs.entries()],
        chunks: ns.chunks,
        df: ns.df,
        tfidf: ns.tfidf,
        avgdl: ns.avgdl,
        totalDocs: ns.totalDocs
      };
    }
    const data = JSON.stringify({ version: 1, namespaces: state, savedAt: Date.now() });
    await writeFile(p, data, 'utf8');
  }

  async load(path) {
    const p = path || this.persistPath;
    if (!p) return;
    try {
      const data = JSON.parse(await readFile(p, 'utf8'));
      if (data.namespaces) {
        for (const [name, ns] of Object.entries(data.namespaces)) {
          this._namespaces.set(name, {
            docs: new Map(ns.docs),
            chunks: ns.chunks || [],
            df: ns.df || {},
            tfidf: ns.tfidf || {},
            avgdl: ns.avgdl || 0,
            totalDocs: ns.totalDocs || 0
          });
        }
      }
      this.emit('loaded', { namespaces: this._namespaces.size });
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  async _logEvent(type, data) {
    if (!this.persistPath) return;
    const logPath = this.persistPath + '.events.jsonl';
    try {
      await appendFile(logPath, JSON.stringify({ type, ...data, ts: Date.now() }) + '\n');
    } catch {}
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  export(namespace) {
    const ns = this._ns(namespace);
    return {
      namespace: namespace || this.defaultNamespace,
      documents: [...ns.docs.values()],
      chunks: ns.chunks,
      stats: this.stats(namespace)
    };
  }

  import(data, namespace) {
    const ns = this._ns(namespace);
    for (const doc of (data.documents || [])) {
      ns.docs.set(doc.id, doc);
    }
    ns.chunks = data.chunks || [];
    this._rebuildIndex(ns);
    this.emit('imported', { namespace: namespace || this.defaultNamespace });
  }

  destroy() {
    if (this._persistTimer) clearInterval(this._persistTimer);
    this._namespaces.clear();
  }
}

export default AgentRAG;
