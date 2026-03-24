/**
 * agent-transform — Zero-dependency data transformation engine for AI agents
 *
 * Features:
 * - JSON schema mapping (flattening, nesting, renaming, filtering)
 * - CSV/TSV ↔ JSON conversion
 * - Template-based value transforms with {{field}} interpolation
 * - Composable pipeline with step chaining
 * - Conditional transforms (apply only when predicate matches)
 * - Type coercion (string, number, boolean, date, array, object)
 * - Data validation with schema rules
 * - Batch processing with concurrency control
 * - Stats tracking and error collection
 * - EventEmitter for progress/events
 * - JSONL persistence for transform logs
 */

import { EventEmitter } from 'events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── Utility helpers ───────────────────────────────────────────────────────

function deepGet(obj, path) {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function deepSet(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null) cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function deepDelete(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null) return;
    cur = cur[parts[i]];
  }
  if (cur != null) delete cur[parts[parts.length - 1]];
}

function interpolate(template, data) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const val = deepGet(data, expr.trim());
    return val === undefined ? '' : String(val);
  });
}

function coerce(value, type) {
  switch (type) {
    case 'string': return value == null ? '' : String(value);
    case 'number': {
      const n = Number(value);
      return isNaN(n) ? 0 : n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const l = value.toLowerCase();
        return l === 'true' || l === '1' || l === 'yes';
      }
      return Boolean(value);
    }
    case 'date': {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    case 'array':
      return Array.isArray(value) ? value : [value];
    case 'object':
      return typeof value === 'object' && value !== null ? value : { value };
    case 'null':
      return null;
    default:
      return value;
  }
}

function flattenObject(obj, prefix = '', result = {}) {
  for (const [key, val] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      flattenObject(val, path, result);
    } else {
      result[path] = val;
    }
  }
  return result;
}

function unflattenObject(obj) {
  const result = {};
  for (const [path, val] of Object.entries(obj)) {
    deepSet(result, path, val);
  }
  return result;
}

function flattenArrays(obj, prefix = '', result = {}) {
  for (const [key, val] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(val)) {
      val.forEach((v, i) => {
        if (v && typeof v === 'object') {
          flattenArrays(v, `${path}[${i}]`, result);
        } else {
          result[`${path}[${i}]`] = v;
        }
      });
    } else if (val && typeof val === 'object') {
      flattenArrays(val, path, result);
    } else {
      result[path] = val;
    }
  }
  return result;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Built-in transform functions ──────────────────────────────────────────

const builtinTransforms = {
  // String transforms
  uppercase: v => typeof v === 'string' ? v.toUpperCase() : v,
  lowercase: v => typeof v === 'string' ? v.toLowerCase() : v,
  trim: v => typeof v === 'string' ? v.trim() : v,
  slug: v => typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : v,
  capitalize: v => typeof v === 'string' ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v,
  titleCase: v => typeof v === 'string' ? v.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase()) : v,
  camelCase: v => typeof v === 'string' ? v.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '') : v,
  snakeCase: v => typeof v === 'string' ? v.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase() : v,
  kebabCase: v => typeof v === 'string' ? v.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase() : v,
  truncate: (v, opts) => typeof v === 'string' ? v.slice(0, opts?.length || 100) + (v.length > (opts?.length || 100) ? (opts?.suffix || '...') : '') : v,
  replace: (v, opts) => typeof v === 'string' ? v.replaceAll(opts?.pattern || '', opts?.replacement || '') : v,
  stripHtml: v => typeof v === 'string' ? v.replace(/<[^>]*>/g, '') : v,
  extract: (v, opts) => typeof v === 'string' ? (v.match(new RegExp(opts?.pattern || '.*'))?.[0] || '') : v,
  padStart: (v, opts) => typeof v === 'string' ? v.padStart(opts?.length || 2, opts?.char || ' ') : v,
  padEnd: (v, opts) => typeof v === 'string' ? v.padEnd(opts?.length || 2, opts?.char || ' ') : v,
  split: (v, opts) => typeof v === 'string' ? v.split(opts?.separator || ',').map(s => opts?.trim ? s.trim() : s) : v,
  join: (v, opts) => Array.isArray(v) ? v.join(opts?.separator || ', ') : v,

  // Number transforms
  round: v => Math.round(Number(v) * 10 ** 2) / 10 ** 2,
  floor: v => Math.floor(Number(v)),
  ceil: v => Math.ceil(Number(v)),
  abs: v => Math.abs(Number(v)),
  clamp: (v, opts) => Math.min(Math.max(Number(v), opts?.min ?? -Infinity), opts?.max ?? Infinity),
  percent: v => `${(Number(v) * 100).toFixed(opts?.decimals || 1)}%`,
  fixed: (v, opts) => Number(v).toFixed(opts?.decimals || 2),
  toLocaleString: v => Number(v).toLocaleString(),

  // Array transforms
  first: v => Array.isArray(v) ? v[0] : v,
  last: v => Array.isArray(v) ? v[v.length - 1] : v,
  unique: v => Array.isArray(v) ? [...new Set(v)] : v,
  sort: (v, opts) => Array.isArray(v) ? [...v].sort(opts?.desc ? (a, b) => b > a ? 1 : -1 : undefined) : v,
  reverse: v => Array.isArray(v) ? [...v].reverse() : v,
  flatten: v => Array.isArray(v) ? v.flat(opts?.depth || Infinity) : v,
  compact: v => Array.isArray(v) ? v.filter(Boolean) : v,
  take: (v, opts) => Array.isArray(v) ? v.slice(0, opts?.count || 10) : v,
  skip: (v, opts) => Array.isArray(v) ? v.slice(opts?.count || 1) : v,

  // Date transforms
  dateISO: v => { const d = new Date(v); return isNaN(d.getTime()) ? v : d.toISOString(); },
  dateOnly: v => { const d = new Date(v); return isNaN(d.getTime()) ? v : d.toISOString().split('T')[0]; },
  timeOnly: v => { const d = new Date(v); return isNaN(d.getTime()) ? v : d.toISOString().split('T')[1]?.split('.')[0]; },
  unixTimestamp: v => { const d = new Date(v); return isNaN(d.getTime()) ? v : Math.floor(d.getTime() / 1000); },

  // Object transforms
  keys: v => v && typeof v === 'object' ? Object.keys(v) : v,
  values: v => v && typeof v === 'object' ? Object.values(v) : v,
  entries: v => v && typeof v === 'object' ? Object.entries(v) : v,
  pick: (v, opts) => {
    if (!v || typeof v !== 'object') return v;
    const fields = opts?.fields || [];
    return Object.fromEntries(fields.filter(f => f in v).map(f => [f, v[f]]));
  },
  omit: (v, opts) => {
    if (!v || typeof v !== 'object') return v;
    const fields = new Set(opts?.fields || []);
    return Object.fromEntries(Object.entries(v).filter(([k]) => !fields.has(k)));
  },

  // Misc
  default: (v, opts) => v == null || v === '' ? (opts?.value ?? '') : v,
  type: v => typeof v,
  stringify: v => JSON.stringify(v),
  parse: v => { try { return JSON.parse(v); } catch { return v; } },
  length: v => v?.length ?? 0,
  isEmpty: v => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && Object.keys(v).length === 0),
  isNull: v => v == null,
  not: v => !v,
  identity: v => v,
};

// ─── TransformEngine ───────────────────────────────────────────────────────

export class TransformEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.transforms = { ...builtinTransforms };
    this.schemas = {};
    this.pipelines = {};
    this.stats = { totalRuns: 0, totalItems: 0, totalErrors: 0, totalMs: 0 };
    this.logFile = opts.logFile || null;
    if (this.logFile) {
      const dir = dirname(this.logFile);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  // ── Custom transforms ─────────────────────────────────────────────────

  registerTransform(name, fn) {
    this.transforms[name] = fn;
    this.emit('transform:registered', name);
    return this;
  }

  // ── Single-field transform ────────────────────────────────────────────

  transformField(value, steps) {
    let result = value;
    for (const step of Array.isArray(steps) ? steps : [steps]) {
      if (typeof step === 'string') {
        const fn = this.transforms[step];
        if (fn) result = fn(result);
      } else if (typeof step === 'object' && step.fn) {
        const fn = this.transforms[step.fn];
        if (fn) result = fn(result, step.opts);
      }
    }
    return result;
  }

  // ── Record transform via mapping ──────────────────────────────────────

  transformRecord(record, mapping) {
    const result = {};
    for (const [target, rule] of Object.entries(mapping)) {
      try {
        if (typeof rule === 'string') {
          // Simple field rename: "source.path"
          const val = deepGet(record, rule);
          if (val !== undefined) deepSet(result, target, val);
        } else if (typeof rule === 'object' && rule !== null) {
          if (rule.$const !== undefined) {
            deepSet(result, target, rule.$const);
          } else if (rule.$expr) {
            // Template expression
            const val = interpolate(rule.$expr, record);
            deepSet(result, target, rule.$transform ? this.transformField(val, rule.$transform) : val);
          } else if (rule.$source) {
            const val = deepGet(record, rule.$source);
            if (rule.$default !== undefined && (val === undefined || val === null)) {
              deepSet(result, target, rule.$default);
            } else if (val !== undefined) {
              deepSet(result, target, rule.$transform ? this.transformField(val, rule.$transform) : val);
            }
          } else if (rule.$transform) {
            // Transform existing field
            const val = deepGet(record, target);
            if (val !== undefined) deepSet(result, target, this.transformField(val, rule.$transform));
          }
        }
      } catch (err) {
        this.emit('field:error', { target, error: err.message, record });
      }
    }
    return result;
  }

  // ── Pipeline composition ──────────────────────────────────────────────

  definePipeline(name, steps) {
    this.pipelines[name] = steps;
    this.emit('pipeline:defined', name);
    return this;
  }

  runPipeline(name, data) {
    const steps = this.pipelines[name];
    if (!steps) throw new Error(`Pipeline '${name}' not found`);
    return this.execute(steps, data);
  }

  // ── Execute transform steps ───────────────────────────────────────────

  execute(steps, data) {
    const startTime = Date.now();
    let result = deepClone(data);
    const errors = [];

    for (const step of Array.isArray(steps) ? steps : [steps]) {
      try {
        result = this._executeStep(step, result);
      } catch (err) {
        errors.push({ step: step.type || 'unknown', error: err.message });
        if (step.onError === 'abort') throw err;
        if (step.onError === 'default' && step.default !== undefined) result = step.default;
        // 'skip' or default: continue
      }
    }

    const elapsed = Date.now() - startTime;
    this.stats.totalRuns++;
    this.stats.totalMs += elapsed;
    if (errors.length) this.stats.totalErrors += errors.length;

    if (this.logFile) {
      this._log({ type: 'pipeline', elapsed, errors: errors.length, ts: new Date().toISOString() });
    }

    this.emit('execute:done', { elapsed, errors, result });
    return { result, errors, elapsed };
  }

  _executeStep(step, data) {
    const type = step.type || (typeof step === 'string' ? step : null);

    switch (type) {
      case 'map': {
        if (Array.isArray(data)) {
          return data.map((item, i) => {
            this.stats.totalItems++;
            if (step.when && !this._evaluateCondition(step.when, item, i)) return item;
            return step.mapping ? this.transformRecord(item, step.mapping) : item;
          });
        }
        this.stats.totalItems++;
        if (step.when && !this._evaluateCondition(step.when, data, 0)) return data;
        return step.mapping ? this.transformRecord(data, step.mapping) : data;
      }

      case 'filter': {
        if (!Array.isArray(data)) return data;
        return data.filter((item, i) => this._evaluateCondition(step.condition || step.when, item, i));
      }

      case 'reduce': {
        if (!Array.isArray(data)) return data;
        const acc = step.initial !== undefined ? deepClone(step.initial) : {};
        return data.reduce((result, item, i) => {
          if (step.accumulator) {
            return this.transformRecord({ $acc: result, $item: item, $index: i }, { $acc: step.accumulator });
          }
          return result;
        }, acc);
      }

      case 'flatten': {
        const flat = flattenObject(data, step.prefix || '');
        return step.unflatten ? unflattenObject(flat) : flat;
      }

      case 'unflatten':
        return unflattenObject(data);

      case 'flattenArrays':
        return flattenArrays(data);

      case 'pick': {
        const fields = step.fields || [];
        if (Array.isArray(data)) return data.map(r => Object.fromEntries(fields.filter(f => f in r).map(f => [f, r[f]])));
        return Object.fromEntries(fields.filter(f => f in data).map(f => [f, data[f]]));
      }

      case 'omit': {
        const fields = new Set(step.fields || []);
        if (Array.isArray(data)) return data.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !fields.has(k))));
        return Object.fromEntries(Object.entries(data).filter(([k]) => !fields.has(k)));
      }

      case 'rename': {
        const renames = step.fields || {};
        const doRename = obj => {
          const r = { ...obj };
          for (const [from, to] of Object.entries(renames)) {
            if (from in r) { r[to] = r[from]; delete r[from]; }
          }
          return r;
        };
        return Array.isArray(data) ? data.map(doRename) : doRename(data);
      }

      case 'coerce': {
        const types = step.fields || {};
        const doCoerce = obj => {
          const r = { ...obj };
          for (const [field, type] of Object.entries(types)) {
            if (field in r) r[field] = coerce(r[field], type);
          }
          return r;
        };
        return Array.isArray(data) ? data.map(doCoerce) : doCoerce(data);
      }

      case 'add': {
        const fields = step.fields || {};
        const doAdd = obj => {
          const r = { ...obj };
          for (const [key, rule] of Object.entries(fields)) {
            if (rule.$const !== undefined) r[key] = rule.$const;
            else if (rule.$expr) r[key] = interpolate(rule.$expr, r);
            else if (rule.$transform) r[key] = this.transformField(r[key] ?? null, rule.$transform);
          }
          return r;
        };
        return Array.isArray(data) ? data.map(doAdd) : doAdd(data);
      }

      case 'delete': {
        const fields = step.fields || [];
        const doDelete = obj => {
          const r = { ...obj };
          for (const f of fields) delete r[f];
          return r;
        };
        return Array.isArray(data) ? data.map(doDelete) : doDelete(data);
      }

      case 'transform': {
        const doTransform = obj => {
          const r = { ...obj };
          for (const [field, steps] of Object.entries(step.fields || {})) {
            if (field in r) r[field] = this.transformField(r[field], steps);
          }
          return r;
        };
        return Array.isArray(data) ? data.map(doTransform) : doTransform(data);
      }

      case 'sort': {
        if (!Array.isArray(data)) return data;
        const by = step.by || [];
        return [...data].sort((a, b) => {
          for (const { field, desc } of by.map(f => typeof f === 'string' ? { field: f } : f)) {
            const va = deepGet(a, field), vb = deepGet(b, field);
            if (va < vb) return desc ? 1 : -1;
            if (va > vb) return desc ? -1 : 1;
          }
          return 0;
        });
      }

      case 'unique': {
        if (!Array.isArray(data)) return data;
        const seen = new Set();
        const key = step.by;
        return data.filter(item => {
          const k = key ? JSON.stringify(deepGet(item, key)) : JSON.stringify(item);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }

      case 'group': {
        if (!Array.isArray(data)) return data;
        const by = step.by;
        const groups = {};
        for (const item of data) {
          const key = String(deepGet(item, by) ?? 'null');
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        }
        return step.asArray ? Object.entries(groups).map(([key, items]) => ({ key, items })) : groups;
      }

      case 'merge': {
        if (Array.isArray(data)) return Object.assign({}, ...data);
        return data;
      }

      case 'template': {
        const tmpl = step.template;
        if (Array.isArray(data)) return data.map(item => interpolate(tmpl, item));
        return interpolate(tmpl, data);
      }

      case 'validate': {
        const rules = step.rules || {};
        const errors = [];
        const check = (obj, i = 0) => {
          for (const [field, rule] of Object.entries(rules)) {
            const val = deepGet(obj, field);
            if (rule.required && (val === undefined || val === null)) {
              errors.push({ index: i, field, error: 'required' });
            }
            if (val !== undefined && val !== null) {
              if (rule.type && typeof val !== rule.type) {
                errors.push({ index: i, field, error: `expected ${rule.type}, got ${typeof val}` });
              }
              if (rule.min !== undefined && Number(val) < rule.min) {
                errors.push({ index: i, field, error: `below minimum ${rule.min}` });
              }
              if (rule.max !== undefined && Number(val) > rule.max) {
                errors.push({ index: i, field, error: `above maximum ${rule.max}` });
              }
              if (rule.pattern && !new RegExp(rule.pattern).test(String(val))) {
                errors.push({ index: i, field, error: `does not match pattern ${rule.pattern}` });
              }
              if (rule.enum && !rule.enum.includes(val)) {
                errors.push({ index: i, field, error: `not in enum: ${rule.enum.join(', ')}` });
              }
              if (rule.minLength && String(val).length < rule.minLength) {
                errors.push({ index: i, field, error: `length < ${rule.minLength}` });
              }
              if (rule.maxLength && String(val).length > rule.maxLength) {
                errors.push({ index: i, field, error: `length > ${rule.maxLength}` });
              }
            }
          }
        };
        if (Array.isArray(data)) data.forEach((item, i) => check(item, i));
        else check(data);
        if (errors.length && step.strict) throw new Error(`Validation failed: ${errors.length} errors`);
        return { data, valid: errors.length === 0, errors };
      }

      case 'csv_parse': {
        const sep = step.separator || ',';
        const lines = (typeof data === 'string' ? data : String(data)).split('\n').filter(l => l.trim());
        if (lines.length === 0) return [];
        const headers = this._parseCSVLine(lines[0], sep);
        return lines.slice(1).map(line => {
          const values = this._parseCSVLine(line, sep);
          const obj = {};
          headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
          return obj;
        });
      }

      case 'csv_stringify': {
        const items = Array.isArray(data) ? data : [data];
        if (items.length === 0) return '';
        const headers = step.fields || [...new Set(items.flatMap(Object.keys))];
        const lines = [headers.join(step.separator || ',')];
        for (const item of items) {
          lines.push(headers.map(h => {
            const v = item[h] ?? '';
            const s = String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replaceAll('"', '""')}"` : s;
          }).join(step.separator || ','));
        }
        return lines.join('\n');
      }

      case 'jsonl_parse': {
        const lines = (typeof data === 'string' ? data : String(data)).split('\n').filter(l => l.trim());
        return lines.map(l => { try { return JSON.parse(l); } catch { return l; } });
      }

      case 'jsonl_stringify': {
        return (Array.isArray(data) ? data : [data]).map(l => JSON.stringify(l)).join('\n');
      }

      case 'chunk': {
        if (!Array.isArray(data)) return [data];
        const size = step.size || 100;
        const chunks = [];
        for (let i = 0; i < data.length; i += size) chunks.push(data.slice(i, i + size));
        return chunks;
      }

      case 'sample': {
        if (!Array.isArray(data)) return data;
        const n = Math.min(step.count || 10, data.length);
        if (step.random) {
          const shuffled = [...data].sort(() => Math.random() - 0.5);
          return shuffled.slice(0, n);
        }
        return data.slice(0, n);
      }

      case 'deduplicate': {
        if (!Array.isArray(data)) return data;
        const seen = new Set();
        return data.filter(item => {
          const key = step.by ? String(deepGet(item, step.by)) : JSON.stringify(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      case 'spread': {
        if (!Array.isArray(data)) return data;
        return data.flatMap(item => {
          const spreadField = step.field || 'items';
          const arr = deepGet(item, spreadField);
          if (!Array.isArray(arr)) return [item];
          const { [spreadField]: _, ...rest } = item;
          return arr.map(v => ({ ...rest, [step.as || spreadField]: v }));
        });
      }

      case 'pivot': {
        if (!Array.isArray(data)) return data;
        const keyField = step.key || 'key';
        const valField = step.value || 'value';
        const groupField = step.group;
        if (groupField) {
          const groups = {};
          for (const item of data) {
            const gk = String(deepGet(item, groupField) ?? 'null');
            if (!groups[gk]) groups[gk] = {};
            groups[gk][String(deepGet(item, keyField))] = deepGet(item, valField);
          }
          return Object.entries(groups).map(([k, v]) => ({ [groupField]: k, ...v }));
        }
        const result = {};
        for (const item of data) {
          result[String(deepGet(item, keyField))] = deepGet(item, valField);
        }
        return result;
      }

      case 'unpivot': {
        if (typeof data !== 'object' || Array.isArray(data)) return data;
        const exclude = new Set(step.exclude || []);
        const keyName = step.key || 'key';
        const valName = step.value || 'value';
        return Object.entries(data)
          .filter(([k]) => !exclude.has(k))
          .map(([k, v]) => ({ [keyName]: k, [valName]: v }));
      }

      case 'aggregate': {
        if (!Array.isArray(data)) return data;
        const ops = step.operations || {};
        const result = {};
        for (const [name, op] of Object.entries(ops)) {
          const vals = op.field ? data.map(r => deepGet(r, op.field)).filter(v => v != null) : data;
          switch (op.fn) {
            case 'sum': result[name] = vals.reduce((a, b) => a + Number(b), 0); break;
            case 'avg': result[name] = vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : 0; break;
            case 'min': result[name] = vals.length ? Math.min(...vals.map(Number)) : null; break;
            case 'max': result[name] = vals.length ? Math.max(...vals.map(Number)) : null; break;
            case 'count': result[name] = vals.length; break;
            case 'first': result[name] = vals[0]; break;
            case 'last': result[name] = vals[vals.length - 1]; break;
            case 'distinct': result[name] = [...new Set(vals)].length; break;
            default: result[name] = vals.length;
          }
        }
        return result;
      }

      case 'branch': {
        for (const branch of step.branches || []) {
          if (this._evaluateCondition(branch.when, data, 0)) {
            return this.execute(branch.then, data).result;
          }
        }
        return step.otherwise ? this.execute(step.otherwise, data).result : data;
      }

      case 'pipeline': {
        return this.execute(step.steps || [], data).result;
      }

      default:
        // Inline transform string shorthand
        if (typeof step === 'string' && this.transforms[step]) {
          if (Array.isArray(data)) return data.map(v => this.transforms[step](v));
          return this.transforms[step](data);
        }
        return data;
    }
  }

  _evaluateCondition(condition, item, index) {
    if (!condition) return true;
    if (typeof condition === 'function') return condition(item, index);
    if (typeof condition === 'string') {
      // Simple expression: "field > 5", "field == 'active'"
      const match = condition.match(/^(\S+)\s*(==|!=|>|<|>=|<=|contains|startsWith|endsWith|matches)\s*(.+)$/);
      if (!match) return Boolean(deepGet(item, condition));
      const [, field, op, raw] = match;
      const val = deepGet(item, field);
      const cmp = raw.trim().replace(/^['"]|['"]$/g, '');
      switch (op) {
        case '==': return val == cmp;
        case '!=': return val != cmp;
        case '>': return Number(val) > Number(cmp);
        case '<': return Number(val) < Number(cmp);
        case '>=': return Number(val) >= Number(cmp);
        case '<=': return Number(val) <= Number(cmp);
        case 'contains': return String(val).includes(cmp);
        case 'startsWith': return String(val).startsWith(cmp);
        case 'endsWith': return String(val).endsWith(cmp);
        case 'matches': return new RegExp(cmp).test(String(val));
        default: return true;
      }
    }
    if (typeof condition === 'object') {
      // { field: { op: value } } or { $and: [...] } or { $or: [...] }
      if (condition.$and) return condition.$and.every(c => this._evaluateCondition(c, item, index));
      if (condition.$or) return condition.$or.some(c => this._evaluateCondition(c, item, index));
      if (condition.$not) return !this._evaluateCondition(condition.$not, item, index);
      // Field conditions
      for (const [field, spec] of Object.entries(condition)) {
        const val = deepGet(item, field);
        if (typeof spec === 'object' && spec !== null) {
          if (spec.$eq !== undefined && val != spec.$eq) return false;
          if (spec.$ne !== undefined && val == spec.$ne) return false;
          if (spec.$gt !== undefined && !(Number(val) > Number(spec.$gt))) return false;
          if (spec.$gte !== undefined && !(Number(val) >= Number(spec.$gte))) return false;
          if (spec.$lt !== undefined && !(Number(val) < Number(spec.$lt))) return false;
          if (spec.$lte !== undefined && !(Number(val) <= Number(spec.$lte))) return false;
          if (spec.$in !== undefined && !spec.$in.includes(val)) return false;
          if (spec.$nin !== undefined && spec.$nin.includes(val)) return false;
          if (spec.$exists !== undefined && ((val !== undefined) !== spec.$exists)) return false;
          if (spec.$contains !== undefined && !String(val).includes(spec.$contains)) return false;
          if (spec.$regex !== undefined && !new RegExp(spec.$regex).test(String(val))) return false;
        } else {
          if (val != spec) return false;
        }
      }
      return true;
    }
    return true;
  }

  _parseCSVLine(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else current += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === sep) { result.push(current); current = ''; }
        else current += c;
      }
    }
    result.push(current);
    return result;
  }

  _log(entry) {
    if (this.logFile) {
      try { appendFileSync(this.logFile, JSON.stringify(entry) + '\n'); } catch {}
    }
  }

  getStats() {
    return { ...this.stats, avgMs: this.stats.totalRuns ? Math.round(this.stats.totalMs / this.stats.totalRuns) : 0 };
  }

  resetStats() {
    this.stats = { totalRuns: 0, totalItems: 0, totalErrors: 0, totalMs: 0 };
  }

  listTransforms() {
    return Object.keys(this.transforms).sort();
  }

  listPipelines() {
    return Object.keys(this.pipelines);
  }
}

// ─── CSV Parser standalone ─────────────────────────────────────────────────

export function parseCSV(text, opts = {}) {
  const engine = new TransformEngine();
  return engine.execute([{ type: 'csv_parse', separator: opts.separator }], text).result;
}

export function stringifyCSV(data, opts = {}) {
  const engine = new TransformEngine();
  return engine.execute([{ type: 'csv_stringify', separator: opts.separator, fields: opts.fields }], data).result;
}

// ─── Convenience ───────────────────────────────────────────────────────────

export function transform(data, steps, opts = {}) {
  const engine = new TransformEngine(opts);
  return engine.execute(steps, data);
}

export { builtinTransforms as transforms };

export default TransformEngine;
