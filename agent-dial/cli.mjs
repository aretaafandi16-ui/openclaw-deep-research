#!/usr/bin/env node
// agent-dial — CLI
import { DialogEngine } from './index.mjs';

const [,, cmd, ...args] = process.argv;

const HELP = `
agent-dial v1.0 — Dialog & conversation state machine for AI agents

COMMANDS:
  create-flow <flowId> <json>     Define a dialog flow from JSON
  start <flowId> [sessionId]      Start a new session
  send <sessionId> <message>      Send a message to session
  context <sessionId>             Get session context
  history <sessionId> [limit]     Get conversation history
  set-slot <sessionId> <name> <value>  Set a slot value
  end <sessionId>                 End a session
  list [active]                   List sessions (optionally active only)
  intent <json>                   Add global intent pattern
  stats                           Engine statistics
  demo                            Run interactive demo
  serve [port]                    Start HTTP server
  mcp                             Start MCP server (stdio)
  help                            Show this help
`;

function parseJsonArg(str) {
  try { return JSON.parse(str); } catch { return str; }
}

async function main() {
  if (!cmd || cmd === 'help') { console.log(HELP); return; }

  const engine = new DialogEngine();

  if (cmd === 'demo') {
    // Interactive demo
    engine.defineFlow('demo', {
      name: 'Demo',
      startNode: 'greet',
      nodes: {
        greet: { type: 'intent_router', content: "I didn't understand. Try: register, help, or info.", intents: [
          { intent: 'register', keywords: ['register', 'signup'], goto: 'reg_name' },
          { intent: 'help', keywords: ['help', 'support'], goto: 'help_flow' },
          { intent: 'info', keywords: ['info', 'about'], goto: 'info_flow' },
        ]},
        reg_name: { type: 'slot_fill', slots: [{ name: 'name', prompt: 'Your name?' }], transitions: [{ when: { slotFilled: 'name' }, goto: 'reg_email' }] },
        reg_email: { type: 'slot_fill', slots: [{ name: 'email', prompt: 'Your email?', validate: [['pattern', '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$']] }], transitions: [{ when: { slotFilled: 'email' }, goto: 'reg_done' }] },
        reg_done: { type: 'action', action: (ctx) => ({ response: `✅ Registered! ${ctx.slots.name} <${ctx.slots.email}>` }), transitions: [{ goto: 'end' }] },
        help_flow: { type: 'message', content: '📧 Support: describe your issue and we will create a ticket.', transitions: [{ goto: 'help_issue' }] },
        help_issue: { type: 'slot_fill', slots: [{ name: 'issue', prompt: 'Describe your issue:' }], transitions: [{ when: { slotFilled: 'issue' }, goto: 'help_done' }] },
        help_done: { type: 'action', action: (ctx) => ({ response: `🎫 Ticket #${Math.floor(Math.random()*9000+1000)}: "${ctx.slots.issue}"` }), transitions: [{ goto: 'end' }] },
        info_flow: { type: 'message', content: 'ℹ️ agent-dial v1.0 — Build multi-turn AI conversations with slot filling, intent routing, and branching.', transitions: [{ goto: 'end' }] },
        end: { type: 'end', content: '👋 Goodbye! Restart to chat again.' },
      },
    });

    const session = engine.createSession('demo');
    console.log('\n🐋 agent-dial demo — type your messages (Ctrl+C to quit)\n');

    // Process initial message to get greeting
    const initial = await engine.processMessage(session.id, 'start');
    console.log(`🤖 ${initial.response}\n`);

    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '👤 ' });
    rl.prompt();
    rl.on('line', async (line) => {
      const result = await engine.processMessage(session.id, line.trim());
      console.log(`🤖 ${result.response}`);
      if (result.ended) { console.log('\n[Session ended]'); rl.close(); return; }
      rl.prompt();
    });
    return;
  }

  if (cmd === 'serve') {
    await import('./server.mjs');
    return;
  }

  if (cmd === 'mcp') {
    await import('./mcp-server.mjs');
    return;
  }

  // One-shot commands
  switch (cmd) {
    case 'create-flow': {
      const [flowId, json] = args;
      if (!flowId || !json) { console.error('Usage: create-flow <flowId> <json>'); process.exit(1); }
      engine.defineFlow(flowId, JSON.parse(json));
      console.log(JSON.stringify({ ok: true, flowId }));
      break;
    }
    case 'start': {
      const [flowId, sessionId] = args;
      if (!flowId) { console.error('Usage: start <flowId> [sessionId]'); process.exit(1); }
      engine.defineFlow('default', { startNode: 'start', nodes: { start: { type: 'message', content: 'Session started.' } } });
      const s = engine.createSession(flowId || 'default', sessionId);
      console.log(JSON.stringify({ sessionId: s.id, flowId: s.flowId, currentNode: s.currentNode }));
      break;
    }
    case 'send': {
      const [sessionId, ...msgParts] = args;
      if (!sessionId) { console.error('Usage: send <sessionId> <message>'); process.exit(1); }
      const result = await engine.processMessage(sessionId, msgParts.join(' '));
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'context': {
      const [sessionId] = args;
      if (!sessionId) { console.error('Usage: context <sessionId>'); process.exit(1); }
      console.log(JSON.stringify(engine.getSessionContext(sessionId), null, 2));
      break;
    }
    case 'history': {
      const [sessionId, limit] = args;
      if (!sessionId) { console.error('Usage: history <sessionId> [limit]'); process.exit(1); }
      console.log(JSON.stringify(engine.getConversationHistory(sessionId, parseInt(limit) || 20), null, 2));
      break;
    }
    case 'set-slot': {
      const [sessionId, slotName, ...valParts] = args;
      if (!sessionId || !slotName) { console.error('Usage: set-slot <sessionId> <name> <value>'); process.exit(1); }
      console.log(JSON.stringify(engine.setSlotValue(sessionId, slotName, valParts.join(' '))));
      break;
    }
    case 'end': {
      const [sessionId] = args;
      if (!sessionId) { console.error('Usage: end <sessionId>'); process.exit(1); }
      console.log(JSON.stringify({ ended: engine.endSession(sessionId) }));
      break;
    }
    case 'list': {
      const activeOnly = args[0] === 'active';
      const sessions = [...engine.sessions.values()];
      const filtered = activeOnly ? sessions.filter(s => s.active) : sessions;
      console.log(JSON.stringify(filtered.map(s => ({ id: s.id, flowId: s.flowId, active: s.active, turns: s.turns.length })), null, 2));
      break;
    }
    case 'intent': {
      const [json] = args;
      if (!json) { console.error('Usage: intent <json>'); process.exit(1); }
      engine.addGlobalIntent(JSON.parse(json));
      console.log(JSON.stringify({ ok: true }));
      break;
    }
    case 'stats': {
      console.log(JSON.stringify(engine.stats(), null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}\n${HELP}`);
      process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
