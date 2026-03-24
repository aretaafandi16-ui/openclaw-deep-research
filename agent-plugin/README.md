# 🔌 agent-plugin

Zero-dependency plugin system for AI agents. Dynamic loading, lifecycle management, hook system, dependency resolution, and inter-plugin communication.

## Features

- **Plugin Lifecycle**: register → load → enable → disable → uninstall with full state machine
- **Hook System**: Priority-ordered async hooks with sequential/parallel execution, per-plugin registration
- **Dependency Resolution**: Automatic dependency loading, topological sort, circular dependency detection
- **Hot Reload**: Reload plugins without restarting the manager
- **Shared Context**: Inter-plugin key-value store with change events
- **Cross-Plugin Calls**: Call methods on other plugins with automatic stat tracking
- **Event Emitter**: Lifecycle events (registered/loaded/enabled/disabled/uninstalled)
- **Persistence**: JSONL event logging for audit trail
- **HTTP Dashboard**: Dark-theme web UI with real-time monitoring
- **MCP Server**: 12 tools via Model Context Protocol
- **CLI**: Full command-line interface

## Quick Start

```js
import { PluginManager } from './index.mjs';

const manager = new PluginManager();

// Register plugins
manager.register({
  name: 'logger',
  version: '1.0.0',
  tags: ['logging'],
  hooks: ['beforeAction', 'afterAction'],
  provides: ['logging'],
  priority: 50
}, (ctx) => ({
  log(msg) { return { time: Date.now(), msg }; },
  beforeAction(data) { console.log('before:', data); return data; },
  afterAction(data) { console.log('after:', data); return data; }
}));

manager.register({
  name: 'analytics',
  dependencies: ['logger'],
  hooks: ['afterAction'],
  provides: ['analytics']
}, (ctx) => ({
  afterAction(data) {
    ctx.shared.set('lastAction', data);  // share with other plugins
    return data;
  },
  getStats() { return { actions: 42 }; }
}));

// Enable (auto-loads dependencies)
await manager.enable('logger');
await manager.enable('analytics');

// Call hooks (runs plugins in priority order)
const result = await manager.callHook('beforeAction', { action: 'test' });

// Cross-plugin method calls
const stats = await manager.callPlugin('analytics', 'getStats');
```

## Plugin Manifest

```js
{
  name: 'my-plugin',          // Required, unique
  version: '1.0.0',           // Default: '1.0.0'
  description: 'Does things',  // Optional
  author: 'Reza',             // Optional
  tags: ['core', 'util'],     // Filterable tags
  dependencies: ['other'],    // Auto-loaded first
  hooks: ['onEvent'],         // Methods to register as hooks
  provides: ['capability'],   // What this plugin provides
  consumes: ['capability'],   // What this plugin needs
  priority: 50,               // Hook execution order (lower = first)
  config: { key: 'val' }      // Plugin config (accessible via ctx.config)
}
```

## Factory Function

The factory receives a context object:

```js
(ctx) => ({
  // Hook methods (registered automatically if listed in hooks[])
  async onEvent(data) { return data; },

  // Lifecycle hooks
  async enable() { /* called when enabled */ },
  async disable() { /* called when disabled */ },
  async uninstall() { /* called when uninstalled */ },

  // Custom methods (callable via manager.callPlugin)
  myMethod(arg) { return arg * 2; }
})
```

### Context API

| Property | Description |
|----------|-------------|
| `ctx.name` | This plugin's name |
| `ctx.config` | Plugin configuration |
| `ctx.shared.get(key)` | Read shared context |
| `ctx.shared.set(key, val)` | Write to shared context |
| `ctx.shared.onChange(key, fn)` | Listen for context changes |
| `ctx.plugin.get(name)` | Get another plugin's info |
| `ctx.plugin.call(name, method, ...args)` | Call another plugin's method |
| `ctx.plugin.providers(cap)` | Find plugins providing a capability |
| `ctx.callHook(name, data)` | Call a hook from within a plugin |
| `ctx.emit(event, data)` | Emit a plugin-specific event |

## Hook System

```js
// Hooks are called in priority order (ascending)
manager.register({ name: 'auth', hooks: ['validate'], priority: 10 }, ...);
manager.register({ name: 'log', hooks: ['validate'], priority: 100 }, ...);

// Sequential (default) — output of one feeds into next
const result = await manager.callHook('validate', input);

// Parallel — all run on same input
const results = await manager.callHook('validate', input, { sequential: false });

// Collect individual results
const results = await manager.callHook('validate', input, { collect: true });
// → [{ plugin: 'auth', result: ... }, { plugin: 'log', result: ... }]
```

## CLI

```bash
# Register and enable
node cli.mjs register my-plugin --tags=core,util
node cli.mjs enable my-plugin

# List and inspect
node cli.mjs list --state=enabled
node cli.mjs get my-plugin
node cli.mjs hooks
node cli.mjs deps

# Call methods
node cli.mjs call my-plugin myMethod arg1 arg2

# Lifecycle
node cli.mjs disable my-plugin
node cli.mjs reload my-plugin
node cli.mjs uninstall my-plugin

# Run demo
node cli.mjs demo

# Start HTTP dashboard
node cli.mjs serve --port=3129
```

## MCP Server

Start the MCP server for AI agent integration:

```bash
node mcp-server.mjs
```

### Tools (12)

| Tool | Description |
|------|-------------|
| `plugin_register` | Register a new plugin with manifest + factory code |
| `plugin_load` | Load a registered plugin |
| `plugin_enable` | Enable a loaded/disabled plugin |
| `plugin_disable` | Disable an enabled plugin |
| `plugin_uninstall` | Uninstall a plugin |
| `plugin_reload` | Hot-reload a plugin |
| `plugin_call` | Call a method on an enabled plugin |
| `plugin_get` | Get plugin details |
| `plugin_list` | List plugins (filterable by state/tag/provides) |
| `plugin_hook_call` | Call all handlers for a hook |
| `plugin_hooks_list` | List all registered hooks |
| `plugin_stats` | Get manager statistics |

## HTTP API

```bash
# Start server
PORT=3129 node server.mjs

# Endpoints
GET  /api/plugins          # List plugins (?state=enabled&tag=core)
POST /api/plugins          # Register plugin
GET  /api/plugins/:name    # Get plugin details
POST /api/plugins/:name/enable   # Enable
POST /api/plugins/:name/disable  # Disable
POST /api/plugins/:name/load     # Load
POST /api/plugins/:name/reload   # Hot reload
POST /api/plugins/:name/call     # Call method
DELETE /api/plugins/:name        # Uninstall
GET  /api/hooks            # List hooks
POST /api/hooks/call       # Call hook
GET  /api/stats            # Manager stats
GET  /api/deps             # Dependency graph
GET  /api/resolve          # Load order
GET  /                     # Web dashboard
```

## Use Cases

- **Capability composition**: Load/unload capabilities at runtime
- **Feature flags**: Enable/disable features without restart
- **Middleware chains**: Priority-ordered processing pipelines
- **Cross-agent communication**: Shared context for multi-plugin coordination
- **Plugin marketplace**: Validate dependencies, auto-install chain
- **A/B testing**: Hot-swap plugin implementations

## Tests

```bash
node test.mjs
# 25+ tests, all passing ✅
```

## License

MIT
