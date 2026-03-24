/**
 * agent-guard — Schema validation & guardrails for AI agents
 * Zero dependencies. Zero excuses.
 *
 * Features:
 *  - JSON Schema–like validation DSL (type, required, pattern, min/max, enum, nested)
 *  - Content guardrails (PII detection, profanity filter, length limits, custom rules)
 *  - Rate limiting per operation (sliding window)
 *  - Audit trail (JSONL persistence)
 *  - Guard profiles (compose multiple rules into named profiles)
 *  - EventEmitter for real-time alerting
 */

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Validators ─────────────────────────────────────────────────────────────

const VALIDATORS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && !isNaN(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  null: (v) => v === null,
};

function validateField(value, rule, path = '') {
  const errors = [];

  // Type check
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    const ok = types.some((t) => VALIDATORS[t]?.(value) ?? typeof value === t);
    if (!ok) {
      errors.push({ path, error: `expected type ${types.join('|')}, got ${typeof value}`, value });
      return errors; // no point checking further
    }
  }

  // Required
  if (rule.required && (value === undefined || value === null)) {
    errors.push({ path, error: 'required but missing' });
    return errors;
  }

  if (value === undefined || value === null) return errors;

  // String rules
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength)
      errors.push({ path, error: `minLength ${rule.minLength}, got ${value.length}` });
    if (rule.maxLength !== undefined && value.length > rule.maxLength)
      errors.push({ path, error: `maxLength ${rule.maxLength}, got ${value.length}` });
    if (rule.pattern && !new RegExp(rule.pattern).test(value))
      errors.push({ path, error: `pattern mismatch: ${rule.pattern}` });
    if (rule.format) {
      const formatRegexes = {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        url: /^https?:\/\/.+/,
        uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        date: /^\d{4}-\d{2}-\d{2}$/,
        datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
        ipv4: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
      };
      if (formatRegexes[rule.format] && !formatRegexes[rule.format].test(value))
        errors.push({ path, error: `format mismatch: ${rule.format}` });
    }
    if (rule.enum && !rule.enum.includes(value))
      errors.push({ path, error: `must be one of: ${rule.enum.join(', ')}` });
  }

  // Number rules
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum)
      errors.push({ path, error: `minimum ${rule.minimum}, got ${value}` });
    if (rule.maximum !== undefined && value > rule.maximum)
      errors.push({ path, error: `maximum ${rule.maximum}, got ${value}` });
    if (rule.enum && !rule.enum.includes(value))
      errors.push({ path, error: `must be one of: ${rule.enum.join(', ')}` });
  }

  // Array rules
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems)
      errors.push({ path, error: `minItems ${rule.minItems}, got ${value.length}` });
    if (rule.maxItems !== undefined && value.length > rule.maxItems)
      errors.push({ path, error: `maxItems ${rule.maxItems}, got ${value.length}` });
    if (rule.items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateField(value[i], rule.items, `${path}[${i}]`));
      }
    }
  }

  // Object rules (nested schema)
  if (rule.properties && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, propRule] of Object.entries(rule.properties)) {
      errors.push(...validateField(value[key], propRule, `${path}.${key}`));
    }
    if (rule.required) {
      const req = Array.isArray(rule.required) ? rule.required : Object.keys(rule.properties);
      for (const key of req) {
        if (value[key] === undefined) {
          errors.push({ path: `${path}.${key}`, error: 'required but missing' });
        }
      }
    }
    // additionalProperties check
    if (rule.additionalProperties === false) {
      const allowed = new Set(Object.keys(rule.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${path}.${key}`, error: 'additional property not allowed' });
        }
      }
    }
  }

  // Custom validator
  if (rule.validate && typeof rule.validate === 'function') {
    const result = rule.validate(value);
    if (result !== true) {
      errors.push({ path, error: typeof result === 'string' ? result : 'custom validation failed' });
    }
  }

  return errors;
}

function validateSchema(data, schema) {
  return validateField(data, schema, '$');
}

// ─── Content Guardrails ──────────────────────────────────────────────────────

const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ip: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  jwt: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
};

const PROFANITY_LIST = new Set([
  'damn', 'hell', 'crap', 'shit', 'fuck', 'ass', 'bitch', 'bastard',
  'dick', 'piss', 'cock', 'pussy', 'asshole',
]);

function detectPII(text) {
  const found = [];
  if (typeof text !== 'string') return found;
  for (const [type, regex] of Object.entries(PII_PATTERNS)) {
    const matches = text.match(regex);
    if (matches) found.push({ type, count: matches.length, samples: matches.slice(0, 3) });
  }
  return found;
}

function redactPII(text, replacements = {}) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const [type, regex] of Object.entries(PII_PATTERNS)) {
    const repl = replacements[type] || `[REDACTED_${type.toUpperCase()}]`;
    result = result.replace(regex, repl);
  }
  return result;
}

function detectProfanity(text) {
  if (typeof text !== 'string') return [];
  const words = text.toLowerCase().split(/\s+/);
  return words.filter((w) => PROFANITY_LIST.has(w.replace(/[^a-z]/g, '')));
}

function sanitizeText(text, rules = {}) {
  if (typeof text !== 'string') return text;
  let result = text;
  if (rules.redactPII) result = redactPII(result);
  if (rules.stripHTML) result = result.replace(/<[^>]*>/g, '');
  if (rules.stripMarkdown) result = result.replace(/[*_~`#>\[\]()!|]/g, '');
  if (rules.maxLength) result = result.slice(0, rules.maxLength);
  if (rules.lowercase) result = result.toLowerCase();
  if (rules.trim) result = result.trim();
  return result;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class RateLimiter {
  constructor() {
    this.windows = new Map(); // key → { count, windowStart, limit, windowMs }
  }

  configure(key, limit, windowMs = 60000) {
    const existing = this.windows.get(key);
    if (existing && existing.limit === limit && existing.windowMs === windowMs) return;
    this.windows.set(key, { count: 0, windowStart: Date.now(), limit, windowMs });
  }

  check(key) {
    const w = this.windows.get(key);
    if (!w) return { allowed: true, remaining: Infinity, resetIn: 0 };
    const now = Date.now();
    if (now - w.windowStart >= w.windowMs) {
      w.count = 0;
      w.windowStart = now;
    }
    const remaining = w.limit - w.count;
    const resetIn = Math.max(0, w.windowMs - (now - w.windowStart));
    return { allowed: remaining > 0, remaining, resetIn, limit: w.limit };
  }

  consume(key) {
    const w = this.windows.get(key);
    if (!w) return { allowed: true, remaining: Infinity, resetIn: 0 };
    const now = Date.now();
    if (now - w.windowStart >= w.windowMs) {
      w.count = 0;
      w.windowStart = now;
    }
    const remaining = w.limit - w.count;
    const resetIn = Math.max(0, w.windowMs - (now - w.windowStart));
    if (remaining > 0) w.count++;
    return { allowed: remaining > 0, remaining: remaining - 1, resetIn, limit: w.limit };
  }

  reset(key) {
    const w = this.windows.get(key);
    if (w) { w.count = 0; w.windowStart = Date.now(); }
  }

  stats() {
    const out = {};
    for (const [key, w] of this.windows) {
      out[key] = { count: w.count, limit: w.limit, windowMs: w.windowMs, windowStart: w.windowStart };
    }
    return out;
  }
}

// ─── Audit Logger ────────────────────────────────────────────────────────────

class AuditLogger {
  constructor(dataDir) {
    this.dataDir = dataDir || join(process.cwd(), 'data');
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    this.logFile = join(this.dataDir, 'audit.jsonl');
  }

  log(entry) {
    const record = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(this.logFile, JSON.stringify(record) + '\n');
    return record;
  }

  read({ limit = 100, since, operation, action } = {}) {
    if (!existsSync(this.logFile)) return [];
    const lines = readFileSync(this.logFile, 'utf-8').trim().split('\n').filter(Boolean);
    let entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (since) {
      const sinceDate = new Date(since).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceDate);
    }
    if (operation) entries = entries.filter((e) => e.operation === operation);
    if (action) entries = entries.filter((e) => e.action === action);
    return entries.slice(-limit);
  }

  stats() {
    const entries = this.read({ limit: 10000 });
    const passed = entries.filter((e) => e.action === 'pass').length;
    const blocked = entries.filter((e) => e.action === 'block').length;
    const warned = entries.filter((e) => e.action === 'warn').length;
    const byOp = {};
    for (const e of entries) {
      byOp[e.operation] = byOp[e.operation] || { pass: 0, block: 0, warn: 0 };
      byOp[e.operation][e.action]++;
    }
    return { total: entries.length, passed, blocked, warned, byOperation: byOp };
  }
}

// ─── AgentGuard Core ─────────────────────────────────────────────────────────

class AgentGuard extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.schemas = new Map();
    this.rules = new Map();
    this.profiles = new Map();
    this.rateLimiter = new RateLimiter();
    this.audit = new AuditLogger(opts.dataDir);
    this.strictMode = opts.strict ?? true;
    this.autoRedact = opts.autoRedact ?? false;
    this.stats = { totalChecks: 0, passed: 0, blocked: 0, warned: 0 };
  }

  // ── Schema Management ──

  addSchema(name, schema) {
    this.schemas.set(name, schema);
    return this;
  }

  removeSchema(name) {
    this.schemas.delete(name);
    return this;
  }

  getSchema(name) {
    return this.schemas.get(name);
  }

  listSchemas() {
    return [...this.schemas.keys()];
  }

  // ── Validation ──

  validate(data, schemaName) {
    const schema = typeof schemaName === 'string' ? this.schemas.get(schemaName) : schemaName;
    if (!schema) {
      return { valid: false, errors: [{ path: '$', error: `schema not found: ${schemaName}` }] };
    }
    const errors = validateSchema(data, schema);
    return { valid: errors.length === 0, errors };
  }

  // ── Custom Rules ──

  addRule(name, rule) {
    this.rules.set(name, {
      name,
      description: rule.description || '',
      check: rule.check, // (input) => { pass: bool, message?: string }
      severity: rule.severity || 'error', // error | warning | info
      apply: rule.apply || 'input', // input | output | both
    });
    return this;
  }

  removeRule(name) {
    this.rules.delete(name);
    return this;
  }

  listRules() {
    return [...this.rules.values()].map((r) => ({
      name: r.name, description: r.description, severity: r.severity, apply: r.apply,
    }));
  }

  // ── Profiles (named collections of schemas + rules) ──

  addProfile(name, profile) {
    this.profiles.set(name, {
      name,
      schema: profile.schema || null,
      rules: profile.rules || [],
      contentGuard: profile.contentGuard || {},
      rateLimit: profile.rateLimit || null,
      description: profile.description || '',
    });
    return this;
  }

  getProfile(name) {
    return this.profiles.get(name);
  }

  listProfiles() {
    return [...this.profiles.values()].map((p) => ({
      name: p.name, description: p.description,
      hasSchema: !!p.schema, ruleCount: p.rules.length,
      hasContentGuard: Object.keys(p.contentGuard).length > 0,
      hasRateLimit: !!p.rateLimit,
    }));
  }

  // ── Guard Execution ──

  guard(data, options = {}) {
    this.stats.totalChecks++;
    const result = {
      allowed: true,
      errors: [],
      warnings: [],
      info: [],
      sanitized: data,
      auditId: null,
    };

    const operation = options.operation || 'default';
    const direction = options.direction || 'input';
    const profile = options.profile ? this.profiles.get(options.profile) : null;

    // Rate limit
    const rlKey = `guard:${operation}`;
    const rlOpts = profile?.rateLimit || options.rateLimit;
    if (rlOpts) {
      this.rateLimiter.configure(rlKey, rlOpts.limit, rlOpts.windowMs);
    }
    const rl = this.rateLimiter.consume(rlKey);
    if (!rl.allowed) {
      result.allowed = false;
      result.errors.push({ path: '$', error: `rate limit exceeded (${rl.limit} per ${rl.windowMs}ms), reset in ${rl.resetIn}ms` });
      this.stats.blocked++;
      result.auditId = this.audit.log({ operation, action: 'block', reason: 'rate_limit', direction }).timestamp;
      this.emit('block', { operation, reason: 'rate_limit', data });
      return result;
    }

    // Schema validation
    const schema = profile?.schema || options.schema;
    if (schema) {
      const schemaName = typeof schema === 'string' ? schema : null;
      const schemaObj = schemaName ? this.schemas.get(schemaName) : schema;
      if (!schemaObj) {
        result.warnings.push({ path: '$', error: `schema not found: ${schemaName}` });
      } else {
        const vErrors = validateSchema(data, schemaObj);
        for (const e of vErrors) {
          if (this.strictMode) {
            result.errors.push(e);
            result.allowed = false;
          } else {
            result.warnings.push(e);
          }
        }
      }
    }

    // Custom rules
    const ruleNames = profile?.rules || options.rules || [];
    for (const rName of ruleNames) {
      const rule = this.rules.get(rName);
      if (!rule) continue;
      if (direction === 'input' && rule.apply === 'output') continue;
      if (direction === 'output' && rule.apply === 'input') continue;
      try {
        const r = rule.check(data);
        if (r.pass === false) {
          const entry = { path: '$', error: r.message || `rule ${rName} failed`, rule: rName };
          if (rule.severity === 'error') {
            result.errors.push(entry);
            result.allowed = false;
          } else if (rule.severity === 'warning') {
            result.warnings.push(entry);
          } else {
            result.info.push(entry);
          }
        }
      } catch (err) {
        result.errors.push({ path: '$', error: `rule ${rName} threw: ${err.message}` });
        result.allowed = false;
      }
    }

    // Content guardrails
    const cg = profile?.contentGuard || options.contentGuard || {};
    if (typeof data === 'string') {
      if (cg.maxBytes && Buffer.byteLength(data, 'utf-8') > cg.maxBytes) {
        result.errors.push({ path: '$', error: `maxBytes ${cg.maxBytes}, got ${Buffer.byteLength(data, 'utf-8')}` });
        result.allowed = false;
      }
      if (cg.blockPII) {
        const pii = detectPII(data);
        if (pii.length) {
          if (this.strictMode) {
            result.errors.push({ path: '$', error: `PII detected: ${pii.map((p) => p.type).join(', ')}` });
            result.allowed = false;
          } else {
            result.warnings.push({ path: '$', error: `PII detected: ${pii.map((p) => p.type).join(', ')}` });
          }
          if (this.autoRedact || cg.redact) {
            result.sanitized = redactPII(data);
          }
        }
      }
      if (cg.blockProfanity) {
        const profane = detectProfanity(data);
        if (profane.length) {
          result.warnings.push({ path: '$', error: `profanity detected: ${profane.join(', ')}` });
        }
      }
      if (cg.sanitize) {
        result.sanitized = sanitizeText(result.sanitized, cg.sanitize);
      }
    }

    // Nested content check on objects
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const textFields = cg.textFields || [];
      for (const field of textFields) {
        if (typeof data[field] === 'string') {
          if (cg.blockPII) {
            const pii = detectPII(data[field]);
            if (pii.length) {
              if (this.strictMode) {
                result.errors.push({ path: `$.${field}`, error: `PII detected in ${field}: ${pii.map((p) => p.type).join(', ')}` });
                result.allowed = false;
              } else {
                result.warnings.push({ path: `$.${field}`, error: `PII detected in ${field}` });
              }
              if (this.autoRedact || cg.redact) {
                result.sanitized = { ...result.sanitized, [field]: redactPII(data[field]) };
              }
            }
          }
        }
      }
    }

    // Audit log
    const action = result.allowed ? (result.warnings.length ? 'warn' : 'pass') : 'block';
    if (action === 'block') this.stats.blocked++;
    else if (action === 'warn') this.stats.warned++;
    else this.stats.passed++;

    result.auditId = this.audit.log({
      operation, action, direction,
      errors: result.errors.length,
      warnings: result.warnings.length,
      schemaUsed: typeof (profile?.schema || options.schema) === 'string' ? (profile?.schema || options.schema) : null,
      profileUsed: options.profile || null,
      rulesApplied: ruleNames,
    }).timestamp;

    if (!result.allowed) {
      this.emit('block', { operation, errors: result.errors, data });
    } else if (result.warnings.length) {
      this.emit('warn', { operation, warnings: result.warnings, data });
    } else {
      this.emit('pass', { operation, data });
    }

    return result;
  }

  // Convenience: guard input
  guardInput(data, options = {}) {
    return this.guard(data, { ...options, direction: 'input' });
  }

  // Convenience: guard output
  guardOutput(data, options = {}) {
    return this.guard(data, { ...options, direction: 'output' });
  }

  // ── Content Detection Utilities ──

  detectPII(text) { return detectPII(text); }
  redactPII(text, repl) { return redactPII(text, repl); }
  detectProfanity(text) { return detectProfanity(text); }
  sanitizeText(text, rules) { return sanitizeText(text, rules); }

  // ── Stats ──

  getStats() {
    return {
      ...this.stats,
      schemas: this.schemas.size,
      rules: this.rules.size,
      profiles: this.profiles.size,
      rateLimits: this.rateLimiter.stats(),
      audit: this.audit.stats(),
    };
  }

  // ── Preset Rules ──

  static presets = {
    noEmptyStrings: {
      name: 'no-empty-strings',
      description: 'Reject empty string values',
      check: (data) => {
        if (typeof data === 'string' && data.trim() === '') return { pass: false, message: 'empty string not allowed' };
        return { pass: true };
      },
      severity: 'error',
    },
    noPII: {
      name: 'no-pii',
      description: 'Block PII in string data',
      check: (data) => {
        if (typeof data === 'string' && detectPII(data).length) return { pass: false, message: 'PII detected' };
        return { pass: true };
      },
      severity: 'error',
    },
    reasonableLength: {
      name: 'reasonable-length',
      description: 'Strings under 10KB',
      check: (data) => {
        if (typeof data === 'string' && Buffer.byteLength(data) > 10240) return { pass: false, message: 'string exceeds 10KB' };
        return { pass: true };
      },
      severity: 'warning',
    },
    noSQLInjection: {
      name: 'no-sql-injection',
      description: 'Basic SQL injection pattern detection',
      check: (data) => {
        if (typeof data === 'string') {
          const sqlPatterns = /(\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b.*\b(TABLE|FROM|INTO)\b)|(--\s)|(;\s*(DROP|DELETE))/i;
          if (sqlPatterns.test(data)) return { pass: false, message: 'possible SQL injection detected' };
        }
        return { pass: true };
      },
      severity: 'error',
    },
    noShellInjection: {
      name: 'no-shell-injection',
      description: 'Basic shell injection pattern detection',
      check: (data) => {
        if (typeof data === 'string') {
          const shellPatterns = /[;&|`$(){}]/;
          if (shellPatterns.test(data)) return { pass: false, message: 'possible shell injection characters detected' };
        }
        return { pass: true };
      },
      severity: 'warning',
    },
    validJSON: {
      name: 'valid-json',
      description: 'Ensure string is valid JSON',
      check: (data) => {
        if (typeof data === 'string') {
          try { JSON.parse(data); return { pass: true }; }
          catch { return { pass: false, message: 'invalid JSON' }; }
        }
        return { pass: true };
      },
      severity: 'error',
    },
  };

  loadPreset(name) {
    const preset = AgentGuard.presets[name];
    if (preset) this.rules.set(preset.name, { ...preset, apply: 'both' });
    return this;
  }

  loadAllPresets() {
    for (const name of Object.keys(AgentGuard.presets)) this.loadPreset(name);
    return this;
  }
}

export {
  AgentGuard,
  validateSchema,
  validateField,
  detectPII,
  redactPII,
  detectProfanity,
  sanitizeText,
  RateLimiter,
  AuditLogger,
  PII_PATTERNS,
  VALIDATORS,
};
export default AgentGuard;
