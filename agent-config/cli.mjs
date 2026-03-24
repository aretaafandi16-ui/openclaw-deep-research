#!/usr/bin/env node
/**
 * agent-config CLI
 */

import { AgentConfig } from './index.mjs';
import { existsSync } from 'fs';

const args = process.argv.slice(2);
const cmd = args[0];

function usage() {
  console.log(`
agent-config — Zero-dep configuration manager for AI agents

Commands:
  get <key>              Get config value (use --masked for secret masking)
  set <key> <value>      Set config value
  delete <key>           Delete config key
  has <key>              Check if key exists
  keys [prefix]          List keys
  get-all                Dump entire config (--masked)
  validate               Validate against schema
  snapshot <name>        Create snapshot
  rollback <name>        Rollback to snapshot
  snapshots              List snapshots
  history [limit]        Show change history
  export                 Export as JSON (masked)
  interpolate <template> Interpolate {{key}} in template
  stats                  Show config stats
  load <file>            Load from JSON file
  serve                  Start HTTP dashboard (port 3122)
  mcp                    Start MCP server (stdio)
  demo                   Interactive demo
  help                   Show this help
`);
}

const config = new AgentConfig({ dataDir: process.env.DATA_DIR || './data' });
config.loadEnv();

switch (cmd) {
  case 'get': {
    const key = args[1];
    if (!key) { console.error('Usage: get <key> [--masked]'); process.exit(1); }
    const masked = args.includes('--masked');
    console.log(masked ? config.getMasked(key) : config.get(key));
    break;
  }

  case 'set': {
    const key = args[1], value = args[2];
    if (!key || value === undefined) { console.error('Usage: set <key> <value>'); process.exit(1); }
    config.set(key, value);
    console.log(`✅ ${key} = ${config._isSecret(key) ? config.opts.maskValue : value}`);
    break;
  }

  case 'delete': {
    const key = args[1];
    if (!key) { console.error('Usage: delete <key>'); process.exit(1); }
    config.delete(key);
    console.log(`🗑️  Deleted: ${key}`);
    break;
  }

  case 'has': {
    const key = args[1];
    if (!key) { console.error('Usage: has <key>'); process.exit(1); }
    console.log(config.has(key) ? '✅ exists' : '❌ not found');
    break;
  }

  case 'keys': {
    const prefix = args[1] || '';
    console.log(config.keys(prefix).join('\n'));
    break;
  }

  case 'get-all': {
    const masked = args.includes('--masked');
    console.log(JSON.stringify(masked ? config.getAllMasked() : config.getAll(), null, 2));
    break;
  }

  case 'validate': {
    const result = config.validate();
    if (result.valid) console.log('✅ Config is valid');
    else { console.log('❌ Validation errors:'); result.errors.forEach(e => console.log('  -', e)); process.exit(1); }
    break;
  }

  case 'snapshot': {
    const name = args[1];
    if (!name) { console.error('Usage: snapshot <name>'); process.exit(1); }
    config.snapshot(name);
    console.log(`📸 Snapshot created: ${name}`);
    break;
  }

  case 'rollback': {
    const name = args[1];
    if (!name) { console.error('Usage: rollback <name>'); process.exit(1); }
    config.rollback(name);
    console.log(`⏪ Rolled back to: ${name}`);
    break;
  }

  case 'snapshots': {
    const snaps = config.listSnapshots();
    if (!snaps.length) console.log('No snapshots');
    else snaps.forEach(s => console.log(`  📸 ${s}`));
    break;
  }

  case 'history': {
    const limit = parseInt(args[1]) || 20;
    const hist = config.history(limit);
    if (!hist.length) console.log('No changes');
    else hist.forEach(h => console.log(`${h.timestamp?.slice(11, 19) || '?'} ${h.source || '?'} ${h.path}: ${JSON.stringify(h.oldValue)} → ${JSON.stringify(h.newValue)}`));
    break;
  }

  case 'export': {
    console.log(config.exportJSON());
    break;
  }

  case 'interpolate': {
    const template = args.slice(1).join(' ');
    if (!template) { console.error('Usage: interpolate <template>'); process.exit(1); }
    console.log(config.interpolate(template));
    break;
  }

  case 'stats': {
    const s = config.stats();
    console.log(`Keys: ${s.totalKeys}  Schema: ${s.schemaFields}  Secrets: ${s.secrets}  Snapshots: ${s.snapshots}  Watchers: ${s.watchers}  Changes: ${s.changes}`);
    break;
  }

  case 'load': {
    const file = args[1];
    if (!file || !existsSync(file)) { console.error('Usage: load <file.json>'); process.exit(1); }
    config.loadFile(file);
    console.log(`✅ Loaded from ${file}`);
    break;
  }

  case 'serve': {
    await import('./server.mjs');
    break;
  }

  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }

  case 'demo': {
    console.log('=== agent-config demo ===\n');
    config
      .defineSchema({
        database: { type: 'object' },
        'database.host': { type: 'string', default: 'localhost' },
        'database.port': { type: 'number', default: 5432, min: 1, max: 65535 },
        'database.password': { type: 'string', secret: true },
        'server.port': { type: 'number', default: 3000 },
        'server.debug': { type: 'boolean', default: false },
        'api.key': { type: 'string' },
      })
      .set('database.host', 'prod-db.example.com')
      .set('database.port', 5432)
      .set('database.password', 'supersecret123', { source: 'env' })
      .set('server.port', 8080)
      .set('server.debug', true)
      .set('api.key', 'sk-1234567890', { source: 'env' });

    console.log('Config (masked):', JSON.stringify(config.getAllMasked(), null, 2));
    console.log('\nValidate:', JSON.stringify(config.validate(), null, 2));

    config.snapshot('before-deploy');
    config.set('server.port', 3000);
    console.log('\nAfter change:', config.get('server.port'));
    config.rollback('before-deploy');
    console.log('After rollback:', config.get('server.port'));

    console.log('\nInterpolated:', config.interpolate('Server running on {{database.host}}:{{server.port}}'));
    console.log('\nStats:', JSON.stringify(config.stats(), null, 2));
    console.log('\nHistory (last 3):');
    config.history(3).forEach(h => console.log(`  ${h.path}: ${JSON.stringify(h.oldValue)} → ${JSON.stringify(h.newValue)} (${h.source})`));
    break;
  }

  case 'help':
  case undefined:
    usage();
    break;

  default:
    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exit(1);
}
