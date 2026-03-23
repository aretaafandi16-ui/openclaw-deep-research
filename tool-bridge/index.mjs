/**
 * tool-bridge — Universal bridge: REST APIs + CLI → MCP tools via YAML config
 * Zero dependencies. Node 18+.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync, exec as execCb } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

// ─── YAML Parser (subset, zero deps) ────────────────────────────────────────
function parseYAML(text) {
  const lines = text.split('\n');
  const result = {};
  const stack = [{ obj: result, indent: -1 }];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    
    const indent = line.search(/\S/);
    const content = line.trim();
    
    // Pop stack to correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    
    const parent = stack[stack.length - 1].obj;
    
    // Key: value
    const kvMatch = content.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val = kvMatch[2].trim();
      
      if (val === '' || val === '|' || val === '>') {
        // Sub-object or multiline
        const child = {};
        if (Array.isArray(parent)) {
          parent.push(child);
        } else {
          parent[key] = child;
        }
        stack.push({ obj: child, indent });
      } else {
        // Parse value
        if (Array.isArray(parent)) {
          parent.push(parseYAMLValue(val));
        } else {
          parent[key] = parseYAMLValue(val);
        }
      }
    }
    // Array item
    else if (content.startsWith('- ')) {
      const val = content.substring(2).trim();
      if (!Array.isArray(parent)) {
        // Convert parent to array context
        const lastKey = Object.keys(parent).pop();
        if (lastKey && typeof parent[lastKey] === 'object' && parent[lastKey] !== null) {
          // Already an object, skip
        }
      }
    }
  }
  
  return result;
}

function parseYAMLValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // Strip quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  // Inline object {key: val}
  if (val.startsWith('{') && val.endsWith('}')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

// Better YAML parser using recursive descent
function parseYAMLFull(text) {
  const lines = text.split('\n');
  let pos = 0;
  
  function peek() {
    while (pos < lines.length && (lines[pos].trim() === '' || lines[pos].trim().startsWith('#'))) {
      pos++;
    }
    if (pos >= lines.length) return null;
    return lines[pos];
  }
  
  function getIndent(line) {
    return line ? line.search(/\S/) : -1;
  }
  
  function parseBlock(minIndent) {
    const line = peek();
    if (!line) return null;
    const indent = getIndent(line);
    if (indent < minIndent) return null;
    
    const content = line.trim();
    
    // Check if it's an array
    if (content.startsWith('- ')) {
      return parseArray(indent);
    }
    
    // It's a mapping
    return parseMapping(indent);
  }
  
  function parseMapping(baseIndent) {
    const obj = {};
    while (pos < lines.length) {
      const line = peek();
      if (!line) break;
      const indent = getIndent(line);
      if (indent < baseIndent) break;
      if (indent > baseIndent) break;
      
      const content = line.trim();
      if (content.startsWith('- ')) break;
      
      const kvMatch = content.match(/^([^:]+):\s*(.*)$/);
      if (!kvMatch) { pos++; continue; }
      
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      pos++;
      
      if (val === '' || val === '|' || val === '>') {
        // Child block
        const child = peek();
        if (child && getIndent(child) > baseIndent) {
          obj[key] = parseBlock(getIndent(child));
        } else {
          obj[key] = {};
        }
      } else {
        obj[key] = parseYAMLValue(val);
      }
    }
    return obj;
  }
  
  function parseArray(baseIndent) {
    const arr = [];
    while (pos < lines.length) {
      const line = peek();
      if (!line) break;
      const indent = getIndent(line);
      if (indent < baseIndent) break;
      if (indent > baseIndent) { pos++; continue; }
      
      const content = line.trim();
      if (!content.startsWith('- ')) break;
      
      pos++;
      const val = content.substring(2).trim();
      
      if (val.includes(':')) {
        // Inline object in array
        const obj = {};
        const kvMatch = val.match(/^([^:]+):\s*(.*)$/);
        if (kvMatch) {
          const k = kvMatch[1].trim();
          const v = kvMatch[2].trim();
          if (v === '') {
            const child = peek();
            if (child && getIndent(child) > baseIndent) {
              obj[k] = parseBlock(getIndent(child));
            }
          } else {
            obj[k] = parseYAMLValue(v);
          }
        }
        arr.push(obj);
      } else {
        arr.push(parseYAMLValue(val));
      }
    }
    return arr;
  }
  
  return parseBlock(0) || {};
}

// ─── Template Engine ─────────────────────────────────────────────────────────
function resolveTemplate(template, context) {
  if (typeof template !== 'string') return template;
  
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const trimmed = expr.trim();
    
    // env.VAR
    if (trimmed.startsWith('env.')) {
      return process.env[trimmed.slice(4)] || '';
    }
    // args.key
    if (trimmed.startsWith('args.')) {
      const path = trimmed.slice(5).split('.');
      let val = context.args;
      for (const p of path) {
        if (val == null) return '';
        val = val[p];
      }
      return val != null ? String(val) : '';
    }
    // args (direct)
    if (trimmed === 'args') {
      return JSON.stringify(context.args || {});
    }
    // date.now
    if (trimmed === 'date.now') return new Date().toISOString();
    if (trimmed === 'date.unix') return String(Math.floor(Date.now() / 1000));
    // uuid
    if (trimmed === 'uuid') return randomUUID();
    // response.field (for batch)
    if (trimmed.startsWith('response.') && context.response) {
      const path = trimmed.slice(9).split('.');
      let val = context.response;
      for (const p of path) {
        if (val == null) return '';
        val = val[p];
      }
      return val != null ? String(val) : '';
    }
    
    return '';
  });
}

function resolveObject(obj, context) {
  if (typeof obj === 'string') return resolveTemplate(obj, context);
  if (Array.isArray(obj)) return obj.map(v => resolveObject(v, context));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[resolveTemplate(k, context)] = resolveObject(v, context);
    }
    return result;
  }
  return obj;
}

// ─── JSONPath Extractor (simple) ─────────────────────────────────────────────
function jsonPath(obj, path) {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function applyTransform(data, transform) {
  if (!transform) return data;
  if (typeof transform === 'string') return jsonPath(data, transform);
  
  const result = {};
  for (const [key, path] of Object.entries(transform)) {
    if (typeof path === 'string') {
      result[key] = jsonPath(data, path);
    } else {
      result[key] = path; // literal value
    }
  }
  return result;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────
class RateLimiter {
  constructor(limit = 60) {
    this.limit = limit; // per minute
    this.windows = new Map(); // tool → [timestamps]
  }
  
  check(tool) {
    const now = Date.now();
    const window = this.windows.get(tool) || [];
    const cutoff = now - 60000;
    
    // Clean old entries
    const fresh = window.filter(t => t > cutoff);
    this.windows.set(tool, fresh);
    
    if (fresh.length >= this.limit) {
      return { allowed: false, retryAfter: Math.ceil((fresh[0] - cutoff) / 1000) };
    }
    
    fresh.push(now);
    return { allowed: true };
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────────
class ResponseCache {
  constructor() {
    this.store = new Map();
  }
  
  key(tool, args) {
    return createHash('md5').update(`${tool}:${JSON.stringify(args)}`).digest('hex');
  }
  
  get(tool, args, ttl) {
    const k = this.key(tool, args);
    const entry = this.store.get(k);
    if (!entry) return null;
    if (Date.now() - entry.time > ttl * 1000) {
      this.store.delete(k);
      return null;
    }
    return entry.data;
  }
  
  set(tool, args, data) {
    const k = this.key(tool, args);
    this.store.set(k, { data, time: Date.now() });
  }
  
  clear() {
    this.store.clear();
  }
}

// ─── Tool Bridge Core ────────────────────────────────────────────────────────
export class ToolBridge {
  constructor(opts = {}) {
    this.configPath = opts.config || null;
    this.config = { tools: {}, defaults: {} };
    this.limiter = new RateLimiter();
    this.cache = new ResponseCache();
    this.presets = loadPresets();
    this._fetch = opts.fetch || globalThis.fetch?.bind(globalThis);
  }
  
  async load(configPath) {
    const path = configPath || this.configPath;
    if (!path) {
      this.config = { tools: {}, defaults: {} };
      return;
    }
    
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) {
      throw new Error(`Config not found: ${fullPath}`);
    }
    
    const text = readFileSync(fullPath, 'utf-8');
    if (fullPath.endsWith('.json')) {
      this.config = JSON.parse(text);
    } else {
      this.config = parseYAMLFull(text);
    }
    
    // Apply defaults
    if (this.config.defaults?.rateLimit) {
      this.limiter.limit = this.config.defaults.rateLimit;
    }
  }
  
  list() {
    const tools = [];
    for (const [name, def] of Object.entries(this.config.tools || {})) {
      tools.push({
        name,
        description: def.description || '',
        type: def.type || 'rest',
        method: def.method,
        hasAuth: !!(def.headers?.Authorization || def.headers?.authorization),
        hasTransform: !!def.transform,
      });
    }
    return tools;
  }
  
  info(name) {
    const def = this.config.tools?.[name];
    if (!def) throw new Error(`Tool not found: ${name}`);
    return { name, ...def };
  }
  
  async call(name, args = {}, opts = {}) {
    const def = this.config.tools?.[name];
    if (!def) throw new Error(`Tool not found: ${name}`);
    
    const type = def.type || 'rest';
    
    // Rate limit
    const toolLimit = def.rateLimit || this.config.defaults?.rateLimit;
    if (toolLimit) {
      this.limiter.limit = toolLimit;
      const check = this.limiter.check(name);
      if (!check.allowed) {
        return { error: 'rate_limited', retryAfter: check.retryAfter };
      }
    }
    
    // Cache
    const cacheTTL = opts.cache !== false ? (def.cache || this.config.defaults?.cache) : 0;
    if (cacheTTL) {
      const cached = this.cache.get(name, args, cacheTTL);
      if (cached) return { ...cached, _cached: true };
    }
    
    const context = { args, response: opts.previousResponse };
    
    let result;
    if (type === 'rest') {
      result = await this._callREST(def, context);
    } else if (type === 'cli') {
      result = this._callCLI(def, context);
    } else {
      throw new Error(`Unknown tool type: ${type}`);
    }
    
    // Transform
    if (def.transform && result.data) {
      result.data = applyTransform(result.data, def.transform);
    }
    
    // Cache result
    if (cacheTTL && !result.error) {
      this.cache.set(name, args, result);
    }
    
    return result;
  }
  
  async _callREST(def, context) {
    const method = (def.method || 'GET').toUpperCase();
    const url = resolveTemplate(def.url, context);
    
    // Build URL with query params
    const urlObj = new URL(url);
    if (def.params) {
      const params = resolveObject(def.params, context);
      for (const [k, v] of Object.entries(params)) {
        urlObj.searchParams.set(k, String(v));
      }
    }
    
    // Headers
    const headers = {};
    if (def.headers) {
      const resolved = resolveObject(def.headers, context);
      Object.assign(headers, resolved);
    }
    
    // Body
    let body = undefined;
    if (def.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      body = JSON.stringify(resolveObject(def.body, context));
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    
    const timeout = def.timeout || this.config.defaults?.timeout || 10000;
    
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      
      const resp = await this._fetch(urlObj.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      
      clearTimeout(timer);
      
      const contentType = resp.headers.get('content-type') || '';
      let data;
      
      if (contentType.includes('application/json')) {
        data = await resp.json();
      } else {
        data = await resp.text();
      }
      
      return {
        status: resp.status,
        ok: resp.ok,
        data,
        headers: Object.fromEntries(resp.headers.entries()),
      };
    } catch (err) {
      return { error: err.message, status: 0 };
    }
  }
  
  _callCLI(def, context) {
    const command = resolveTemplate(def.command, context);
    const timeout = def.timeout || this.config.defaults?.timeout || 10000;
    const cwd = def.cwd ? resolveTemplate(def.cwd, context) : undefined;
    
    try {
      const output = execSync(command, {
        timeout,
        cwd,
        env: { ...process.env, ...(def.env ? resolveObject(def.env, context) : {}) },
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      
      // Try parse as JSON
      let data;
      try {
        data = JSON.parse(output);
      } catch {
        data = output.trim();
      }
      
      return { ok: true, data, command };
    } catch (err) {
      return {
        error: err.message,
        command,
        stdout: err.stdout?.toString(),
        stderr: err.stderr?.toString(),
        status: err.status || 0,
      };
    }
  }
  
  async batch(calls, opts = {}) {
    const results = [];
    let previousResponse = null;
    
    for (const call of calls) {
      const result = await this.call(call.tool, call.args || {}, {
        ...opts,
        previousResponse,
      });
      results.push({ tool: call.tool, ...result });
      if (opts.chainResponses) {
        previousResponse = result.data;
      }
    }
    
    return results;
  }
  
  toJSON() {
    return {
      tools: this.list(),
      defaults: this.config.defaults || {},
      toolCount: Object.keys(this.config.tools || {}).length,
    };
  }
}

// ─── Presets ─────────────────────────────────────────────────────────────────
function loadPresets() {
  return {
    github: {
      defaults: {
        timeout: 10000,
        rateLimit: 30,
      },
      tools: {
        github_repos: {
          description: 'List user repositories',
          type: 'rest',
          method: 'GET',
          url: 'https://api.github.com/user/repos',
          headers: {
            Authorization: 'Bearer {{env.GITHUB_TOKEN}}',
            Accept: 'application/vnd.github.v3+json',
          },
          params: {
            sort: '{{args.sort || "updated"}}',
            per_page: '{{args.per_page || "10"}}',
          },
          transform: {
            repos: '*.full_name',
          },
        },
        github_repo: {
          description: 'Get repository details',
          type: 'rest',
          method: 'GET',
          url: 'https://api.github.com/repos/{{args.owner}}/{{args.repo}}',
          headers: {
            Authorization: 'Bearer {{env.GITHUB_TOKEN}}',
            Accept: 'application/vnd.github.v3+json',
          },
          transform: {
            name: 'name',
            stars: 'stargazers_count',
            forks: 'forks_count',
            language: 'language',
            description: 'description',
            default_branch: 'default_branch',
          },
        },
        github_issues: {
          description: 'List repository issues',
          type: 'rest',
          method: 'GET',
          url: 'https://api.github.com/repos/{{args.owner}}/{{args.repo}}/issues',
          headers: {
            Authorization: 'Bearer {{env.GITHUB_TOKEN}}',
            Accept: 'application/vnd.github.v3+json',
          },
          params: {
            state: '{{args.state || "open"}}',
            per_page: '{{args.per_page || "10"}}',
          },
        },
        github_create_issue: {
          description: 'Create a new issue',
          type: 'rest',
          method: 'POST',
          url: 'https://api.github.com/repos/{{args.owner}}/{{args.repo}}/issues',
          headers: {
            Authorization: 'Bearer {{env.GITHUB_TOKEN}}',
            Accept: 'application/vnd.github.v3+json',
          },
          body: {
            title: '{{args.title}}',
            body: '{{args.body}}',
            labels: '{{args.labels}}',
          },
        },
        github_pr_files: {
          description: 'List files changed in a PR',
          type: 'rest',
          method: 'GET',
          url: 'https://api.github.com/repos/{{args.owner}}/{{args.repo}}/pulls/{{args.number}}/files',
          headers: {
            Authorization: 'Bearer {{env.GITHUB_TOKEN}}',
            Accept: 'application/vnd.github.v3+json',
          },
        },
      },
    },
    
    weather: {
      tools: {
        weather_current: {
          description: 'Get current weather for a city',
          type: 'rest',
          method: 'GET',
          url: 'https://wttr.in/{{args.city}}',
          params: { format: 'j1' },
          transform: {
            city: 'nearest_area[0].areaName[0].value',
            temp_c: 'current_condition[0].temp_C',
            temp_f: 'current_condition[0].temp_F',
            humidity: 'current_condition[0].humidity',
            desc: 'current_condition[0].weatherDesc[0].value',
            wind_kmph: 'current_condition[0].windspeedKmph',
          },
        },
        weather_forecast: {
          description: 'Get 3-day weather forecast',
          type: 'rest',
          method: 'GET',
          url: 'https://wttr.in/{{args.city}}',
          params: { format: 'j1' },
          transform: {
            forecast: 'weather',
          },
        },
      },
    },
    
    httpbin: {
      tools: {
        httpbin_get: {
          description: 'Test GET request (httpbin)',
          type: 'rest',
          method: 'GET',
          url: 'https://httpbin.org/get',
        },
        httpbin_post: {
          description: 'Test POST request (httpbin)',
          type: 'rest',
          method: 'POST',
          url: 'https://httpbin.org/post',
          body: '{{args}}',
        },
        httpbin_headers: {
          description: 'Echo request headers',
          type: 'rest',
          method: 'GET',
          url: 'https://httpbin.org/headers',
          headers: {
            'X-Custom-Header': '{{args.header_value || "test"}}',
          },
        },
      },
    },
    
    system: {
      tools: {
        system_disk: {
          description: 'Check disk usage',
          type: 'cli',
          command: 'df -h {{args.partition || "/"}}',
        },
        system_memory: {
          description: 'Check memory usage',
          type: 'cli',
          command: 'free -h',
        },
        system_uptime: {
          description: 'System uptime',
          type: 'cli',
          command: 'uptime',
        },
        system_processes: {
          description: 'List top processes',
          type: 'cli',
          command: 'ps aux --sort=-%mem | head -{{args.count || "10"}}',
        },
      },
    },
  };
}

export { parseYAMLFull as parseYAML, resolveTemplate, applyTransform, jsonPath };
export default ToolBridge;
