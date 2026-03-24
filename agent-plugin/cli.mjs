#!/usr/bin/env node
/**
 * agent-plugin CLI
 */

import { PluginManager } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

const manager = new PluginManager({ dataDir: process.env.DATA_DIR || './data' });

function help() {
  console.log(`
🔌 agent-plugin CLI — Plugin system for AI agents

Commands:
  register <name> [opts]     Register a plugin
  load <name>                Load a registered plugin
  enable <name>              Enable a loaded/disabled plugin
  disable <name>             Disable an enabled plugin
  uninstall <name>           Uninstall a plugin
  reload <name>              Hot-reload a plugin
  call <name> <method> [args]  Call a plugin method
  list [--state=<s>]         List plugins
  get <name>                 Get plugin details
  hooks                      List all hooks
  call-hook <hook> <data>    Call a hook
  deps                       Show dependency graph
  resolve                    Show load order
  stats                      Show statistics
  demo                       Run demo
  serve                      Start HTTP server
  help                       Show this help

Options:
  --port=<n>    HTTP server port (default: 3129)
  --data=<dir>  Data directory (default: ./data)
`);
}

async function main() {
  switch (cmd) {
    case 'list': {
      const state = args.find(a => a.startsWith('--state='))?.split('=')[1];
      const tag = args.find(a => a.startsWith('--tag='))?.split('=')[1];
      const plugins = manager.list({ state, tag });
      if (plugins.length === 0) { console.log('No plugins found.'); break; }
      for (const p of plugins) {
        console.log(`  ${p.state === 'enabled' ? '✅' : p.state === 'error' ? '❌' : '⏸️'} ${p.name}@${p.version} [${p.state}] ${p.tags.length ? '(' + p.tags.join(', ') + ')' : ''}`);
        if (p.description) console.log(`     ${p.description}`);
      }
      break;
    }
    case 'get': {
      const name = args[1];
      if (!name) { console.error('Usage: get <name>'); process.exit(1); }
      const plugin = manager.get(name);
      console.log(JSON.stringify(plugin, null, 2));
      break;
    }
    case 'hooks': {
      const hooks = manager.listHooks();
      for (const [name, handlers] of Object.entries(hooks)) {
        console.log(`  🪝 ${name}: ${handlers.map(h => `${h.plugin}(${h.priority})`).join(', ')}`);
      }
      if (Object.keys(hooks).length === 0) console.log('No hooks registered.');
      break;
    }
    case 'deps': {
      const graph = manager.depGraph();
      for (const [name, d] of Object.entries(graph)) {
        console.log(`  ${name} → deps: ${d.dependencies.join(', ') || 'none'} | used by: ${d.dependents.join(', ') || 'none'}`);
      }
      break;
    }
    case 'resolve': {
      const order = manager.resolveLoadOrder();
      console.log('  Load order:', order.join(' → '));
      break;
    }
    case 'stats': {
      const stats = manager.stats();
      console.log(JSON.stringify(stats, null, 2));
      break;
    }
    case 'demo': {
      console.log('🔌 Running plugin system demo...\n');

      // Register plugins
      manager.register({
        name: 'logger',
        version: '1.0.0',
        description: 'Console logger',
        tags: ['logging'],
        hooks: ['beforeAction', 'afterAction'],
        provides: ['logging'],
        priority: 50
      }, () => ({
        log(msg) { return { time: new Date().toISOString(), msg }; },
        beforeAction(data) { console.log(`  📝 [logger] before:`, data); return data; },
        afterAction(data) { console.log(`  📝 [logger] after:`, data); return data; }
      }));

      manager.register({
        name: 'auth',
        version: '1.0.0',
        description: 'Authentication check',
        tags: ['security', 'auth'],
        hooks: ['beforeAction'],
        provides: ['auth'],
        priority: 10  // runs first
      }, () => ({
        beforeAction(data) {
          console.log(`  🔒 [auth] checking credentials...`);
          return { ...data, authenticated: true };
        },
        check(token) {
          return { valid: token === 'secret123', userId: 'user-1' };
        }
      }));

      manager.register({
        name: 'analytics',
        version: '1.0.0',
        description: 'Usage analytics',
        tags: ['monitoring'],
        hooks: ['afterAction'],
        dependencies: ['logger'],
        provides: ['analytics'],
        consumes: ['logging'],
        priority: 90
      }, (ctx) => ({
        afterAction(data) {
          console.log(`  📊 [analytics] tracked action`);
          ctx.shared.set('lastAction', data);
          return data;
        },
        getStats() {
          return { actions: 42, lastAction: ctx.shared.get('lastAction') };
        }
      }));

      // Enable all
      console.log('1️⃣ Enabling plugins...');
      for (const name of ['logger', 'auth', 'analytics']) {
        await manager.enable(name);
        console.log(`   ✅ ${name} enabled`);
      }

      // Call hooks
      console.log('\n2️⃣ Calling beforeAction hook (auth runs first, then logger):');
      let data = await manager.callHook('beforeAction', { action: 'test', user: 'reza' });
      console.log('   Result:', data);

      console.log('\n3️⃣ Calling afterAction hook (logger → analytics):');
      data = await manager.callHook('afterAction', data);

      // Cross-plugin calls
      console.log('\n4️⃣ Cross-plugin communication:');
      const logResult = await manager.callPlugin('logger', 'log', 'Hello from CLI!');
      console.log('   Logger result:', logResult);
      const authResult = await manager.callPlugin('auth', 'check', 'secret123');
      console.log('   Auth result:', authResult);
      const stats = await manager.callPlugin('analytics', 'getStats');
      console.log('   Analytics result:', stats);

      // Shared context
      console.log('\n5️⃣ Shared context:');
      const ctx = manager.getContext();
      console.log('   Keys:', ctx.keys());
      console.log('   lastAction:', ctx.get('lastAction'));

      // Stats
      console.log('\n6️⃣ Manager stats:');
      console.log('   ', JSON.stringify(manager.stats()));

      console.log('\n✅ Demo complete!');
      break;
    }
    case 'serve': {
      const { default: http } = await import('http');
      const PORT = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '3129');
      // Import and run server
      const mod = await import('./server.mjs');
      break;
    }
    default:
      help();
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
