#!/usr/bin/env node
/**
 * agent-webhook CLI
 */

import { WebhookDispatcher } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';

function flag(name, def) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  return args[idx + 1] || def;
}

async function main() {
  switch (cmd) {
    case 'serve': {
      const port = parseInt(flag('port', '3107'));
      const d = new WebhookDispatcher({
        port,
        persistDir: flag('log-dir', null),
        secrets: parseSecrets(),
      });

      // Register demo handlers
      d.on('/webhook', async (e) => {
        console.log(`📥 [${e.source}] ${e.eventType} on ${e.path} — ${JSON.stringify(e.body).slice(0, 100)}`);
      });

      d.on({ source: 'github' }, async (e) => {
        console.log(`🐙 GitHub: ${e.eventType} — ${e.metadata.repo || 'unknown'}`);
      });

      d.on({ source: 'stripe' }, async (e) => {
        console.log(`💳 Stripe: ${e.eventType} — ${e.metadata.stripeEventId || ''}`);
      });

      d.on('received', (e) => {}); // suppress internal event

      d.on('listening', ({ port }) => console.log(`\n🐋 agent-webhook listening on :${port}`));
      d.on('delivered', ({ event, route }) => console.log(`  ✅ Delivered: ${event.eventType} → ${route}`));
      d.on('deduped', (e) => console.log(`  ⏭️ Deduped: ${e.id.slice(0, 8)}`));
      d.on('signature_failed', (e) => console.log(`  🔒 Signature failed: ${e.source}`));
      d.on('retry_scheduled', ({ event, error }) => console.log(`  🔄 Retry: ${event.id.slice(0, 8)} — ${error.message}`));

      await d.start();
      console.log(`   POST /webhook    — generic endpoint`);
      console.log(`   GET  /health     — health + stats`);
      console.log(`   GET  /stats      — detailed statistics`);
      console.log(`   GET  /handlers   — registered handlers`);
      console.log(`   GET  /           — web dashboard\n`);
      break;
    }

    case 'emit': {
      const source = flag('source', 'custom');
      const path = flag('path', '/webhook');
      const body = flag('body', '{}');
      const eventType = flag('event', null);

      const d = new WebhookDispatcher({ port: 0 });
      d.on(/.*/, async (e) => console.log(JSON.stringify(e.body, null, 2)));

      const event = {
        id: crypto.randomUUID?.() || Date.now().toString(36),
        source, path, method: 'POST', headers: {},
        body: JSON.parse(body), rawBody: body,
        timestamp: Date.now(),
        eventType: eventType || JSON.parse(body)?.event || JSON.parse(body)?.type || 'custom',
        metadata: {},
      };

      const result = await d.dispatch(event);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'gen-signature': {
      const { createHmac } = await import('node:crypto');
      const secret = flag('secret', 'test-secret');
      const payload = args.find(a => !a.startsWith('--') && a !== 'gen-signature') || '{"test":true}';
      const algo = flag('algo', 'sha256');
      const sig = createHmac(algo, secret).update(payload).digest('hex');
      console.log(`${algo}=${sig}`);
      break;
    }

    case 'sources': {
      const { SOURCES } = await import('./index.mjs');
      console.log('Supported webhook sources:');
      for (const [name, preset] of Object.entries(SOURCES)) {
        const sig = preset.signature ? `${preset.signature.header}` : 'none';
        console.log(`  ${name.padEnd(12)} signature: ${sig}`);
      }
      break;
    }

    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }

    case 'demo': {
      console.log('🐋 agent-webhook demo\n');
      const d = new WebhookDispatcher({ port: 0 });

      // Register handlers
      d.on({ source: 'github', eventType: 'push' }, async (e) => {
        console.log(`  🐙 Push to ${e.metadata.repo} by ${e.metadata.sender}`);
      });

      d.on({ source: 'stripe' }, async (e) => {
        console.log(`  💳 Stripe: ${e.eventType}`);
      });

      d.on('/webhook/*', async (e) => {
        console.log(`  📥 ${e.source} → ${e.path}: ${e.eventType}`);
      });

      // Emit test events
      const tests = [
        { source: 'github', path: '/webhook', body: { action: 'opened', repository: { full_name: 'user/repo' }, sender: { login: 'dev' } }, eventType: 'push' },
        { source: 'stripe', path: '/webhook', body: { id: 'evt_123', type: 'payment_intent.succeeded', livemode: false }, eventType: 'payment_intent.succeeded' },
        { source: 'custom', path: '/webhook/orders', body: { order_id: 'ORD-42', status: 'shipped' }, eventType: 'order.shipped' },
        { source: 'custom', path: '/webhook', body: { alert: 'cpu_high', value: 92 }, eventType: 'system.alert' },
      ];

      for (const t of tests) {
        const event = {
          id: crypto.randomUUID?.() || Date.now().toString(36),
          ...t, method: 'POST', headers: {},
          rawBody: JSON.stringify(t.body), timestamp: Date.now(), metadata: {},
        };
        if (t.source === 'github') event.metadata = { repo: t.body.repository?.full_name, sender: t.body.sender?.login };
        console.log(`\nEmitting: ${t.source}/${t.eventType}`);
        await d.dispatch(event);
      }

      console.log(`\n📊 Stats: ${JSON.stringify(d.stats, null, 2)}`);
      break;
    }

    case 'help':
    default:
      console.log(`
🐋 agent-webhook — Zero-dep webhook dispatcher for AI agents

COMMANDS:
  serve [--port 3107] [--log-dir DIR] [--secret SOURCE:SECRET]  Start HTTP server
  emit [--source custom] [--path /webhook] [--body '{}'] [--event type]  Emit test event
  gen-signature [--secret KEY] [--algo sha256] [payload]  Generate HMAC signature
  sources  List supported source presets
  mcp  Start MCP server (stdio)
  demo  Run interactive demo
  help  Show this help

EXAMPLES:
  agent-webhook serve --port 3107 --secret github:mysecret
  agent-webhook emit --source github --event push --body '{"action":"opened"}'
  agent-webhook gen-signature --secret mykey '{"data":"test"}'
  agent-webhook mcp
`);
  }
}

function parseSecrets() {
  const secrets = {};
  for (const a of args) {
    if (a.startsWith('--secret') && a.includes(':')) {
      // Already handled above
    }
  }
  // Parse --secret key:value pairs from env or args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--secret' && args[i + 1]?.includes(':')) {
      const [src, sec] = args[i + 1].split(':');
      secrets[src] = sec;
    }
  }
  return secrets;
}

main().catch(err => { console.error(err); process.exit(1); });
