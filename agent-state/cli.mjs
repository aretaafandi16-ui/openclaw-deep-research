#!/usr/bin/env node
/**
 * agent-state CLI — manage state machines from the command line
 */

import { StateMachine, Guards, createWorkflow, createGameLoop } from './index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const cmd = args[0];

function usage() {
  console.log(`
agent-state — State machine engine for AI agents

USAGE
  agent-state <command> [options]

COMMANDS
  run <file.json>          Run a state machine from JSON config
  workflow <file.json>     Run a linear workflow from JSON steps
  demo                     Run a demo state machine (traffic light)
  test                     Run test suite
  serve [port]             Start HTTP dashboard (default 3112)
  mcp                      Start MCP server (stdio)
  help                     Show this help

EXAMPLES
  # Run from config file
  agent-state run machine.json

  # Demo traffic light
  agent-state demo

  # Start dashboard
  agent-state serve 3112

CONFIG FORMAT (machine.json)
  {
    "id": "my-machine",
    "initial": "idle",
    "context": {},
    "states": {
      "idle": {
        "on": { "START": { "target": "running" } }
      },
      "running": {
        "onEntry": "console.log('running!')",
        "on": { "STOP": { "target": "idle" } },
        "after": { "5000": "timeout" }
      },
      "timeout": { "type": "final" }
    }
  }
`);
}

// ─── Parse action strings ───────────────────────────────────────
function parseActions(states) {
  for (const [name, def] of Object.entries(states)) {
    if (typeof def.onEntry === 'string') {
      def.onEntry = new Function('ctx', def.onEntry);
    }
    if (typeof def.onExit === 'string') {
      def.onExit = new Function('ctx', def.onExit);
    }
    if (def.on) {
      for (const [evt, trans] of Object.entries(def.on)) {
        const arr = Array.isArray(trans) ? trans : [trans];
        for (const t of arr) {
          if (typeof t.action === 'string') {
            t.action = new Function('ctx', 'data', t.action);
          }
          if (typeof t.guard === 'string') {
            t.guard = new Function('ctx', 'data', `return (${t.guard})`);
          }
        }
        def.on[evt] = arr.length === 1 ? arr[0] : arr;
      }
    }
  }
  return states;
}

// ─── Commands ───────────────────────────────────────────────────

async function runMachine() {
  const file = args[1];
  if (!file) { console.error('Error: provide a JSON config file'); process.exit(1); }

  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config.states) config.states = parseActions(config.states);

  const sm = new StateMachine(config);
  sm.on('transition', (e) => console.log(`  ${e.from} → ${e.to} [${e.event}]`));
  sm.on('enter', (e) => console.log(`  → entered: ${e.state}`));
  sm.on('timeout', (e) => console.log(`  ⏱ timeout (${e.timeout}ms) → ${e.target}`));
  sm.on('done', (e) => { console.log(`  ✓ done at: ${e.state}`); process.exit(0); });
  sm.on('error', (e) => console.error(`  ✗ error:`, e));

  await sm.start();
  console.log(`  Machine "${sm.id}" started at: ${sm.state}`);
  console.log(`  Available events: ${sm.events.join(', ')}`);

  // Interactive mode: read events from stdin
  console.log('\n  Type an event name and press Enter. Ctrl+C to quit.\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (data) => {
    const event = data.trim();
    if (!event) return;
    if (event === '.state') { console.log(`  Current: ${sm.state}`); return; }
    if (event === '.context') { console.log(`  Context:`, JSON.stringify(sm.context, null, 2)); return; }
    if (event === '.can') { console.log(`  Can: ${sm.events.filter(e => sm.can(e)).join(', ')}`); return; }
    if (event === '.quit') { sm.stop(); process.exit(0); }
    const result = await sm.send(event);
    if (!result.changed) console.log(`  (no transition: ${result.reason})`);
  });
}

async function runWorkflow() {
  const file = args[1];
  if (!file) { console.error('Error: provide a JSON steps file'); process.exit(1); }

  const data = JSON.parse(readFileSync(file, 'utf8'));
  const steps = data.steps || data;
  if (!Array.isArray(steps)) { console.error('Error: steps must be an array'); process.exit(1); }

  // Parse action strings
  for (const step of steps) {
    if (typeof step.action === 'string') {
      step.action = new Function('ctx', step.action);
    }
  }

  const wf = createWorkflow(data.id || 'workflow', steps, { context: data.context || {} });
  wf.on('transition', (e) => console.log(`  [${e.from}] → [${e.to}]`));
  wf.on('done', () => { console.log('  ✓ Workflow complete'); process.exit(0); });

  await wf.start();
  console.log(`  Workflow started at: ${wf.state}`);
  console.log('  Type NEXT, SKIP, or FAIL. Ctrl+C to quit.\n');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (data) => {
    const event = data.trim().toUpperCase();
    if (!event) return;
    const result = await sm.send(event);
    if (!result.changed) console.log(`  (no transition: ${result.reason})`);
  });
}

async function runDemo() {
  console.log('\n  🚦 Traffic Light Demo\n');

  const sm = new StateMachine({
    id: 'traffic-light',
    initial: 'red',
    context: { cycles: 0 },
    states: {
      red: {
        onEntry: (ctx) => { ctx.cycles++; },
        on: { TIMER: { target: 'green' } },
        after: { 3000: 'green' },
        meta: { color: '🔴', label: 'Stop' },
      },
      yellow: {
        on: { TIMER: { target: 'red' } },
        after: { 1000: 'red' },
        meta: { color: '🟡', label: 'Caution' },
      },
      green: {
        on: { TIMER: { target: 'yellow' } },
        after: { 3000: 'yellow' },
        meta: { color: '🟢', label: 'Go' },
      },
    },
  });

  sm.on('enter', (e) => {
    const state = sm.states.get(e.state);
    const meta = state?.meta || {};
    console.log(`  ${meta.color || '?'} ${e.state.toUpperCase()} — ${meta.label || ''} (cycle #${sm.context.cycles})`);
  });

  sm.on('timeout', (e) => {
    console.log(`  ⏱ auto-transition after ${e.timeout}ms`);
  });

  await sm.start();

  console.log('\n  Press Enter to manually trigger TIMER, Ctrl+C to quit.\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async () => {
    await sm.send('TIMER');
  });
}

async function runServe() {
  const { default: server } = await import('./server.mjs');
}

async function runMcp() {
  const { default: server } = await import('./mcp-server.mjs');
}

// ─── Main ───────────────────────────────────────────────────────
switch (cmd) {
  case 'run': await runMachine(); break;
  case 'workflow': await runWorkflow(); break;
  case 'demo': await runDemo(); break;
  case 'serve': await runServe(); break;
  case 'mcp': await runMcp(); break;
  case 'test':
    const { execSync } = await import('child_process');
    execSync('node test.mjs', { stdio: 'inherit', cwd: new URL('.', import.meta.url).pathname });
    break;
  case 'help': case '--help': case '-h': default:
    usage();
    break;
}
