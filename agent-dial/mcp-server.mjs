#!/usr/bin/env node
// agent-dial — MCP Server (JSON-RPC stdio)
import { DialogEngine } from './index.mjs';
import { createInterface } from 'node:readline';

const engine = new DialogEngine();
const FLOWS = new Map();

// ── Built-in demo flow ──────────────────────────────────────────────────────────
engine.defineFlow('demo', {
  name: 'Demo Flow',
  startNode: 'greet',
  nodes: {
    greet: { type: 'message', content: 'Hello! I can help you with: 1) Register  2) Support  3) Info. What do you need?', transitions: [{ goto: 'intent_router' }] },
    intent_router: {
      type: 'intent_router',
      content: "I didn't catch that. Please choose: register, support, or info.",
      intents: [
        { intent: 'register', keywords: ['register', 'sign up', 'create account'], goto: 'register_name' },
        { intent: 'support', keywords: ['support', 'help', 'issue', 'problem'], goto: 'support_topic' },
        { intent: 'info', keywords: ['info', 'about', 'what is'], goto: 'info' },
      ],
    },
    register_name: {
      type: 'slot_fill',
      slots: [
        { name: 'name', prompt: 'What is your name?', required: true },
      ],
      transitions: [{ when: { slotFilled: 'name' }, goto: 'register_email' }],
    },
    register_email: {
      type: 'slot_fill',
      slots: [
        { name: 'email', type: 'string', prompt: 'What is your email?', validate: [['pattern', '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$']], required: true },
      ],
      transitions: [{ when: { slotFilled: 'email' }, goto: 'register_confirm' }],
    },
    register_confirm: {
      type: 'action',
      action: (ctx) => ({ response: `Registered! Name: ${ctx.slots.name}, Email: ${ctx.slots.email}. Welcome aboard! 🎉` }),
      transitions: [{ goto: 'end' }],
    },
    support_topic: {
      type: 'slot_fill',
      slots: [
        { name: 'topic', prompt: 'Briefly describe your issue:', required: true },
      ],
      transitions: [{ when: { slotFilled: 'topic' }, goto: 'support_response' }],
    },
    support_response: {
      type: 'action',
      action: (ctx) => ({ response: `Got it: "${ctx.slots.topic}". Our team will look into it. Ticket #${Math.floor(Math.random()*9000+1000)} created.` }),
      transitions: [{ goto: 'end' }],
    },
    info: {
      type: 'message',
      content: 'agent-dial v1.0 — Zero-dep dialog state machine for AI agents. Supports multi-turn conversations, slot filling, intent routing, branching, and more!',
      transitions: [{ goto: 'end' }],
    },
    end: { type: 'end', content: 'Thanks for chatting! Type anything to start a new session.' },
  },
});

// ── MCP Tools ────────────────────────────────────────────────────────────────────
const TOOLS = {
  dial_create_flow: {
    description: 'Define a dialog flow with nodes, slots, intents, and transitions',
    inputSchema: { type: 'object', properties: { flowId: { type: 'string' }, definition: { type: 'object' } }, required: ['flowId', 'definition'] },
    handler: ({ flowId, definition }) => {
      engine.defineFlow(flowId, definition);
      return { ok: true, flowId, nodes: Object.keys(definition.nodes || {}).length };
    },
  },
  dial_start_session: {
    description: 'Start a new dialog session for a flow',
    inputSchema: { type: 'object', properties: { flowId: { type: 'string' }, sessionId: { type: 'string' }, state: { type: 'object' } }, required: ['flowId'] },
    handler: ({ flowId, sessionId, state }) => {
      const session = engine.createSession(flowId, sessionId, state || {});
      return { sessionId: session.id, flowId, currentNode: session.currentNode, active: session.active };
    },
  },
  dial_send_message: {
    description: 'Send a user message to a dialog session and get the response',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, message: { type: 'string' } }, required: ['sessionId', 'message'] },
    handler: async ({ sessionId, message }) => {
      return await engine.processMessage(sessionId, message);
    },
  },
  dial_get_context: {
    description: 'Get current session context (slots, state, node, etc.)',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
    handler: ({ sessionId }) => engine.getSessionContext(sessionId),
  },
  dial_get_history: {
    description: 'Get conversation history for a session',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, limit: { type: 'number' } }, required: ['sessionId'] },
    handler: ({ sessionId, limit }) => engine.getConversationHistory(sessionId, limit || 20),
  },
  dial_set_slot: {
    description: 'Manually set a slot value on a session',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, slotName: { type: 'string' }, value: {} }, required: ['sessionId', 'slotName', 'value'] },
    handler: ({ sessionId, slotName, value }) => engine.setSlotValue(sessionId, slotName, value),
  },
  dial_end_session: {
    description: 'End a dialog session',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
    handler: ({ sessionId }) => ({ ended: engine.endSession(sessionId) }),
  },
  dial_list_sessions: {
    description: 'List all sessions with optional active filter',
    inputSchema: { type: 'object', properties: { activeOnly: { type: 'boolean' } } },
    handler: ({ activeOnly }) => {
      const sessions = [...engine.sessions.values()];
      const filtered = activeOnly ? sessions.filter(s => s.active) : sessions;
      return filtered.map(s => ({ id: s.id, flowId: s.flowId, active: s.active, currentNode: s.currentNode, turns: s.turns.length, createdAt: s.createdAt }));
    },
  },
  dial_add_intent: {
    description: 'Add a global intent pattern',
    inputSchema: { type: 'object', properties: { pattern: { type: 'object' } }, required: ['pattern'] },
    handler: ({ pattern }) => {
      engine.addGlobalIntent(pattern);
      return { ok: true, totalGlobalIntents: engine.globalIntents.length };
    },
  },
  dial_stats: {
    description: 'Get engine statistics',
    inputSchema: { type: 'object', properties: {} },
    handler: () => engine.stats(),
  },
};

// ── JSON-RPC Handler ─────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function respond(id, result, error) {
  const resp = { jsonrpc: '2.0', id };
  if (error) resp.error = { code: -32000, message: String(error) };
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + '\n');
}

rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return respond(null, null, 'Invalid JSON'); }
  if (req.method === 'initialize') {
    return respond(req.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-dial', version: '1.0.0' } });
  }
  if (req.method === 'notifications/initialized') return;
  if (req.method === 'tools/list') {
    return respond(req.id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (req.method === 'tools/call') {
    const tool = TOOLS[req.params?.name];
    if (!tool) return respond(req.id, null, `Unknown tool: ${req.params?.name}`);
    try {
      const result = await tool.handler(req.params?.arguments || {});
      return respond(req.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (e) { return respond(req.id, null, e.message); }
  }
  respond(req?.id, null, `Unknown method: ${req?.method}`);
});

process.stderr.write('[agent-dial] MCP server ready\n');
