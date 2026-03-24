#!/usr/bin/env node
// agent-fsm CLI

import { FSM, FSMRegistry, presets } from './index.mjs';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const cmd = args[0];

function help() {
  console.log(`
agent-fsm — Finite State Machine engine for AI agents

COMMANDS:
  create <preset|json>     Create machine from preset or JSON config
  send <id> <event>        Send event to machine
  get <id>                 Get machine state
  can <id> <event>         Check if event is available
  events <id>              List available events
  history <id>             Show transition history
  reset <id>               Reset machine to initial state
  list                     List all machines
  remove <id>              Remove a machine
  presets                  List available presets
  mermaid <id>             Export Mermaid diagram
  dot <id>                 Export Graphviz DOT diagram
  serve                    Start HTTP server (port 3124)
  mcp                      Start MCP server (stdio)
  demo                     Run interactive demo

PRESETS: ${Object.keys(presets).join(', ')}
`);
}

function demo() {
  console.log('\n🐋 agent-fsm demo\n');

  const reg = new FSMRegistry();

  // Order lifecycle
  console.log('📦 Order Lifecycle:');
  const order = reg.create({ ...presets.orderLifecycle, name: 'Order #1234' });
  order.start();
  const steps = ['confirm', 'pay', 'ship', 'deliver'];
  for (const step of steps) {
    const r = order.send(step);
    console.log(`  ${r.entry.from} → [${step}] → ${r.entry.to}`);
  }
  console.log(`  Done: ${order.done} | Transitions: ${order.transitionCount}\n`);

  // Conversation flow
  console.log('💬 Conversation Flow:');
  const conv = reg.create({ ...presets.conversation, name: 'Chat Session' });
  conv.start();
  const chatSteps = ['ask', 'clarify', 'provide', 'complete', 'followup', 'provide', 'complete', 'satisfied'];
  for (const step of chatSteps) {
    if (conv.done) break;
    const r = conv.send(step);
    if (r.ok) console.log(`  ${r.entry.from} → [${step}] → ${r.entry.to}`);
    else console.log(`  ❌ [${step}] rejected: ${r.reason}`);
  }
  console.log(`  Done: ${conv.done} | Transitions: ${conv.transitionCount}\n`);

  // Guard example
  console.log('🔒 Guard Example:');
  const auth = new FSM({ initial: 'locked', guards: { checkPin: (ctx) => ctx.context.pin === '1234' } });
  auth.addTransition({ from: 'locked', event: 'unlock', to: 'unlocked', guard: 'checkPin' });
  auth.start();
  console.log(`  State: ${auth.state}`);
  console.log(`  Can unlock (no pin): ${auth.can('unlock')}`);
  auth.set('pin', 'wrong');
  console.log(`  Can unlock (wrong pin): ${auth.can('unlock')}`);
  auth.set('pin', '1234');
  console.log(`  Can unlock (correct pin): ${auth.can('unlock')}`);
  auth.send('unlock');
  console.log(`  State: ${auth.state}\n`);

  // Mermaid diagram
  console.log('📊 Mermaid Diagram (Order Lifecycle):');
  console.log(order.toMermaid());
  console.log();

  // Stats
  console.log('📈 Registry Stats:', reg.stats());
  console.log();
}

// ── CLI Router ──
if (!cmd || cmd === 'help' || cmd === '--help') { help(); process.exit(0); }

if (cmd === 'demo') { demo(); process.exit(0); }

if (cmd === 'serve') {
  await import('./server.mjs');
} else if (cmd === 'mcp') {
  await import('./mcp-server.mjs');
} else if (cmd === 'create') {
  let config;
  const arg = args[1];
  if (presets[arg]) {
    config = { ...presets[arg], name: args[2] || presets[arg].name };
  } else if (arg) {
    try { config = JSON.parse(readFileSync(arg, 'utf8')); } catch { config = JSON.parse(arg); }
  } else {
    console.error('Usage: agent-fsm create <preset|json> [name]');
    process.exit(1);
  }
  const reg = new FSMRegistry();
  const fsm = reg.create(config);
  fsm.start();
  console.log(JSON.stringify({ id: fsm.id, name: fsm.name, state: fsm.state, available: fsm.availableEvents() }, null, 2));
} else if (cmd === 'presets') {
  for (const [k, v] of Object.entries(presets)) {
    console.log(`  ${k}: ${v.name} (${v.initial} → [${v.finalStates.join(', ')}], ${v.transitions.length} transitions)`);
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  help();
  process.exit(1);
}
