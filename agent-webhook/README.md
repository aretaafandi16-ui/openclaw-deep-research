# agent-webhook

Zero-dependency webhook dispatcher for AI agents. Receive inbound HTTP webhooks from GitHub, Stripe, Slack, Shopify, or any source — route, filter, transform, and deliver to agent handlers with retry, dedup, and signature verification.

## Features

- **HTTP webhook receiver** — POST endpoint for any webhook source
- **Source auto-detection** — GitHub, Stripe, Slack, Shopify, Discord, generic
- **Signature verification** — HMAC-SHA256 for GitHub/Shopify, Slack v0, Stripe header parsing
- **Powerful routing** — string paths, wildcards, regex, object patterns, function predicates
- **Payload transforms** — pick, rename, extract, flatten, add, template engine
- **Deduplication** — source-aware TTL-based dedup (GitHub delivery IDs, Stripe event IDs, etc.)
- **Retry queue** — exponential backoff, configurable max retries
- **Web dashboard** — real-time stats, handler list, source breakdown
- **MCP server** — 12 tools via Model Context Protocol
- **CLI** — serve, emit, gen-signature, demo, mcp
- **JSONL event logging** — persistent audit trail by date
- **Zero dependencies** — pure Node.js stdlib

## Quick Start

```js
import { WebhookDispatcher } from './index.mjs';

const wh = new WebhookDispatcher({ port: 3107 });

// React to GitHub push events
wh.on({ source: 'github', eventType: 'push' }, async (event) => {
  console.log(`Push to ${event.metadata.repo} by ${event.metadata.sender}`);
});

// React to Stripe payments
wh.on({ source: 'stripe', eventType: 'payment_intent.succeeded' }, async (event) => {
  console.log(`Payment: ${event.body.data.object.amount}`);
});

// Catch-all for any webhook
wh.on('/webhook/*', async (event) => {
  console.log(`${event.source}/${event.eventType} on ${event.path}`);
});

await wh.start();
console.log('Listening on :3107');
```

## Routing Patterns

```js
// Exact path
wh.on('/webhook', handler);

// Wildcard
wh.on('/api/*', handler);

// Regex
wh.on(/^\/hooks\/\d+$/, handler);

// Object pattern (match any fields)
wh.on({ source: 'github', eventType: 'push,pull_request' }, handler);
wh.on({ source: 'stripe', eventType: /^charge\./ }, handler);

// Function predicate
wh.on((e) => e.body?.amount > 1000, handler);
```

## Transforms

```js
wh.on('/webhook', handler, {
  transform: [
    { type: 'pick', fields: ['id', 'type', 'data'] },
    { type: 'rename', map: { data: 'payload' } },
    { type: 'extract', paths: ['data.object.amount', 'data.object.currency'] },
    { type: 'add', fields: { processed: true, ts: Date.now() } },
    { type: 'template', format: 'Event {{type}}: {{data.object.amount}}' },
    { type: 'flatten' },
  ]
});
```

## Signature Verification

```js
const wh = new WebhookDispatcher({
  port: 3107,
  secrets: {
    github: process.env.GITHUB_WEBHOOK_SECRET,
    stripe: process.env.STRIPE_WEBHOOK_SECRET,
    shopify: process.env.SHOPIFY_WEBHOOK_SECRET,
  }
});
// Invalid signatures → automatic 401 rejection
```

## CLI

```bash
# Start server
node cli.mjs serve --port 3107 --secret github:mysecret

# Emit test event
node cli.mjs emit --source github --event push --body '{"action":"opened"}'

# Generate HMAC signature
node cli.mjs gen-signature --secret mykey '{"data":"test"}'

# List supported sources
node cli.mjs sources

# Run demo
node cli.mjs demo

# Start MCP server
node cli.mjs mcp
```

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | Generic webhook receiver |
| `/webhook/*` | POST | Path-based routing |
| `/health` | GET | Health + stats |
| `/stats` | GET | Detailed statistics |
| `/handlers` | GET | Registered handlers |
| `/` | GET | Web dashboard |

## MCP Tools

| Tool | Description |
|------|-------------|
| `webhook_start` | Start the HTTP server |
| `webhook_stop` | Stop the server |
| `webhook_stats` | Get delivery statistics |
| `webhook_register` | Register a handler pattern |
| `webhook_unregister` | Remove a handler |
| `webhook_list` | List registered handlers |
| `webhook_emit` | Emit a test event |
| `webhook_sources` | List supported source presets |
| `webhook_set_secret` | Set signature secret for a source |
| `webhook_event_log` | Get recent events from log |
| `webhook_test_signature` | Test signature generation |
| `webhook_health` | Server health status |

## Source Presets

| Source | Signature Header | Event Type Source |
|--------|-----------------|-------------------|
| GitHub | `x-hub-signature-256` | `x-github-event` header |
| Stripe | `stripe-signature` | `type` in body |
| Slack | `x-slack-signature` | `event.type` in body |
| Shopify | `x-shopify-hmac-sha256` | `x-shopify-topic` header |
| Discord | `x-signature-ed25519` | `type` in body |
| Generic | — | `x-event-type` header or `event`/`type` in body |

## Event Object

```js
{
  id: 'uuid',
  source: 'github',
  path: '/webhook',
  method: 'POST',
  headers: { 'x-github-event': 'push', ... },
  body: { repository: {...}, commits: [...] },
  rawBody: '{"repository":...}',
  timestamp: 1711234567890,
  eventType: 'push',
  metadata: { repo: 'user/repo', sender: 'dev', action: 'opened' },
  ip: '1.2.3.4'
}
```

## Tests

```bash
node test.mjs
# 50 tests, all passing ✅
```

## License

MIT
