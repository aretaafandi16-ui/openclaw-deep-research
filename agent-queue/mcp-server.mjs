#!/usr/bin/env node
/**
 * agent-queue MCP Server
 *
 * Tools:
 * - queue_publish    — publish a message to a topic
 * - queue_subscribe  — subscribe to a topic pattern
 * - queue_ack        — acknowledge a message
 * - queue_nack       — negative-acknowledge a message
 * - queue_request    — request-reply pattern
 * - queue_messages   — query messages for a topic
 * - queue_topics     — list all topics with stats
 * - queue_subscribers — list all subscribers
 * - queue_dead_letter — view dead letter queue
 * - queue_purge      — purge topic or all messages
 * - queue_snapshot   — force a persistence snapshot
 * - queue_stats      — queue statistics
 */

import { AgentQueue } from './index.mjs';
import { join } from 'path';

const dataDir = process.env.QUEUE_DATA_DIR || join(process.env.HOME || '/tmp', '.agent-queue');
const queue = new AgentQueue({ dataDir });

// ─── Tool definitions ────────────────────────────────────────────

const TOOLS = [
  {
    name: 'queue_publish',
    description: 'Publish a message to a topic. Supports priority, TTL, headers, request-reply.',
    inputSchema: {
      type: 'object',
      required: ['topic', 'payload'],
      properties: {
        topic: { type: 'string', description: 'Topic to publish to (e.g. "events.click")' },
        payload: { description: 'Message payload (any JSON-serializable value)' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
        ttl: { type: 'number', description: 'TTL in ms (0 = no expiry)', default: 0 },
        headers: { type: 'object', description: 'Optional message headers' },
        correlationId: { type: 'string', description: 'For request-reply correlation' },
        replyTo: { type: 'string', description: 'Reply topic for request-reply' }
      }
    }
  },
  {
    name: 'queue_subscribe',
    description: 'Subscribe to a topic pattern. Returns a subscription ID. Use queue_ack/nack for delivery.',
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Topic pattern (supports * and ** wildcards)' },
        id: { type: 'string', description: 'Optional subscription ID' },
        group: { type: 'string', description: 'Consumer group name for round-robin' },
        maxInflight: { type: 'number', default: 10 }
      }
    }
  },
  {
    name: 'queue_ack',
    description: 'Acknowledge a delivered message.',
    inputSchema: {
      type: 'object',
      required: ['subscriptionId', 'messageId'],
      properties: {
        subscriptionId: { type: 'string' },
        messageId: { type: 'string' }
      }
    }
  },
  {
    name: 'queue_nack',
    description: 'Negative-acknowledge a message. Optionally requeue or send to dead letter.',
    inputSchema: {
      type: 'object',
      required: ['subscriptionId', 'messageId'],
      properties: {
        subscriptionId: { type: 'string' },
        messageId: { type: 'string' },
        requeue: { type: 'boolean', default: true },
        reason: { type: 'string' }
      }
    }
  },
  {
    name: 'queue_request',
    description: 'Send a request and wait for reply (request-reply pattern).',
    inputSchema: {
      type: 'object',
      required: ['topic', 'payload'],
      properties: {
        topic: { type: 'string' },
        payload: {},
        timeout: { type: 'number', default: 10000 },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] }
      }
    }
  },
  {
    name: 'queue_messages',
    description: 'Query messages for a topic.',
    inputSchema: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string' },
        since: { type: 'number', description: 'Timestamp filter (ms)' },
        limit: { type: 'number', default: 100 },
        includeAcked: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'queue_topics',
    description: 'List all topics with pending/total message counts.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'queue_subscribers',
    description: 'List all active subscriptions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'queue_dead_letter',
    description: 'View dead letter queue entries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
        replay: { type: 'string', description: 'Message ID to replay from dead letter' }
      }
    }
  },
  {
    name: 'queue_purge',
    description: 'Purge messages from a topic or all topics.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic to purge (omit for all)' }
      }
    }
  },
  {
    name: 'queue_snapshot',
    description: 'Force a persistence snapshot.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'queue_stats',
    description: 'Get queue statistics.',
    inputSchema: { type: 'object', properties: {} }
  }
];

// ─── MCP protocol ────────────────────────────────────────────────

function respond(id, result) {
  const resp = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

function error(id, code, message) {
  const resp = { jsonrpc: '2.0', id, error: { code, message } };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

async function handleRequest(req) {
  const { method, id, params } = req;

  if (method === 'initialize') {
    return respond(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-queue', version: '1.0.0' }, capabilities: { tools: {} } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'ping') return respond(id, {});
  if (method === 'tools/list') return respond(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await callTool(name, args || {});
      return respond(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return error(id, -32000, e.message);
    }
  }

  error(id, -32601, `Unknown method: ${method}`);
}

async function callTool(name, args) {
  switch (name) {
    case 'queue_publish':
      return queue.publish(args.topic, args.payload, {
        priority: args.priority, ttl: args.ttl,
        headers: args.headers, correlationId: args.correlationId, replyTo: args.replyTo
      });

    case 'queue_subscribe': {
      const handler = (msg, { ack, nack }) => {
        // Store for MCP client to poll
        console.error(JSON.stringify({ type: 'notification', method: 'queue/message', params: { subscriptionId: subId, message: msg } }));
      };
      const subId = queue.subscribe(args.pattern, handler, { id: args.id, group: args.group, maxInflight: args.maxInflight });
      return { subscriptionId: subId, pattern: args.pattern };
    }

    case 'queue_ack':
      return { acked: queue.ack(args.subscriptionId, args.messageId) };

    case 'queue_nack':
      return { nacked: queue.nack(args.subscriptionId, args.messageId, { requeue: args.requeue, reason: args.reason }) };

    case 'queue_request':
      return await queue.request(args.topic, args.payload, { timeout: args.timeout, priority: args.priority });

    case 'queue_messages':
      return queue.getMessages(args.topic, { since: args.since, limit: args.limit, includeAcked: args.includeAcked });

    case 'queue_topics':
      return queue.getTopics();

    case 'queue_subscribers':
      return queue.getSubscribers();

    case 'queue_dead_letter': {
      if (args.replay) return queue.replayDeadLetter(args.replay);
      return queue.getDeadLetter({ limit: args.limit });
    }

    case 'queue_purge':
      return { purged: queue.purge(args.topic) };

    case 'queue_snapshot':
      queue.snapshot();
      return { snapshot: true };

    case 'queue_stats':
      return { stats: queue.stats, messages: queue.messages.size, topics: queue.topics.size, subscribers: queue.subscribers.size, deadLetter: queue.deadLetter.length };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── STDIO loop ──────────────────────────────────────────────────

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (line.trim()) {
      try { handleRequest(JSON.parse(line)); }
      catch (e) { console.error(`Parse error: ${e.message}`); }
    }
  }
});

process.stdin.resume();
console.error('[agent-queue] MCP server ready');
