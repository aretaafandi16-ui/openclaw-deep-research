# agent-notify

Zero-dependency multi-channel notification dispatcher for AI agents. Route alerts to Telegram, Discord, Slack, webhooks, files, and console with priority-based routing, deduplication, rate limiting, batching, quiet hours, and templates.

## Features

- **6 channel types**: Console, File (JSONL), HTTP/Webhook, Telegram, Discord, Slack
- **Priority levels**: LOW / NORMAL / HIGH / CRITICAL with per-channel filters
- **Routing rules**: Match by tag, priority, or custom function → route to specific channels
- **Templates**: `{{variable}}` interpolation for reusable notification formats
- **Deduplication**: Auto-blocks duplicate notifications within configurable window (default 5min)
- **Rate limiting**: Per-channel sliding window (default 30/min)
- **Quiet hours**: Suppress non-critical notifications during set hours, batch for later
- **Batching**: Queue notifications and send as summary
- **Retry**: Exponential backoff retry on channel failures
- **JSONL persistence**: Optional file logging of all notifications
- **HTTP dashboard**: Dark-theme web UI at port 3108
- **MCP server**: 10 tools for AI agent integration
- **CLI**: Full command-line interface
- **EventEmitter**: Real-time events for sent/blocked/error

## Quick Start

```js
import { AgentNotify, Priority } from './index.mjs';

const notify = new AgentNotify();

// Add channels
notify.addChannel('console', 'console');
notify.addChannel('alerts', 'telegram', {
  botToken: process.env.TG_TOKEN,
  chatId: process.env.TG_CHAT_ID,
});

// Add routing: only high+ to Telegram
notify.addRule({
  match: n => n.priority >= Priority.HIGH,
  channels: ['alerts'],
});

// Send notifications
await notify.info('User logged in');
await notify.warn('High memory usage', { title: 'System Alert', tag: 'memory' });
await notify.error('Database connection failed', { title: 'CRITICAL', tag: 'db' });

// With template
notify.addTemplate('error', '🚨 Error in {{service}}: {{message}}');
await notify.send({
  template: 'error',
  data: { service: 'auth', message: 'Token expired' },
  priority: Priority.HIGH,
});
```

## Channels

| Type | Config | Description |
|------|--------|-------------|
| `console` | — | Colored terminal output |
| `file` | `{ path }` | JSONL file append |
| `http` / `webhook` | `{ url, method?, headers? }` | POST JSON to any URL |
| `telegram` | `{ botToken, chatId }` | Telegram Bot API |
| `discord` | `{ webhookUrl }` | Discord webhook embed |
| `slack` | `{ webhookUrl }` | Slack Block Kit message |

### Custom Channel

```js
notify.addChannel('my-channel', {
  name: 'custom',
  send: async (notif) => {
    // Your logic here
    return { ok: true, channel: 'custom' };
  },
});
```

## Routing Rules

```js
notify.addRule({
  match: (notif) => notif.tag === 'security' && notif.priority >= 2,
  channels: ['telegram', 'email'],
});
```

If no rules match, notifications go to **all** channels.

## Priority Filtering

```js
notify.addChannel('pager', 'telegram', {
  botToken: '...',
  chatId: '...',
  priority: 2,  // Only HIGH and CRITICAL
});
```

## Deduplication

Automatically blocks duplicate notifications (same title + body + tag) within the dedup window.

```js
const notify = new AgentNotify({ dedupWindowMs: 300000 }); // 5 min default

// Override per-notification
await notify.send({ body: 'alert', dedup: false });
```

## Rate Limiting

Sliding window per channel. Default: 30 notifications per 60 seconds.

```js
const notify = new AgentNotify({
  rateLimitMax: 10,
  rateLimitWindowMs: 60000,
});
```

## Quiet Hours

Suppress non-critical notifications during quiet hours. CRITICAL always goes through.

```js
notify.setQuietHours(22, 8); // 10 PM to 8 AM
```

Blocked notifications are batched and sent as a summary.

## Templates

```js
notify.addTemplate('deploy', '🚀 {{service}} deployed to {{env}} v{{version}}');
await notify.send({
  template: 'deploy',
  data: { service: 'api', env: 'prod', version: '2.1.0' },
});
```

## HTTP API

```
POST /api/send        — Send notification { title, body, priority, tag }
GET  /api/channels    — List channels
POST /api/channels    — Add channel { name, type, config }
DELETE /api/channels/:name — Remove channel
GET  /api/stats       — Get stats
POST /api/templates   — Add template { name, template }
POST /api/rules       — Add rule { matchTag, matchMinPriority, channels }
POST /api/quiet-hours — Set quiet hours { start, end }
GET  /health          — Health check
GET  /                — Web dashboard
```

## MCP Server

10 tools for AI agent integration:

| Tool | Description |
|------|-------------|
| `notify_send` | Send a notification |
| `notify_channel_add` | Add a channel |
| `notify_channel_remove` | Remove a channel |
| `notify_channel_enable` | Enable a channel |
| `notify_channel_disable` | Disable a channel |
| `notify_channels_list` | List all channels |
| `notify_template_add` | Add a template |
| `notify_stats` | Get stats |
| `notify_rule_add` | Add routing rule |
| `notify_quiet_hours` | Set quiet hours |

```bash
node mcp-server.mjs  # stdio JSON-RPC
```

## CLI

```bash
# Send
node cli.mjs send "Server is down" --title "Alert" --priority critical --tag server

# Channels
node cli.mjs channels
node cli.mjs channel add tg telegram --token BOT_TOKEN --chat-id CHAT_ID
node cli.mjs channel remove tg

# Templates
node cli.mjs template add deploy "Deployed {{service}} to {{env}}"

# Rules
node cli.mjs rule add --match-tag security --min-priority high --channels tg,email

# Quiet hours
node cli.mjs quiet-hours 22 8

# Stats
node cli.mjs stats

# Server
node cli.mjs serve

# Demo
node cli.mjs demo
```

## Events

```js
notify.on('sent', (notif, results) => { /* sent to channels */ });
notify.on('dedup:blocked', (notif) => { /* duplicate blocked */ });
notify.on('quiet:blocked', (notif) => { /* quiet hours blocked */ });
notify.on('ratelimited', (channel, notif) => { /* rate limited */ });
notify.on('channel:error', (channel, err, notif) => { /* channel error */ });
notify.on('channel:sent', (channel, notif) => { /* single channel sent */ });
```

## Stats

```js
const stats = notify.stats();
// { sent, failed, deduped, rateLimited, quietBlocked, batched }
```

## License

MIT
