#!/usr/bin/env node
/**
 * agent-queue CLI
 *
 * Usage:
 *   node cli.mjs <command> [options]
 *
 * Commands:
 *   publish <topic> <payload>   Publish a message
 *   subscribe <pattern>         Subscribe and print messages
 *   topics                      List all topics
 *   subscribers                 List subscribers
 *   messages <topic>            Query messages
 *   dead-letter                 View dead letter queue
 *   replay <topic>              Replay messages
 *   purge [topic]               Purge messages
 *   stats                       Queue statistics
 *   serve                       Start HTTP server
 *   mcp                         Start MCP server
 *   demo                        Run demo
 */

import { AgentQueue } from './index.mjs';
import { join } from 'path';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const dataDir = process.env.QUEUE_DATA_DIR || join(process.env.HOME || '/tmp', '.agent-queue');

async function main() {
  switch (cmd) {
    case 'publish': {
      const topic = args[1];
      if (!topic) { console.error('Usage: publish <topic> <payload>'); process.exit(1); }
      const payload = args[2] ? JSON.parse(args[2]) : 'ping';
      const q = new AgentQueue({ dataDir, enablePersistence: true });
      const msg = q.publish(topic, payload);
      console.log(JSON.stringify(msg, null, 2));
      q.destroy();
      break;
    }

    case 'subscribe': {
      const pattern = args[1];
      if (!pattern) { console.error('Usage: subscribe <pattern>'); process.exit(1); }
      const q = new AgentQueue({ dataDir, enablePersistence: true });
      console.error(`Subscribed to ${pattern}. Waiting for messages...`);
      q.subscribe(pattern, (msg, { ack }) => {
        console.log(JSON.stringify(msg));
        ack();
      });
      process.on('SIGINT', () => { q.destroy(); process.exit(); });
      break;
    }

    case 'topics': {
      const q = new AgentQueue({ dataDir });
      console.log(JSON.stringify(q.getTopics(), null, 2));
      q.destroy();
      break;
    }

    case 'subscribers': {
      const q = new AgentQueue({ dataDir });
      console.log(JSON.stringify(q.getSubscribers(), null, 2));
      q.destroy();
      break;
    }

    case 'messages': {
      const topic = args[1];
      if (!topic) { console.error('Usage: messages <topic>'); process.exit(1); }
      const q = new AgentQueue({ dataDir });
      console.log(JSON.stringify(q.getMessages(topic), null, 2));
      q.destroy();
      break;
    }

    case 'dead-letter': {
      const q = new AgentQueue({ dataDir });
      console.log(JSON.stringify(q.getDeadLetter(), null, 2));
      q.destroy();
      break;
    }

    case 'replay': {
      const topic = args[1];
      if (!topic) { console.error('Usage: replay <topic>'); process.exit(1); }
      const q = new AgentQueue({ dataDir });
      await q.replay(topic, (msg) => console.log(JSON.stringify(msg)));
      q.destroy();
      break;
    }

    case 'purge': {
      const topic = args[1];
      const q = new AgentQueue({ dataDir });
      const count = q.purge(topic);
      console.log(`Purged ${count} messages${topic ? ` from ${topic}` : ''}`);
      q.destroy();
      break;
    }

    case 'stats': {
      const q = new AgentQueue({ dataDir });
      console.log(JSON.stringify({
        ...q.stats,
        messages: q.messages.size,
        topics: q.topics.size,
        subscribers: q.subscribers.size,
        deadLetter: q.deadLetter.length
      }, null, 2));
      q.destroy();
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
      console.log('🚀 agent-queue demo\n');
      const q = new AgentQueue({ dataDir: join(dataDir, 'demo'), enablePersistence: true });

      // Subscribe
      q.subscribe('orders.*', (msg, { ack }) => {
        console.log(`📦 Received: ${msg.topic} → ${JSON.stringify(msg.payload)}`);
        ack();
      });

      // Publish
      console.log('\nPublishing messages...');
      q.publish('orders.new', { id: 'ORD-001', item: 'Widget', qty: 3 });
      q.publish('orders.shipped', { id: 'ORD-001', tracking: 'TRK-123' });
      q.publish('orders.cancelled', { id: 'ORD-002', reason: 'out_of_stock' });
      q.publish('other.event', { not: 'matched' });

      // Stats
      console.log('\n📊 Stats:', JSON.stringify(q.stats, null, 2));
      console.log('\n📋 Topics:', JSON.stringify(q.getTopics(), null, 2));

      // Request-reply
      q.subscribe('echo', (msg, { ack }) => {
        q.reply(msg, { echo: msg.payload });
        ack();
      });
      const reply = await q.request('echo', { message: 'hello' });
      console.log('\n🔄 Request-reply:', JSON.stringify(reply.payload, null, 2));

      // Priority demo
      console.log('\n⚡ Priority demo:');
      const priQ = new AgentQueue({ dataDir: join(dataDir, 'pri-demo') });
      priQ.subscribe('pri.*', (msg) => console.log(`  [${msg.priority}] ${msg.payload}`));
      priQ.publish('pri.test', 'low', { priority: 'low' });
      priQ.publish('pri.test', 'CRITICAL', { priority: 'critical' });
      priQ.publish('pri.test', 'high', { priority: 'high' });
      priQ.publish('pri.test', 'normal', { priority: 'normal' });

      q.destroy();
      priQ.destroy();
      console.log('\n✅ Demo complete');
      break;
    }

    case 'help':
    default: {
      console.log(`
agent-queue — Zero-dep message queue for AI agents

Commands:
  publish <topic> <payload>    Publish a message (JSON payload)
  subscribe <pattern>          Subscribe to topic pattern (*, **)
  topics                       List all topics
  subscribers                  List active subscriptions
  messages <topic>             Query messages for topic
  dead-letter                  View dead letter queue
  replay <topic>               Replay messages for topic
  purge [topic]                Purge messages (all if no topic)
  stats                        Queue statistics
  serve                        Start HTTP server (port 3116)
  mcp                          Start MCP server (stdio)
  demo                         Run interactive demo
  help                         Show this help

Environment:
  QUEUE_DATA_DIR    Data directory (default: ~/.agent-queue)

Examples:
  node cli.mjs publish orders.new '{"id":"001","item":"widget"}'
  node cli.mjs subscribe 'orders.*'
  node cli.mjs topics
  node cli.mjs stats
  node cli.mjs demo
`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
