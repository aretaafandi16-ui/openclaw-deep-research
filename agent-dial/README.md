# agent-dial 🐋

Zero-dependency dialog & conversation state machine for AI agents. Build multi-turn conversations with slot filling, intent routing, conditional branching, and context persistence.

## Features

- **Multi-turn conversations** — stateful dialog flows with node-based architecture
- **Slot filling** — collect required information with validation, transforms, and reprompts
- **Intent routing** — match user input to intents via keywords, regex, exact, contains, or custom functions
- **Conditional branching** — route based on slot values, session state, input patterns, or custom logic
- **6 node types** — message, slot_fill, branch, intent_router, action, end
- **Session management** — create, track, evict sessions with configurable limits
- **Conversation history** — full turn-by-turn logging with metadata
- **Custom parsers** — extract slot values from natural language input
- **Dynamic content** — node content can be functions that compute responses from session context
- **Event system** — EventEmitter for session/flow/intent/slot/message events
- **JSONL persistence** — event logging + snapshot saves for restart survival
- **HTTP server** — dark-theme web dashboard with real-time conversation monitoring
- **MCP server** — 10 tools for integration with AI agent frameworks
- **CLI** — interactive demo, one-shot commands, and server starters

## Quick Start

```javascript
import { DialogEngine } from './index.mjs';

const engine = new DialogEngine();

// Define a dialog flow
engine.defineFlow('support', {
  name: 'Support Bot',
  startNode: 'greet',
  nodes: {
    greet: {
      type: 'intent_router',
      content: "How can I help? (billing, technical, general)",
      intents: [
        { intent: 'billing', keywords: ['bill', 'charge', 'payment'], goto: 'billing' },
        { intent: 'tech', keywords: ['bug', 'error', 'crash', 'broken'], goto: 'tech' },
        { intent: 'general', keywords: ['info', 'help', 'question'], goto: 'general' },
      ],
    },
    billing: {
      type: 'slot_fill',
      slots: [
        { name: 'accountId', prompt: 'What is your account ID?', required: true },
        { name: 'issue', prompt: 'Describe the billing issue:', required: true },
      ],
      transitions: [{ when: { slotFilled: 'issue' }, goto: 'billing_done' }],
    },
    billing_done: {
      type: 'action',
      action: (ctx) => ({
        response: `Billing ticket created for account ${ctx.slots.accountId}: "${ctx.slots.issue}"`,
      }),
      transitions: [{ goto: 'end' }],
    },
    tech: {
      type: 'slot_fill',
      slots: [
        { name: 'description', prompt: 'Describe the technical issue:' },
      ],
      transitions: [{ when: { slotFilled: 'description' }, goto: 'tech_done' }],
    },
    tech_done: {
      type: 'action',
      action: (ctx) => ({ response: `Tech ticket: "${ctx.slots.description}" — escalated!` }),
      transitions: [{ goto: 'end' }],
    },
    general: {
      type: 'message',
      content: 'We offer 24/7 support. Visit docs.example.com for self-service.',
      transitions: [{ goto: 'end' }],
    },
    end: { type: 'end', content: 'Thanks for contacting us! 👋' },
  },
});

// Start a session and chat
const session = engine.createSession('support');
const r1 = await engine.processMessage(session.id, 'I have a billing issue');
console.log(r1.response); // "What is your account ID?"

const r2 = await engine.processMessage(session.id, 'ACC-12345');
console.log(r2.response); // "Describe the billing issue:"

const r3 = await engine.processMessage(session.id, 'Wrong charge on my last invoice');
console.log(r3.response); // "Billing ticket created for account ACC-12345: ..."
```

## Node Types

| Type | Description |
|------|-------------|
| `message` | Display content, optionally auto-advance to next node |
| `slot_fill` | Collect user input into typed/validated slots |
| `branch` | Conditional routing based on state/slot/input conditions |
| `intent_router` | Match user input to intents, route to appropriate node |
| `action` | Execute custom logic, update state, produce dynamic responses |
| `end` | Terminate the conversation session |

## Slot Configuration

```javascript
{
  name: 'email',
  type: 'string',          // string|number|integer|boolean|email|phone|url
  prompt: 'Your email?',
  reprompt: 'Invalid email. Try again.',
  default: null,
  required: true,
  transform: 'lowercase',  // lowercase|uppercase|trim|number|boolean|integer|custom fn
  validate: [
    ['email'],
    ['min', 5],
    ['max', 100],
    ['pattern', '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'],
    ['enum', ['a@b.com', 'c@d.com']],
    ['range', 1, 100],
  ],
  parser: (input, session) => (input.match(/[\w.]+@[\w.]+/) || [null])[0],
  maxAttempts: 5,
}
```

## Intent Patterns

```javascript
// Keywords — any keyword matches
{ intent: 'buy', keywords: ['buy', 'purchase', 'order'] }

// Exact match
{ intent: 'yes', exact: 'yes' }

// Contains substring
{ intent: 'pricing', contains: 'price' }

// Regex
{ intent: 'order', regex: 'order\\s*#?\\d+' }

// Starts with
{ intent: 'greet', startsWith: 'hello' }

// Custom function
{ intent: 'complex', fn: (text) => text.length > 10 && text.includes('special') }
```

## Condition Types (for transitions)

```javascript
{ when: { slotFilled: 'email' } }           // slot has been filled
{ when: { slotEquals: ['role', 'admin'] } }  // slot value equals
{ when: { stateEquals: ['step', 2] } }       // session state value
{ when: { inputContains: 'help' } }          // user input contains
{ when: { inputRegex: '^yes' } }             // user input matches regex
{ when: { intent: 'buy' } }                  // matched intent
{ when: { always: true } }                   // unconditional
{ when: (session, input) => customLogic() }  // custom function
```

## CLI

```bash
# Interactive demo
node cli.mjs demo

# One-shot commands
node cli.mjs start <flowId> [sessionId]
node cli.mjs send <sessionId> <message>
node cli.mjs context <sessionId>
node cli.mjs history <sessionId> [limit]
node cli.mjs set-slot <sessionId> <name> <value>
node cli.mjs end <sessionId>
node cli.mjs list [active]
node cli.mjs stats

# Servers
node cli.mjs serve [port]  # HTTP dashboard on :3128
node cli.mjs mcp           # MCP server (stdio)
```

## HTTP API

```
GET  /api/flows           — List registered flows
POST /api/flows           — Define a new flow
GET  /api/sessions        — List sessions (?active=true)
POST /api/sessions        — Start a session {flowId, sessionId?, state?}
POST /api/send            — Send message {sessionId, message}
GET  /api/session/:id     — Get session context
GET  /api/history/:id     — Get conversation history
POST /api/slot            — Set slot value {sessionId, slotName, value}
DELETE /api/session/:id   — End session
GET  /api/stats           — Engine statistics
POST /api/intent          — Add global intent {pattern}
GET  /dashboard           — Web UI
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `dial_create_flow` | Define a dialog flow |
| `dial_start_session` | Start a new session |
| `dial_send_message` | Send message, get response |
| `dial_get_context` | Get session context |
| `dial_get_history` | Get conversation history |
| `dial_set_slot` | Manually set a slot value |
| `dial_end_session` | End a session |
| `dial_list_sessions` | List sessions |
| `dial_add_intent` | Add global intent |
| `dial_stats` | Engine statistics |

## Events

```javascript
engine.on('session:created', (sessionId, flowId) => {});
engine.on('session:ended', (sessionId) => {});
engine.on('session:completed', (sessionId, slotValues) => {});
engine.on('message:received', (sessionId, input) => {});
engine.on('message:processed', (sessionId, result) => {});
engine.on('intent:matched', (sessionId, intent, pattern) => {});
engine.on('slot:filled', (sessionId, slotName, value) => {});
engine.on('flow:defined', (flowId) => {});
engine.on('session:evicted', (sessionId) => {});
```

## License

MIT
