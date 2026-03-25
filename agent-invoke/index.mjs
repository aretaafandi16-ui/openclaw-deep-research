import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * AgentInvoke — zero-dep tool execution engine for AI agents
 * 
 * Features:
 * - Tool registry with JSON Schema validation
 * - Type-safe input/output validation
 * - Automatic retry with exponential backoff
 * - Result caching with TTL
 * - Tool composition (chain, pipeline, conditional)
 * - Execution history & stats
 * - Rate limiting per tool
 * - Middleware hooks (before/after/error)
 * - JSONL persistence
 * - EventEmitter integration
 */
export class AgentInvoke extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.tools = new Map();
    this.history = [];
    this.cache = new Map();
    this.stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      cachedCalls: 0,
      retriedCalls: 0,
      totalDuration: 0,
      byTool: {}
    };
    this.middleware = { before: [], after: [], error: [] };
    this.dataDir = opts.dataDir || null;
    this.defaultTimeout = opts.defaultTimeout || 30000;
    this.defaultRetries = opts.defaultRetries || 0;
    this.defaultCacheTTL = opts.defaultCacheTTL || 0;
    this.maxHistory = opts.maxHistory || 10000;
    this.rateLimits = new Map(); // tool_name -> { window, max, calls[] }
  }

  // ─── Tool Registration ───

  register(name, handler, opts = {}) {
    if (this.tools.has(name)) throw new Error(`Tool '${name}' already registered`);
    const tool = {
      name,
      handler,
      description: opts.description || '',
      inputSchema: opts.inputSchema || null,
      outputSchema: opts.outputSchema || null,
      timeout: opts.timeout ?? this.defaultTimeout,
      retries: opts.retries ?? this.defaultRetries,
      cacheTTL: opts.cacheTTL ?? this.defaultCacheTTL,
      tags: opts.tags || [],
      rateLimit: opts.rateLimit || null, // { max, windowMs }
      version: opts.version || '1.0.0',
      deprecated: opts.deprecated || false,
      metadata: opts.metadata || {}
    };
    this.tools.set(name, tool);
    this.stats.byTool[name] = {
      calls: 0, success: 0, failed: 0, cached: 0,
      totalDuration: 0, lastCalled: null
    };
    if (tool.rateLimit) {
      this.rateLimits.set(name, { max: tool.rateLimit.max, windowMs: tool.rateLimit.windowMs, calls: [] });
    }
    this.emit('tool:registered', { name, version: tool.version });
    return this;
  }

  unregister(name) {
    this.tools.delete(name);
    this.rateLimits.delete(name);
    delete this.stats.byTool[name];
    this.emit('tool:unregistered', { name });
    return this;
  }

  getTool(name) {
    return this.tools.get(name) || null;
  }

  listTools(opts = {}) {
    let tools = [...this.tools.values()];
    if (opts.tag) tools = tools.filter(t => t.tags.includes(opts.tag));
    if (opts.search) {
      const q = opts.search.toLowerCase();
      tools = tools.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      tags: t.tags,
      version: t.version,
      deprecated: t.deprecated,
      metadata: t.metadata
    }));
  }

  // ─── Schema Validation ───

  validate(data, schema, label = 'input') {
    if (!schema) return { valid: true, errors: [] };
    const errors = [];
    this._validateNode(data, schema, '', errors);
    return {
      valid: errors.length === 0,
      errors: errors.map(e => `${label}${e}`)
    };
  }

  _validateNode(data, schema, path, errors) {
    if (!schema) return;
    if (schema.type) {
      const actualType = Array.isArray(data) ? 'array' : typeof data;
      if (schema.type === 'integer') {
        if (typeof data !== 'number' || !Number.isInteger(data)) errors.push(`${path}: expected integer, got ${typeof data}`);
      } else if (schema.type === 'number') {
        if (typeof data !== 'number') errors.push(`${path}: expected number, got ${typeof data}`);
      } else if (schema.type === 'boolean') {
        if (typeof data !== 'boolean') errors.push(`${path}: expected boolean, got ${typeof data}`);
      } else if (schema.type === 'string') {
        if (typeof data !== 'string') errors.push(`${path}: expected string, got ${typeof data}`);
      } else if (schema.type === 'array') {
        if (!Array.isArray(data)) errors.push(`${path}: expected array, got ${actualType}`);
      } else if (schema.type === 'object') {
        if (typeof data !== 'object' || data === null || Array.isArray(data)) errors.push(`${path}: expected object, got ${actualType}`);
      }
    }
    if (schema.required && typeof data === 'object' && data !== null) {
      for (const key of schema.required) {
        if (!(key in data)) errors.push(`${path}.${key}: required field missing`);
      }
    }
    if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) this._validateNode(data[key], propSchema, `${path}.${key}`, errors);
      }
    }
    if (schema.items && Array.isArray(data)) {
      data.forEach((item, i) => this._validateNode(item, schema.items, `${path}[${i}]`, errors));
    }
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push(`${path}: expected one of [${schema.enum.join(', ')}], got ${data}`);
    }
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path}: ${data} < minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path}: ${data} > maximum ${schema.maximum}`);
    }
    if (typeof data === 'string') {
      if (schema.minLength !== undefined && data.length < schema.minLength) errors.push(`${path}: length ${data.length} < minLength ${schema.minLength}`);
      if (schema.maxLength !== undefined && data.length > schema.maxLength) errors.push(`${path}: length ${data.length} > maxLength ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  }

  // ─── Middleware ───

  before(fn) { this.middleware.before.push(fn); return this; }
  after(fn) { this.middleware.after.push(fn); return this; }
  onError(fn) { this.middleware.error.push(fn); return this; }

  // ─── Core Execution ───

  async call(name, input = {}, opts = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool '${name}' not found`);
    if (tool.deprecated) this.emit('tool:deprecated', { name });

    // Rate limit check
    const rl = this.rateLimits.get(name);
    if (rl) {
      const now = Date.now();
      rl.calls = rl.calls.filter(t => now - t < rl.windowMs);
      if (rl.calls.length >= rl.max) {
        const err = new Error(`Rate limit exceeded for '${name}' (${rl.max}/${rl.windowMs}ms)`);
        err.code = 'RATE_LIMITED';
        throw err;
      }
      rl.calls.push(now);
    }

    // Validate input
    if (tool.inputSchema) {
      const v = this.validate(input, tool.inputSchema, 'input');
      if (!v.valid) {
        const err = new Error(`Input validation failed: ${v.errors.join('; ')}`);
        err.code = 'VALIDATION_ERROR';
        err.validationErrors = v.errors;
        throw err;
      }
    }

    // Cache check
    const cacheKey = opts.cacheKey || (tool.cacheTTL > 0 ? this._cacheKey(name, input) : null);
    if (cacheKey && this.cache.has(cacheKey)) {
      const entry = this.cache.get(cacheKey);
      if (Date.now() - entry.ts < entry.ttl) {
        this.stats.cachedCalls++;
        this.stats.byTool[name].cached++;
        this.emit('tool:cache_hit', { name, cacheKey });
        return { ...entry.result, cached: true };
      }
      this.cache.delete(cacheKey);
    }

    // Build execution context
    const callId = opts.callId || randomUUID();
    const ctx = { callId, name, input, tool, opts, startTime: Date.now() };

    // Before middleware
    for (const mw of this.middleware.before) {
      try { await mw(ctx); } catch (e) { /* middleware errors non-fatal */ }
    }

    // Execute with retry
    const retries = opts.retries ?? tool.retries;
    const timeout = opts.timeout ?? tool.timeout;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) this.stats.retriedCalls++;
        const result = await this._executeWithTimeout(tool.handler, input, timeout);
        const duration = Date.now() - ctx.startTime;

        // Validate output
        if (tool.outputSchema) {
          const v = this.validate(result, tool.outputSchema, 'output');
          if (!v.valid) {
            throw new Error(`Output validation failed: ${v.errors.join('; ')}`);
          }
        }

        const entry = { callId, name, input, output: result, duration, attempt, success: true, ts: Date.now() };

        // Cache result
        if (cacheKey && tool.cacheTTL > 0) {
          this.cache.set(cacheKey, { result: entry, ts: Date.now(), ttl: tool.cacheTTL });
        }

        this._recordHistory(entry);
        this._updateStats(name, duration, true);

        // After middleware
        for (const mw of this.middleware.after) {
          try { await mw(ctx, entry); } catch (e) { /* non-fatal */ }
        }

        this.emit('tool:success', entry);
        return entry;

      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          this.emit('tool:retry', { name, attempt: attempt + 1, error: err.message, delay });
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // All retries failed
    const duration = Date.now() - ctx.startTime;
    const entry = { callId, name, input, error: lastError.message, duration, attempt: retries, success: false, ts: Date.now() };
    this._recordHistory(entry);
    this._updateStats(name, duration, false);

    // Error middleware
    for (const mw of this.middleware.error) {
      try { await mw(ctx, entry, lastError); } catch (e) { /* non-fatal */ }
    }

    this.emit('tool:error', entry);
    return entry;
  }

  // ─── Tool Composition ───

  async chain(steps, initialInput = {}) {
    let result = initialInput;
    const results = [];
    for (const step of steps) {
      const input = step.transform ? step.transform(result) : (step.input || result);
      const callResult = await this.call(step.tool, input, step.opts || {});
      if (!callResult.success && !step.continueOnError) {
        return { success: false, step: step.tool, results, error: callResult.error };
      }
      result = step.extract ? step.extract(callResult.output) : callResult.output;
      results.push(callResult);
    }
    return { success: true, result, results };
  }

  async pipeline(steps, input = {}) {
    return this.chain(steps, input);
  }

  async conditional(condition, trueTool, falseTool, input = {}) {
    const branch = typeof condition === 'function' ? await condition(input) : condition;
    const toolName = branch ? trueTool : falseTool;
    return this.call(toolName, input);
  }

  async parallel(calls) {
    const results = await Promise.allSettled(
      calls.map(c => this.call(c.tool, c.input || {}, c.opts || {}))
    );
    return results.map((r, i) => ({
      tool: calls[i].tool,
      status: r.status,
      value: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? r.reason.message : null
    }));
  }

  async race(calls) {
    return Promise.race(
      calls.map(c => this.call(c.tool, c.input || {}, c.opts || {}))
    );
  }

  async fallback(calls, input = {}) {
    for (const c of calls) {
      try {
        const result = await this.call(c.tool, input, c.opts || {});
        if (result.success) return result;
      } catch (e) {
        this.emit('tool:fallback', { tool: c.tool, error: e.message });
      }
    }
    throw new Error('All fallback tools failed');
  }

  // ─── History & Stats ───

  getHistory(opts = {}) {
    let h = [...this.history];
    if (opts.tool) h = h.filter(e => e.name === opts.tool);
    if (opts.success !== undefined) h = h.filter(e => e.success === opts.success);
    if (opts.since) h = h.filter(e => e.ts >= opts.since);
    if (opts.limit) h = h.slice(-opts.limit);
    return h;
  }

  getStats() {
    return { ...this.stats, tools: this.stats.byTool, cacheSize: this.cache.size, registeredTools: this.tools.size };
  }

  getToolStats(name) {
    return this.stats.byTool[name] || null;
  }

  clearCache(filter) {
    if (!filter) { this.cache.clear(); return; }
    for (const [key, val] of this.cache) {
      if (filter(key, val)) this.cache.delete(key);
    }
  }

  // ─── Import/Export (MCP-compatible) ───

  toMCPTools() {
    return [...this.tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ? {
        type: 'object',
        properties: t.inputSchema.properties || {},
        required: t.inputSchema.required || []
      } : { type: 'object', properties: {} }
    }));
  }

  async callMCP(name, args) {
    const result = await this.call(name, args);
    if (!result.success) throw new Error(result.error);
    return result.output;
  }

  // ─── Persistence ───

  async save() {
    if (!this.dataDir) return;
    await mkdir(this.dataDir, { recursive: true });
    const state = { stats: this.stats, history: this.history.slice(-this.maxHistory) };
    await writeFile(join(this.dataDir, 'state.json'), JSON.stringify(state, null, 2));
    // Append to JSONL
    const line = JSON.stringify({ ts: Date.now(), type: 'snapshot', stats: this.stats }) + '\n';
    await writeFile(join(this.dataDir, 'events.jsonl'), line, { flag: 'a' });
  }

  async load() {
    if (!this.dataDir) return;
    const stateFile = join(this.dataDir, 'state.json');
    if (existsSync(stateFile)) {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      if (state.stats) Object.assign(this.stats, state.stats);
      if (state.history) this.history = state.history;
    }
  }

  // ─── Internal ───

  _cacheKey(name, input) {
    const hash = createHash('sha256').update(JSON.stringify({ name, input })).digest('hex');
    return `${name}:${hash.slice(0, 16)}`;
  }

  async _executeWithTimeout(handler, input, timeout) {
    return new Promise((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout) : null;
      Promise.resolve(handler(input))
        .then(r => { if (timer) clearTimeout(timer); resolve(r); })
        .catch(e => { if (timer) clearTimeout(timer); reject(e); });
    });
  }

  _recordHistory(entry) {
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
  }

  _updateStats(name, duration, success) {
    this.stats.totalCalls++;
    this.stats.totalDuration += duration;
    if (success) this.stats.successCalls++; else this.stats.failedCalls++;
    const s = this.stats.byTool[name];
    if (s) {
      s.calls++;
      s.totalDuration += duration;
      s.lastCalled = Date.now();
      if (success) s.success++; else s.failed++;
    }
  }
}

export default AgentInvoke;
