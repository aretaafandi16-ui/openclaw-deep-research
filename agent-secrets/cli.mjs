#!/usr/bin/env node
/**
 * agent-secrets CLI
 */

import AgentSecrets from './index.mjs';

const [,, cmd, ...args] = process.argv;

const secrets = new AgentSecrets({
  password: process.env.SECRETS_MASTER_PASSWORD || 'agent-secrets-default',
  persistPath: process.env.SECRETS_PERSIST_PATH || './secrets.enc',
});
await secrets.load();

function flag(name) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return null;
  return args[idx + 1] || true;
}

const commands = {
  set: () => {
    const [key, value] = args.filter(a => !a.startsWith('--'));
    if (!key || !value) return console.error('Usage: secrets set <key> <value> [--ns namespace] [--ttl seconds] [--tags a,b]');
    const tags = flag('tags')?.split(',').map(t => t.trim()) || [];
    const result = secrets.set(key, value, { namespace: flag('ns') || 'default', ttl: flag('ttl') ? parseInt(flag('ttl')) : undefined, tags, rotationInterval: flag('rotate') ? parseInt(flag('rotate')) : undefined });
    console.log(JSON.stringify(result, null, 2));
  },

  get: () => {
    const [key] = args.filter(a => !a.startsWith('--'));
    if (!key) return console.error('Usage: secrets get <key> [--ns namespace]');
    const result = secrets.get(key, { namespace: flag('ns') || 'default' });
    if (!result) return console.log('Not found');
    console.log(result.value);
  },

  get_json: () => {
    const [key] = args.filter(a => !a.startsWith('--'));
    if (!key) return console.error('Usage: secrets get-json <key> [--ns namespace]');
    const result = secrets.get(key, { namespace: flag('ns') || 'default' });
    console.log(JSON.stringify(result, null, 2));
  },

  delete: () => {
    const [key] = args.filter(a => !a.startsWith('--'));
    if (!key) return console.error('Usage: secrets delete <key> [--ns namespace]');
    console.log(secrets.delete(key, { namespace: flag('ns') || 'default' }) ? 'Deleted' : 'Not found');
  },

  has: () => {
    const [key] = args.filter(a => !a.startsWith('--'));
    if (!key) return console.error('Usage: secrets has <key> [--ns namespace]');
    console.log(secrets.has(key, { namespace: flag('ns') || 'default' }));
  },

  list: () => {
    const result = secrets.list({ namespace: flag('ns') || undefined, tag: flag('tag') || undefined });
    if (!result.length) return console.log('No secrets');
    console.table(result.map(e => ({ key: e.key, ns: e.namespace, status: e.expired ? 'EXPIRED' : e.needsRotation ? 'ROTATE' : 'OK', tags: (e.tags||[]).join(','), created: new Date(e.createdAt).toLocaleString() })));
  },

  keys: () => {
    const keys = secrets.keys(flag('ns') || undefined);
    keys.forEach(k => console.log(k));
  },

  search: () => {
    const [q] = args.filter(a => !a.startsWith('--'));
    if (!q) return console.error('Usage: secrets search <query> [--ns namespace]');
    console.log(JSON.stringify(secrets.search(q, { namespace: flag('ns') || undefined }), null, 2));
  },

  rotate: () => {
    const [key, value] = args.filter(a => !a.startsWith('--'));
    if (!key || !value) return console.error('Usage: secrets rotate <key> <new-value> [--ns namespace]');
    console.log(JSON.stringify(secrets.rotate(key, value, { namespace: flag('ns') || 'default' }), null, 2));
  },

  needs_rotation: () => {
    const result = secrets.needsRotation({ namespace: flag('ns') || undefined });
    if (!result.length) return console.log('All secrets are current');
    console.table(result);
  },

  to_env: () => {
    const env = secrets.toEnv(flag('ns') || undefined, flag('prefix') || '');
    for (const [k, v] of Object.entries(env)) console.log(`export ${k}="${v}"`);
  },

  inject_env: () => {
    const count = secrets.injectEnv(flag('ns') || undefined, flag('prefix') || '');
    console.log(`Injected ${count} env vars`);
  },

  stats: () => {
    console.log(JSON.stringify(secrets.stats(), null, 2));
  },

  audit: () => {
    const log = secrets.getAuditLog({ limit: parseInt(flag('limit') || '20'), namespace: flag('ns') || undefined, action: flag('action') || undefined });
    log.forEach(a => console.log(`${new Date(a.timestamp).toISOString()} [${a.action}] ${a.namespace}/${a.key}`));
  },

  export: () => {
    console.log(secrets.exportEncrypted(flag('ns') || undefined));
  },

  export_plain: () => {
    console.log(JSON.stringify(secrets.exportPlaintext(flag('ns') || undefined), null, 2));
  },

  namespaces: () => {
    secrets.namespaces().forEach(n => console.log(n));
  },

  delete_namespace: () => {
    const [ns] = args.filter(a => !a.startsWith('--'));
    if (!ns) return console.error('Usage: secrets delete-namespace <namespace>');
    console.log(`Deleted ${secrets.deleteNamespace(ns)} secrets`);
  },

  serve: async () => {
    const { default: mod } = await import('./server.mjs');
  },

  mcp: async () => {
    const { default: mod } = await import('./mcp-server.mjs');
  },

  help: () => console.log(`
agent-secrets — zero-dep secrets manager

Commands:
  set <key> <value>      Store a secret
  get <key>              Retrieve secret value
  get-json <key>         Retrieve secret as JSON
  delete <key>           Delete a secret
  has <key>              Check existence
  list                   List all secrets
  keys                   List key names
  search <query>         Search secrets
  rotate <key> <value>   Rotate a secret
  needs-rotation         List secrets needing rotation
  to-env                 Export as shell exports
  inject-env             Inject into process.env
  stats                  Show stats
  audit                  Show audit log
  export                 Export encrypted
  export-plain           Export plaintext JSON
  namespaces             List namespaces
  delete-namespace <ns>  Delete namespace
  serve                  Start HTTP server
  mcp                    Start MCP server

Flags: --ns <namespace> --ttl <seconds> --tags <a,b> --rotate <seconds> --limit <n> --prefix <str>
Env: SECRETS_MASTER_PASSWORD, SECRETS_PERSIST_PATH
`),

  demo: async () => {
    console.log('🔐 agent-secrets demo\n');

    secrets.set('OPENAI_API_KEY', 'sk-test-abc123', { namespace: 'prod', tags: ['ai', 'openai'], rotationInterval: 86400 * 30 });
    secrets.set('DATABASE_URL', 'postgres://user:pass@host:5432/db', { namespace: 'prod', tags: ['database'], ttl: 86400 * 90 });
    secrets.set('JWT_SECRET', 'super-secret-jwt-key', { namespace: 'prod', tags: ['auth'], rotationInterval: 86400 * 7 });
    secrets.set('STRIPE_KEY', 'sk_live_xxx', { namespace: 'prod', tags: ['payments', 'stripe'] });
    secrets.set('TEST_API_KEY', 'test-key-123', { namespace: 'staging', tags: ['ai'] });

    console.log('Stats:', JSON.stringify(secrets.stats(), null, 2));
    console.log('\nGet OPENAI_API_KEY:', secrets.get('OPENAI_API_KEY', { namespace: 'prod' })?.value);
    console.log('\nSearch "ai":', JSON.stringify(secrets.search('ai'), null, 2));
    console.log('\nProd secrets:', secrets.list({ namespace: 'prod' }).map(e => e.key));
    console.log('\nEnv export (prod):');
    const env = secrets.toEnv('prod');
    for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${v}`);
    console.log('\nRotate JWT_SECRET...');
    secrets.rotate('JWT_SECRET', 'new-rotated-key', { namespace: 'prod' });
    console.log('After rotate:', secrets.get('JWT_SECRET', { namespace: 'prod' })?.value);
    console.log('\nAudit (last 5):');
    secrets.getAuditLog({ limit: 5 }).forEach(a => console.log(`  ${a.action} ${a.namespace}/${a.key}`));
    console.log('\n✅ Done');
  },
};

if (!cmd || cmd === 'help') commands.help();
else if (commands[cmd]) await commands[cmd]();
else { console.error(`Unknown command: ${cmd}. Run "secrets help"`); process.exit(1); }

secrets.destroy();
