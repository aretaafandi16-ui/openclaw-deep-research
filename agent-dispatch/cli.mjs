#!/usr/bin/env node
/**
 * agent-dispatch CLI
 */

import { Dispatcher, Classifier, matchPattern, applyTransform } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function help() {
  console.log(`
🐋 agent-dispatch CLI

Commands:
  submit <json>          Submit a message for dispatch
  add-route <name> <pat> Add a routing rule
  remove-route <id>      Remove a route
  list-routes            List all routes
  enable-route <id>      Enable a route
  disable-route <id>     Disable a route
  fan-out <json> <ids>   Send to multiple routes
  process [batchSize]    Process queued messages
  dlq                    List dead letter queue
  dlq-retry [max]        Retry DLQ entries
  dlq-clear              Clear DLQ
  history [limit]        Show dispatch history
  stats                  Show dispatcher stats
  match <json> <pattern> Test pattern matching
  classify <json>        Classify a message
  demo                   Run demo
  serve                  Start HTTP server
  mcp                    Start MCP server
  help                   Show this help
  `);
}

async function main() {
  const dispatcher = new Dispatcher({ id: 'cli' });

  switch (cmd) {
    case 'submit': {
      const msg = JSON.parse(args[1] || '{}');
      const result = await dispatcher.submit(msg, {
        priority: args.includes('--priority') ? args[args.indexOf('--priority') + 1] : 'normal',
        enqueue: args.includes('--enqueue'),
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'add-route': {
      const name = args[1] || 'unnamed';
      const patternJson = args[2] || '{}';
      const pattern = JSON.parse(patternJson);
      const route = dispatcher.addRoute({ name, pattern });
      console.log(`✅ Route added: ${route.id} (${route.name})`);
      break;
    }

    case 'remove-route': {
      const ok = dispatcher.removeRoute(args[1]);
      console.log(ok ? '✅ Removed' : '❌ Not found');
      break;
    }

    case 'list-routes': {
      const routes = dispatcher.listRoutes();
      if (routes.length === 0) { console.log('No routes configured.'); break; }
      for (const r of routes) {
        const status = r.enabled ? '🟢' : '🔴';
        const pat = r.pattern ? JSON.stringify(r.pattern) : '*';
        console.log(`${status} ${r.id}  ${r.name}  pattern=${pat}  matched=${r.stats.matched}  delivered=${r.stats.delivered}`);
      }
      break;
    }

    case 'enable-route': {
      console.log(dispatcher.enableRoute(args[1]) ? '✅ Enabled' : '❌ Not found');
      break;
    }

    case 'disable-route': {
      console.log(dispatcher.disableRoute(args[1]) ? '✅ Disabled' : '❌ Not found');
      break;
    }

    case 'fan-out': {
      const msg = JSON.parse(args[1] || '{}');
      const ids = (args[2] || '').split(',');
      const results = await dispatcher.fanOut(msg, ids);
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case 'process': {
      const n = await dispatcher.processQueue(parseInt(args[1]) || 10);
      console.log(`Processed ${n} messages. ${dispatcher.queue.size} remaining.`);
      break;
    }

    case 'dlq': {
      const dlq = dispatcher.getDLQ();
      if (dlq.length === 0) { console.log('DLQ is empty.'); break; }
      for (const e of dlq.slice(-20)) {
        console.log(`💀 ${e.messageId}  reason=${e.reason}  retries=${e.retries}  time=${new Date(e.timestamp).toISOString()}`);
      }
      break;
    }

    case 'dlq-retry': {
      const results = await dispatcher.retryDLQ(parseInt(args[1]) || 10);
      console.log(`Retried ${results.length} entries.`);
      for (const r of results) {
        console.log(`  ${r.messageId}: ${r.result?.success ? '✅' : '❌'} ${r.result?.error || ''}`);
      }
      break;
    }

    case 'dlq-clear': {
      console.log(`Cleared ${dispatcher.clearDLQ()} DLQ entries.`);
      break;
    }

    case 'history': {
      const hist = dispatcher.getHistory({ limit: parseInt(args[1]) || 30 });
      for (const h of hist.slice(-20)) {
        const icon = h.success ? '✅' : '❌';
        console.log(`${icon} ${h.routeName || h.routeId || '-'}  ${new Date(h.timestamp).toISOString()}  ${h.error || ''}`);
      }
      break;
    }

    case 'stats': {
      const info = dispatcher.getInfo();
      console.log(JSON.stringify(info, null, 2));
      break;
    }

    case 'match': {
      const msg = JSON.parse(args[1] || '{}');
      const pattern = JSON.parse(args[2] || '{}');
      const result = matchPattern(msg, pattern);
      console.log(result ? '✅ MATCH' : '❌ NO MATCH');
      break;
    }

    case 'classify': {
      const classifier = new Classifier([
        { name: 'order', pattern: { type: 'prefix', field: 'type', value: 'order.' }, tags: ['commerce'] },
        { name: 'user', pattern: { type: 'prefix', field: 'type', value: 'user.' }, tags: ['identity'] },
        { name: 'system', pattern: { type: 'prefix', field: 'type', value: 'system.' }, tags: ['ops'] },
        { name: 'error', pattern: { type: 'contains', field: 'type', value: 'error' }, tags: ['alert'] },
      ]);
      const msg = JSON.parse(args[1] || '{"type":"order.created"}');
      const result = classifier.classify(msg);
      console.log(`Classes: ${result.classes.join(', ') || 'none'}`);
      console.log(`Tags: ${msg._tags?.join(', ') || 'none'}`);
      break;
    }

    case 'demo': {
      console.log('🐋 agent-dispatch demo\n');

      // Setup routes
      dispatcher.addRoute({ name: 'order-handler', pattern: { type: 'prefix', field: 'type', value: 'order.' }, priority: 'high',
        handler: (msg) => console.log(`  📦 Order handler: ${msg.type}`) });
      dispatcher.addRoute({ name: 'user-handler', pattern: { type: 'prefix', field: 'type', value: 'user.' },
        handler: (msg) => console.log(`  👤 User handler: ${msg.type}`) });
      dispatcher.addRoute({ name: 'all-logger', pattern: null, weight: 0,
        handler: (msg) => console.log(`  📝 Logger: ${msg.type}`) });
      dispatcher.addRoute({ name: 'critical-alert', pattern: { type: 'exact', field: 'severity', value: 'critical' }, priority: 'critical',
        handler: (msg) => console.log(`  🚨 Critical alert: ${msg.type}`) });
      dispatcher.addRoute({ name: 'high-value', pattern: { type: 'custom', field: null, value: (msg) => (msg.amount || 0) > 1000 },
        handler: (msg) => console.log(`  💰 High value: $${msg.amount}`) });

      dispatcher.setStrategy = s => { dispatcher._strategy = s; };

      console.log('--- First-match strategy ---');
      dispatcher._strategy = 'first-match';
      await dispatcher.submit({ type: 'order.created', orderId: '123', amount: 500 });
      await dispatcher.submit({ type: 'user.login', userId: 'abc' });

      console.log('\n--- All-match strategy ---');
      dispatcher._strategy = 'all-match';
      await dispatcher.submit({ type: 'order.shipped', orderId: '456' });

      console.log('\n--- Priority queue ---');
      await dispatcher.submit({ type: 'user.logout', userId: 'def' }, { enqueue: true, priority: 'low' });
      await dispatcher.submit({ type: 'system.alert', severity: 'critical' }, { enqueue: true, priority: 'critical' });
      await dispatcher.submit({ type: 'order.refund', orderId: '789' }, { enqueue: true, priority: 'high' });
      console.log(`  Queue: critical=${dispatcher.queue.sizes().critical} high=${dispatcher.queue.sizes().high} normal=${dispatcher.queue.sizes().normal} low=${dispatcher.queue.sizes().low}`);
      await dispatcher.processQueue(10);

      console.log('\n--- Fan-out ---');
      dispatcher._strategy = 'first-match';
      const routes = dispatcher.listRoutes().slice(0, 2).map(r => r.id);
      await dispatcher.fanOut({ type: 'broadcast.test', msg: 'hello all' }, routes);

      console.log('\n--- Transforms ---');
      const route = dispatcher.addRoute({
        name: 'transformer',
        pattern: { type: 'exact', field: 'type', value: 'raw.data' },
        transforms: [
          { op: 'set', field: 'processed', value: true },
          { op: 'uppercase', field: 'name' },
          { op: 'set', field: 'label', template: '{{name}} - {{type}}' },
        ],
        handler: (msg) => console.log(`  🔄 Transformed: ${JSON.stringify(msg)}`),
      });
      await dispatcher.submit({ type: 'raw.data', name: 'hello world' });

      console.log('\n--- Stats ---');
      const info = dispatcher.getInfo();
      console.log(`  Received: ${info.stats.received}  Dispatched: ${info.stats.dispatched}  Routes: ${info.routes}`);

      console.log('\n✅ Demo complete!');
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

    default:
      help();
  }

  dispatcher.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
