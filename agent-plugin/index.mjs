/**
 * agent-plugin — Zero-dep plugin system for AI agents
 * 
 * Dynamic plugin loading, lifecycle management, hook system,
 * dependency resolution, and inter-plugin communication.
 */

import { EventEmitter } from 'events';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── Plugin States ───────────────────────────────────────────────
const PluginState = {
  REGISTERED: 'registered',
  LOADED: 'loaded',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  ERROR: 'error',
  UNINSTALLED: 'uninstalled'
};

// ─── Plugin Class ────────────────────────────────────────────────
class Plugin {
  constructor(manifest, factory) {
    this.name = manifest.name;
    this.version = manifest.version || '1.0.0';
    this.description = manifest.description || '';
    this.author = manifest.author || '';
    this.tags = manifest.tags || [];
    this.dependencies = manifest.dependencies || [];
    this.hooks = manifest.hooks || [];
    this.provides = manifest.provides || [];
    this.consumes = manifest.consumes || [];
    this.config = manifest.config || {};
    this.priority = manifest.priority || 100;
    this.state = PluginState.REGISTERED;
    this.factory = factory; // (context) => plugin API
    this.api = null;
    this.error = null;
    this.loadTime = null;
    this.enableTime = null;
    this.stats = { calls: 0, errors: 0, totalMs: 0 };
  }

  toJSON() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      tags: this.tags,
      dependencies: this.dependencies,
      hooks: this.hooks,
      provides: this.provides,
      consumes: this.consumes,
      state: this.state,
      error: this.error,
      api: this.api ? Object.keys(this.api) : null,
      priority: this.priority,
      loadTime: this.loadTime,
      enableTime: this.enableTime,
      stats: { ...this.stats }
    };
  }
}

// ─── Hook Manager ────────────────────────────────────────────────
class HookManager {
  constructor() {
    this._hooks = new Map(); // hookName -> [{fn, plugin, priority}]
  }

  register(hookName, fn, pluginName, priority = 100) {
    if (!this._hooks.has(hookName)) this._hooks.set(hookName, []);
    const list = this._hooks.get(hookName);
    list.push({ fn, plugin: pluginName, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  unregister(hookName, pluginName) {
    if (!this._hooks.has(hookName)) return;
    const filtered = this._hooks.get(hookName).filter(h => h.plugin !== pluginName);
    if (filtered.length === 0) this._hooks.delete(hookName);
    else this._hooks.set(hookName, filtered);
  }

  unregisterAll(pluginName) {
    for (const [name, hooks] of this._hooks) {
      const filtered = hooks.filter(h => h.plugin !== pluginName);
      if (filtered.length === 0) this._hooks.delete(name);
      else this._hooks.set(name, filtered);
    }
  }

  async call(hookName, data, options = {}) {
    const hooks = this._hooks.get(hookName);
    if (!hooks || hooks.length === 0) return data;

    const { sequential = true, collect = false } = options;
    const results = [];

    if (sequential) {
      let current = data;
      for (const hook of hooks) {
        try {
          current = await hook.fn(current);
          if (collect) results.push({ plugin: hook.plugin, result: current });
        } catch (err) {
          if (collect) results.push({ plugin: hook.plugin, error: err.message });
          // Continue on error unless throwOnFailure
          if (options.throwOnFailure) throw err;
        }
      }
      return collect ? results : current;
    } else {
      const promises = hooks.map(async hook => {
        try {
          return { plugin: hook.plugin, result: await hook.fn(data) };
        } catch (err) {
          return { plugin: hook.plugin, error: err.message };
        }
      });
      return Promise.all(promises);
    }
  }

  list() {
    const result = {};
    for (const [name, hooks] of this._hooks) {
      result[name] = hooks.map(h => ({ plugin: h.plugin, priority: h.priority }));
    }
    return result;
  }
}

// ─── Shared Context (inter-plugin communication) ─────────────────
class SharedContext {
  constructor() {
    this._data = new Map();
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(100);
  }

  set(key, value, pluginName) {
    const prev = this._data.get(key);
    this._data.set(key, { value, setBy: pluginName, setAt: Date.now() });
    this._emitter.emit('change', { key, value, prev: prev?.value, by: pluginName });
    this._emitter.emit(`change:${key}`, { value, prev: prev?.value, by: pluginName });
  }

  get(key) {
    return this._data.get(key)?.value;
  }

  has(key) {
    return this._data.has(key);
  }

  delete(key, pluginName) {
    const existed = this._data.has(key);
    this._data.delete(key);
    if (existed) this._emitter.emit('delete', { key, by: pluginName });
    return existed;
  }

  keys() {
    return [...this._data.keys()];
  }

  entries() {
    const result = {};
    for (const [k, v] of this._data) result[k] = v.value;
    return result;
  }

  onChange(key, fn) {
    if (key) this._emitter.on(`change:${key}`, fn);
    else this._emitter.on('change', fn);
  }

  offChange(key, fn) {
    if (key) this._emitter.off(`change:${key}`, fn);
    else this._emitter.off('change', fn);
  }
}

// ─── Main PluginManager ──────────────────────────────────────────
class PluginManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.setMaxListeners(100);
    this._plugins = new Map();
    this._hooks = new HookManager();
    this._context = new SharedContext();
    this._dataDir = options.dataDir || './data';
    this._autoSave = options.autoSave !== false;
    this._saveTimer = null;
    this._persistFile = join(this._dataDir, 'plugins.jsonl');
  }

  // ── Registration ──────────────────────────────────────────────
  register(manifest, factory) {
    const plugin = new Plugin(manifest, factory);

    if (this._plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Validate dependencies exist
    for (const dep of plugin.dependencies) {
      if (!this._plugins.has(dep)) {
        throw new Error(`Plugin "${plugin.name}" depends on "${dep}" which is not registered`);
      }
    }

    this._plugins.set(plugin.name, plugin);
    this._persist({ type: 'register', plugin: plugin.toJSON(), ts: Date.now() });
    this.emit('registered', plugin.toJSON());
    return plugin;
  }

  // ── Lifecycle: Load → Enable → Disable → Uninstall ────────────
  async load(name) {
    const plugin = this._get(name);
    if (plugin.state !== PluginState.REGISTERED) {
      throw new Error(`Plugin "${name}" is in state "${plugin.state}", expected "registered"`);
    }

    // Load dependencies first
    for (const dep of plugin.dependencies) {
      const depPlugin = this._plugins.get(dep);
      if (depPlugin.state === PluginState.REGISTERED) {
        await this.load(dep);
      }
    }

    try {
      const start = Date.now();
      plugin.api = await plugin.factory(this._createPluginContext(name));
      plugin.loadTime = Date.now() - start;
      plugin.state = PluginState.LOADED;
      this._persist({ type: 'load', plugin: name, loadTime: plugin.loadTime, ts: Date.now() });
      this.emit('loaded', plugin.toJSON());
      return plugin;
    } catch (err) {
      plugin.state = PluginState.ERROR;
      plugin.error = err.message;
      this.emit('error', { plugin: name, error: err.message });
      throw err;
    }
  }

  async enable(name) {
    const plugin = this._get(name);
    if (plugin.state === PluginState.ENABLED) return plugin;

    if (plugin.state === PluginState.REGISTERED) {
      await this.load(name);
    }

    if (plugin.state !== PluginState.LOADED && plugin.state !== PluginState.DISABLED) {
      throw new Error(`Plugin "${name}" is in state "${plugin.state}", cannot enable`);
    }

    // Enable dependencies
    for (const dep of plugin.dependencies) {
      const depPlugin = this._plugins.get(dep);
      if (depPlugin.state !== PluginState.ENABLED) {
        await this.enable(dep);
      }
    }

    // Call plugin's enable hook if it exists
    if (plugin.api?.enable) {
      try {
        await plugin.api.enable();
      } catch (err) {
        plugin.state = PluginState.ERROR;
        plugin.error = `enable() failed: ${err.message}`;
        this.emit('error', { plugin: name, error: plugin.error });
        throw err;
      }
    }

    plugin.enableTime = Date.now();
    plugin.state = PluginState.ENABLED;

    // Register hooks
    for (const hookName of plugin.hooks) {
      if (plugin.api?.[hookName] && typeof plugin.api[hookName] === 'function') {
        this._hooks.register(hookName, plugin.api[hookName].bind(plugin.api), name, plugin.priority);
      }
    }

    this._persist({ type: 'enable', plugin: name, ts: Date.now() });
    this.emit('enabled', plugin.toJSON());
    return plugin;
  }

  async disable(name) {
    const plugin = this._get(name);
    if (plugin.state !== PluginState.ENABLED) {
      throw new Error(`Plugin "${name}" is not enabled`);
    }

    // Call plugin's disable hook
    if (plugin.api?.disable) {
      try {
        await plugin.api.disable();
      } catch (err) {
        // Log but continue disabling
        this.emit('warning', { plugin: name, error: `disable() error: ${err.message}` });
      }
    }

    // Unregister hooks
    this._hooks.unregisterAll(name);
    plugin.state = PluginState.DISABLED;

    this._persist({ type: 'disable', plugin: name, ts: Date.now() });
    this.emit('disabled', plugin.toJSON());
    return plugin;
  }

  async uninstall(name) {
    const plugin = this._get(name);

    if (plugin.state === PluginState.ENABLED) {
      await this.disable(name);
    }

    // Call plugin's uninstall hook
    if (plugin.api?.uninstall) {
      try {
        await plugin.api.uninstall();
      } catch (err) {
        this.emit('warning', { plugin: name, error: `uninstall() error: ${err.message}` });
      }
    }

    this._hooks.unregisterAll(name);
    plugin.state = PluginState.UNINSTALLED;
    plugin.api = null;

    this._persist({ type: 'uninstall', plugin: name, ts: Date.now() });
    this.emit('uninstalled', { name });
    return true;
  }

  // ── Hot reload ────────────────────────────────────────────────
  async reload(name) {
    const plugin = this._get(name);
    const wasEnabled = plugin.state === PluginState.ENABLED;

    if (wasEnabled) await this.disable(name);

    plugin.state = PluginState.REGISTERED;
    plugin.api = null;
    plugin.error = null;

    if (wasEnabled) await this.enable(name);
    else await this.load(name);

    this.emit('reloaded', plugin.toJSON());
    return plugin;
  }

  // ── Hook System ───────────────────────────────────────────────
  async callHook(hookName, data, options) {
    return this._hooks.call(hookName, data, options);
  }

  listHooks() {
    return this._hooks.list();
  }

  // ── Plugin API Calls ──────────────────────────────────────────
  async callPlugin(name, method, ...args) {
    const plugin = this._get(name);
    if (plugin.state !== PluginState.ENABLED) {
      throw new Error(`Plugin "${name}" is not enabled`);
    }
    if (!plugin.api || typeof plugin.api[method] !== 'function') {
      throw new Error(`Plugin "${name}" does not expose method "${method}"`);
    }

    const start = Date.now();
    plugin.stats.calls++;
    try {
      const result = await plugin.api[method](...args);
      plugin.stats.totalMs += Date.now() - start;
      return result;
    } catch (err) {
      plugin.stats.errors++;
      plugin.stats.totalMs += Date.now() - start;
      throw err;
    }
  }

  // ── Shared Context ────────────────────────────────────────────
  getContext() {
    return this._context;
  }

  // ── Queries ───────────────────────────────────────────────────
  get(name) {
    return this._plugins.has(name) ? this._plugins.get(name).toJSON() : null;
  }

  list(filter = {}) {
    let plugins = [...this._plugins.values()].map(p => p.toJSON());

    if (filter.state) plugins = plugins.filter(p => p.state === filter.state);
    if (filter.tag) plugins = plugins.filter(p => p.tags.includes(filter.tag));
    if (filter.provides) plugins = plugins.filter(p => p.provides.includes(filter.provides));

    return plugins.sort((a, b) => a.priority - b.priority);
  }

  enabled() {
    return this.list({ state: PluginState.ENABLED });
  }

  providers(capability) {
    return this.list({ state: PluginState.ENABLED }).filter(p => p.provides.includes(capability));
  }

  // ── Stats ─────────────────────────────────────────────────────
  stats() {
    const plugins = [...this._plugins.values()];
    const byState = {};
    for (const p of plugins) {
      byState[p.state] = (byState[p.state] || 0) + 1;
    }
    return {
      total: plugins.length,
      byState,
      hooks: Object.keys(this._hooks.list()).length,
      totalCalls: plugins.reduce((s, p) => s + p.stats.calls, 0),
      totalErrors: plugins.reduce((s, p) => s + p.stats.errors, 0),
      contextKeys: this._context.keys().length
    };
  }

  // ── Dependency Graph ──────────────────────────────────────────
  depGraph() {
    const graph = {};
    for (const [name, plugin] of this._plugins) {
      graph[name] = {
        dependencies: [...plugin.dependencies],
        dependents: [...this._plugins.values()]
          .filter(p => p.dependencies.includes(name))
          .map(p => p.name)
      };
    }
    return graph;
  }

  // ── Resolve Load Order ────────────────────────────────────────
  resolveLoadOrder(names) {
    const result = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular dependency detected: ${name}`);

      visiting.add(name);
      const plugin = this._plugins.get(name);
      if (plugin) {
        for (const dep of plugin.dependencies) {
          visit(dep);
        }
      }
      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of (names || this._plugins.keys())) {
      visit(name);
    }
    return result;
  }

  // ── Persistence ───────────────────────────────────────────────
  _persist(event) {
    if (!this._autoSave) return;
    this._writeLog(event).catch(() => {});
  }

  async _writeLog(event) {
    if (this._dataDir) {
      await mkdir(this._dataDir, { recursive: true }).catch(() => {});
    }
    const line = JSON.stringify(event) + '\n';
    try {
      const { appendFile } = await import('fs/promises');
      await appendFile(this._persistFile, line);
    } catch {}
  }

  // ── Internal ──────────────────────────────────────────────────
  _get(name) {
    if (!this._plugins.has(name)) throw new Error(`Plugin "${name}" not found`);
    return this._plugins.get(name);
  }

  _createPluginContext(pluginName) {
    return {
      name: pluginName,
      hooks: this._hooks,
      callHook: this.callHook.bind(this),
      shared: {
        get: (key) => this._context.get(key),
        set: (key, value) => this._context.set(key, value, pluginName),
        has: (key) => this._context.has(key),
        delete: (key) => this._context.delete(key, pluginName),
        keys: () => this._context.keys(),
        entries: () => this._context.entries(),
        onChange: (key, fn) => this._context.onChange(key, fn),
        offChange: (key, fn) => this._context.offChange(key, fn)
      },
      plugin: {
        get: (name) => this.get(name),
        list: (filter) => this.list(filter),
        call: (name, method, ...args) => this.callPlugin(name, method, ...args),
        enabled: () => this.enabled(),
        providers: (cap) => this.providers(cap)
      },
      config: this._get(pluginName).config,
      emit: (event, data) => this.emit(`plugin:${pluginName}:${event}`, data),
      on: (event, fn) => this.on(`plugin:${pluginName}:${event}`, fn)
    };
  }
}

export { PluginManager, Plugin, PluginState, HookManager, SharedContext };
export default PluginManager;
