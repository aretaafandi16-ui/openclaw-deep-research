#!/usr/bin/env node
/**
 * agent-clock MCP Server — 12 tools for temporal reasoning
 */
import { readFileSync } from 'fs';
import { AgentClock, parseDuration, formatDuration, parseNaturalTime, parseSchedule, nextOccurrence } from './index.mjs';

const clock = new AgentClock({
  calendars: ['us'],
  persistencePath: process.env.AGENT_CLOCK_PERSIST || '.agent-clock-state.json',
  logPath: process.env.AGENT_CLOCK_LOG || '.agent-clock-log.jsonl',
});

// JSON-RPC stdio
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.substring(0, idx).trim();
    buffer = buffer.substring(idx + 1);
    if (line) handleMessage(line);
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function error(id, msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1, message: msg } }) + '\n');
}

const TOOLS = {
  clock_now: {
    desc: 'Get current time',
    fn: (args) => ({
      utc: new Date().toISOString(),
      local: clock.nowIn(args.timezone || 'UTC'),
      timezone: args.timezone || 'UTC',
    }),
  },
  clock_parse: {
    desc: 'Parse natural language time expression',
    fn: (args) => {
      const d = parseNaturalTime(args.expression, args.reference ? new Date(args.reference) : new Date());
      return { parsed: d.toISOString(), expression: args.expression };
    },
  },
  clock_add: {
    desc: 'Add duration to a date',
    fn: (args) => {
      const d = clock.add(args.date || new Date(), args.duration);
      return { result: d.toISOString(), date: args.date, duration: args.duration };
    },
  },
  clock_subtract: {
    desc: 'Subtract duration from a date',
    fn: (args) => {
      const d = clock.subtract(args.date || new Date(), args.duration);
      return { result: d.toISOString(), date: args.date, duration: args.duration };
    },
  },
  clock_business_day: {
    desc: 'Check/add business days',
    fn: (args) => {
      const date = args.date ? new Date(args.date) : new Date();
      if (args.add_days) {
        const r = clock.addBusinessDays(date, args.add_days);
        return { result: r.toISOString(), business_days_added: args.add_days };
      }
      return { date: date.toISOString(), is_business_day: clock.isBusinessDay(date) };
    },
  },
  clock_business_days_between: {
    desc: 'Count business days between two dates',
    fn: (args) => {
      const a = new Date(args.start);
      const b = new Date(args.end);
      return { business_days: clock.businessDaysBetween(a, b), start: args.start, end: args.end };
    },
  },
  clock_schedule: {
    desc: 'Create a recurring schedule',
    fn: (args) => {
      const parsed = parseSchedule(args.expression);
      const next = nextOccurrence(parsed, new Date());
      return { schedule: parsed, next_run: next.toISOString(), expression: args.expression };
    },
  },
  clock_next_occurrence: {
    desc: 'Get next occurrence of a schedule',
    fn: (args) => {
      const parsed = typeof args.schedule === 'string' ? parseSchedule(args.schedule) : args.schedule;
      const from = args.from ? new Date(args.from) : new Date();
      const next = nextOccurrence(parsed, from);
      return { next: next.toISOString(), from: from.toISOString() };
    },
  },
  clock_deadline: {
    desc: 'Track a deadline',
    fn: (args) => {
      const id = clock.addDeadline(args.name, args.due, {
        alertBefore: args.alert_before,
        businessDaysOnly: args.business_days_only,
      });
      const timeUntil = clock.timeUntilDeadline(id);
      return { id, ...timeUntil };
    },
  },
  clock_time_until: {
    desc: 'Get time remaining until a deadline',
    fn: (args) => clock.timeUntilDeadline(args.id),
  },
  clock_deadlines: {
    desc: 'List all deadlines',
    fn: () => ({ deadlines: clock.listDeadlines() }),
  },
  clock_stats: {
    desc: 'Get clock statistics',
    fn: () => clock.stats(),
  },
};

async function handleMessage(line) {
  try {
    const msg = JSON.parse(line);
    const tool = TOOLS[msg.method];
    if (!tool) {
      if (msg.method === 'initialize') {
        return respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-clock', version: '1.0.0' } });
      }
      if (msg.method === 'tools/list') {
        return respond(msg.id, {
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            name,
            description: t.desc,
            inputSchema: { type: 'object', properties: {} },
          })),
        });
      }
      if (msg.method === 'notifications/initialized') return;
      return error(msg.id, `Unknown method: ${msg.method}`);
    }
    
    const args = msg.params?.arguments || {};
    const result = await tool.fn(args);
    respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    error(null, err.message);
  }
}

// Keep alive
process.stdin.resume();
