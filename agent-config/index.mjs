/**
 * agent-config v1.0 — Zero-dependency configuration manager for AI agents
 * 
 * Features:
 * - Multi-source loading (defaults → file → env → runtime)
 * - Schema validation with type coercion
 * - Hot-reload with file watching (polling, zero deps)
 * - Secrets masking (auto-detect + custom patterns)
 * - Hierarchical namespaces
 * - Environment variable mapping with prefix support
 * - Config change history with JSONL persistence
 * - Template interpolation ({{section.key}})
 * - Config snapshots and rollback
 * - EventEmitter for change events
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const DEFAULTS = {
  dataDir: './data',
  envPrefix: 'AGENT_',
  autoSave: true,
  watchInterval: 2000,
  maxHistory: 1000,
  secretsPatterns: [/password/i, /secret/i, /token/i, /key/i, /apikey/i, /api_key/i, /credential/i, /auth/i],
  maskValue: '********',
};

class AgentConfig extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this._config = {};
    this._schema = {};
    this._secrets = new Set();
    this._history = [];
    this._watchers = new Map();
    this._snapshots = new Map();
    this._envMappings = new Map();
    this._dataDir = this.opts.dataDir;
    this._changeLogPath = join(this._dataDir, 'config-changes.jsonl');

    if (!existsSync(this._dataDir)) mkdirSync(this._dataDir, { recursive: true });
  }

  // ── Schema ──

  defineSchema(schema) {
    this._schema = { ...this._schema, ...schema };
    return this;
  }

  _validateValue(key, value, spec) {
    if (!spec) return { valid: true, value };

    let coerced = value;

    // Type coercion
    if (spec.type) {
      switch (spec.type) {
        case 'string':
          coerced = String(coerced);
          break;
        case 'number':
          coerced = Number(coerced);
          if (isNaN(coerced)) return { valid: false, error: `${key}: expected number, got "${value}"` };
          break;
        case 'boolean':
          if (typeof coerced === 'string') {
            coerced = coerced.toLowerCase() === 'true' || coerced === '1';
          } else {
            coerced = Boolean(coerced);
          }
          break;
        case 'array':
          if (typeof coerced === 'string') {
            try { coerced = JSON.parse(coerced); } catch { coerced = coerced.split(',').map(s => s.trim()); }
          }
          if (!Array.isArray(coerced)) return { valid: false, error: `${key}: expected array` };
          break;
        case 'object':
          if (typeof coerced === 'string') {
            try { coerced = JSON.parse(coerced); } catch { return { valid: false, error: `${key}: expected object` }; }
          }
          break;
      }
    }

    // Enum validation
    if (spec.enum && !spec.enum.includes(coerced)) {
      return { valid: false, error: `${key}: must be one of [${spec.enum.join(', ')}], got "${coerced}"` };
    }

    // Min/max for numbers
    if (spec.type === 'number') {
      if (spec.min !== undefined && coerced < spec.min) return { valid: false, error: `${key}: must be >= ${spec.min}` };
      if (spec.max !== undefined && coerced > spec.max) return { valid: false, error: `${key}: must be <= ${spec.max}` };
    }

    // Required check (handled at validateAll)
    return { valid: true, value: coerced };
  }

  validate() {
    const errors = [];
    const result = {};

    // Check required fields
    for (const [key, spec] of Object.entries(this._schema)) {
      const current = this.get(key);

      if (current === undefined || current === null) {
        if (spec.default !== undefined) {
          result[key] = spec.default;
          this._setNested(key, spec.default);
        } else if (spec.required) {
          errors.push(`${key}: required but missing`);
        }
        continue;
      }

      const validation = this._validateValue(key, current, spec);
      if (!validation.valid) {
        errors.push(validation.error);
      } else {
        result[key] = validation.value;
        this._setNested(key, validation.value);
      }
    }

    return { valid: errors.length === 0, errors, config: result };
  }

  // ── Get/Set ──

  get(path, defaultValue) {
    return this._getNested(this._config, path, defaultValue);
  }

  set(path, value, { source = 'runtime', silent = false } = {}) {
    const oldValue = this.get(path);

    // Validate if schema exists
    const spec = this._getSchemaSpec(path);
    if (spec) {
      const validation = this._validateValue(path, value, spec);
      if (!validation.valid) throw new Error(validation.error);
      value = validation.value;
    }

    this._setNested(path, value);

    // Log change
    const change = {
      timestamp: new Date().toISOString(),
      path,
      oldValue: this._isSecret(path) ? this.opts.maskValue : oldValue,
      newValue: this._isSecret(path) ? this.opts.maskValue : value,
      source,
    };
    this._history.push(change);
    if (this._history.length > this.opts.maxHistory) this._history.shift();

    // Persist change
    try { appendFileSync(this._changeLogPath, JSON.stringify(change) + '\n'); } catch {}

    if (!silent) {
      this.emit('change', { path, oldValue, value, source });
      this.emit(`change:${path}`, { oldValue, value, source });
    }

    if (this.opts.autoSave) this.save();
    return this;
  }

  _sentinel = Symbol('missing');

  has(path) {
    return this._getNested(this._config, path, this._sentinel) !== this._sentinel;
  }

  delete(path, opts = {}) {
    const parts = path.split('.');
    const last = parts.pop();
    const parent = parts.length ? this._getNested(this._config, parts.join('.')) : this._config;
    if (parent && typeof parent === 'object') {
      const old = parent[last];
      delete parent[last];
      const change = { timestamp: new Date().toISOString(), path, oldValue: this._isSecret(path) ? this.opts.maskValue : old, newValue: undefined, source: opts.source || 'runtime' };
      this._history.push(change);
      this.emit('change', { path, oldValue: old, value: undefined, source: opts.source || 'runtime' });
      if (this.opts.autoSave) this.save();
    }
    return this;
  }

  getAll() {
    return JSON.parse(JSON.stringify(this._config));
  }

  keys(prefix = '') {
    const target = prefix ? this._getNested(this._config, prefix) : this._config;
    if (!target || typeof target !== 'object') return [];
    return Object.keys(target);
  }

  // ── Env Overrides ──

  mapEnv(envVar, configPath, spec) {
    this._envMappings.set(envVar, { configPath, spec });
    return this;
  }

  loadEnv(env = process.env) {
    // Auto-map based on prefix
    for (const [key, value] of Object.entries(env)) {
      if (!key.startsWith(this.opts.envPrefix)) continue;
      const configKey = key.slice(this.opts.envPrefix.length).toLowerCase().replace(/__/g, '.');
      this.set(configKey, value, { source: 'env', silent: true });
    }

    // Explicit mappings
    for (const [envVar, { configPath, spec }] of this._envMappings) {
      if (env[envVar] !== undefined) {
        let val = env[envVar];
        if (spec) {
          const r = this._validateValue(configPath, val, spec);
          if (r.valid) val = r.value;
        }
        this.set(configPath, val, { source: 'env', silent: true });
      }
    }

    this.emit('loaded', { source: 'env' });
    return this;
  }

  // ── File Loading ──

  loadFile(filePath) {
    if (!existsSync(filePath)) throw new Error(`Config file not found: ${filePath}`);
    const raw = readFileSync(filePath, 'utf-8');

    let data;
    if (filePath.endsWith('.json')) {
      data = JSON.parse(raw);
    } else if (filePath.endsWith('.json5') || filePath.endsWith('.jsonc')) {
      data = JSON.parse(raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
    } else {
      throw new Error(`Unsupported config format: ${filePath}`);
    }

    this._mergeDeep(this._config, data, 'file:' + filePath);
    this.emit('loaded', { source: 'file', path: filePath });
    return this;
  }

  loadObject(obj, source = 'object') {
    this._mergeDeep(this._config, obj, source);
    this.emit('loaded', { source });
    return this;
  }

  // ── Hot Reload ──

  watch(filePath, interval = this.opts.watchInterval) {
    if (this._watchers.has(filePath)) return this;
    let lastMtime = 0;
    try { lastMtime = existsSync(filePath) ? readFileSync.bind(null, filePath).length : 0; } catch {}

    const timer = setInterval(() => {
      try {
        const stat = existsSync(filePath);
        if (!stat) return;
        const content = readFileSync(filePath, 'utf-8');
        const hash = content.length;
        if (hash !== lastMtime) {
          lastMtime = hash;
          const prev = this.getAll();
          this.loadFile(filePath);
          this.emit('reload', { path: filePath, previous: prev, current: this.getAll() });
        }
      } catch {}
    }, interval);

    this._watchers.set(filePath, timer);
    this.emit('watch:start', { path: filePath, interval });
    return this;
  }

  unwatch(filePath) {
    const timer = this._watchers.get(filePath);
    if (timer) {
      clearInterval(timer);
      this._watchers.delete(filePath);
      this.emit('watch:stop', { path: filePath });
    }
    return this;
  }

  unwatchAll() {
    for (const [path] of this._watchers) this.unwatch(path);
    return this;
  }

  // ── Secrets ──

  markSecret(path) {
    this._secrets.add(path);
    return this;
  }

  unmarkSecret(path) {
    this._secrets.delete(path);
    return this;
  }

  _isSecret(path) {
    if (this._secrets.has(path)) return true;
    return this.opts.secretsPatterns.some(p => p.test(path));
  }

  getMasked(path) {
    if (this._isSecret(path)) return this.opts.maskValue;
    return this.get(path);
  }

  getAllMasked() {
    return this._maskObject(this._config, '');
  }

  _maskObject(obj, prefix) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      if (this._isSecret(fullPath)) {
        result[key] = this.opts.maskValue;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this._maskObject(value, fullPath);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // ── Snapshots ──

  snapshot(name) {
    this._snapshots.set(name, JSON.parse(JSON.stringify(this._config)));
    this.emit('snapshot', { name });
    return this;
  }

  rollback(name) {
    const snap = this._snapshots.get(name);
    if (!snap) throw new Error(`Snapshot not found: ${name}`);
    const prev = this.getAll();
    this._config = JSON.parse(JSON.stringify(snap));
    this.emit('rollback', { name, previous: prev, current: this._config });
    if (this.opts.autoSave) this.save();
    return this;
  }

  listSnapshots() {
    return [...this._snapshots.keys()];
  }

  deleteSnapshot(name) {
    this._snapshots.delete(name);
    return this;
  }

  // ── Template Interpolation ──

  interpolate(template) {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const val = this.get(path.trim());
      return val !== undefined ? String(val) : `{{${path}}}`;
    });
  }

  // ── Persistence ──

  save(filePath) {
    const path = filePath || join(this._dataDir, 'config.json');
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(this._config, null, 2));
    return this;
  }

  load(filePath) {
    const path = filePath || join(this._dataDir, 'config.json');
    if (existsSync(path)) {
      this.loadFile(path);
    }
    return this;
  }

  exportJSON() {
    return JSON.stringify(this.getAllMasked(), null, 2);
  }

  history(limit = 50) {
    return this._history.slice(-limit);
  }

  // ── Namespace helpers ──

  namespace(ns) {
    return {
      get: (path, def) => this.get(`${ns}.${path}`, def),
      set: (path, val, opts) => this.set(`${ns}.${path}`, val, opts),
      has: (path) => this.has(`${ns}.${path}`),
      delete: (path, opts) => this.delete(`${ns}.${path}`, opts),
      getAll: () => this.get(ns, {}),
    };
  }

  // ── Stats ──

  stats() {
    const countKeys = (obj) => {
      let count = 0;
      for (const v of Object.values(obj)) {
        count++;
        if (v && typeof v === 'object' && !Array.isArray(v)) count += countKeys(v);
      }
      return count;
    };

    return {
      totalKeys: countKeys(this._config),
      schemaFields: Object.keys(this._schema).length,
      secrets: this._secrets.size,
      snapshots: this._snapshots.size,
      watchers: this._watchers.size,
      envMappings: this._envMappings.size,
      changes: this._history.length,
    };
  }

  // ── Internal ──

  _getNested(obj, path, defaultValue) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null || typeof current !== 'object') return defaultValue;
      current = current[part];
    }
    return current !== undefined ? current : defaultValue;
  }

  _setNested(path, value) {
    const parts = path.split('.');
    let current = this._config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  _getSchemaSpec(path) {
    const parts = path.split('.');
    let current = this._schema;
    for (const part of parts) {
      if (!current) return undefined;
      current = current[part] || current.properties?.[part];
    }
    return current;
  }

  _mergeDeep(target, source, sourceName) {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
        this._mergeDeep(target[key], value, sourceName);
      } else {
        const fullPath = key;
        target[key] = value;
        const change = { timestamp: new Date().toISOString(), path: fullPath, newValue: this._isSecret(fullPath) ? this.opts.maskValue : value, source: sourceName };
        this._history.push(change);
      }
    }
  }

  destroy() {
    this.unwatchAll();
    this.removeAllListeners();
  }
}

export default AgentConfig;
export { AgentConfig };
