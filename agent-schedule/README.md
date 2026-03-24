# agent-schedule 🐋

Zero-dependency time-based scheduler for AI agents. Cron expressions, timezone support, missed-run recovery, overlap prevention, deduplication.

## Features

- **Cron parser** — full 5-field cron expressions (minute, hour, day, month, weekday) with ranges, steps, and lists
- **Timezone support** — schedule in any timezone with offset-based matching
- **Missed-run recovery** — detects and reports jobs that couldn't run
- **Overlap prevention** — configurable `maxOverlap` prevents concurrent runs
- **Retry with backoff** — exponential retry on handler failure
- **Timeout enforcement** — kill long-running handlers
- **Event-driven** — emits `job:start`, `job:success`, `job:failure`, `job:skipped`, `job:missed`
- **Persistence** — JSON + JSONL persistence survives restarts
- **HTTP dashboard** — dark-theme web UI with real-time stats
- **MCP server** — 10 tools via Model Context Protocol
- **Full CLI** — schedule, list, trigger, disable, upcoming, history

## Quick Start

```js
import { AgentSchedule } from './index.mjs';

const sched = new AgentSchedule();

sched.onJob('default', async (ctx) => {
  console.log(`Job ${ctx.name} fired!`, ctx.payload);
});

sched.schedule({ cron: '*/5 * * * *', name: 'check-emails' });
sched.schedule({ cron: '0 9 * * 1-5', name: 'morning-briefing', tags: ['daily'] });

sched.start(); // Begin ticking
```

## HTTP Server

```bash
node server.mjs --port 3107
# Dashboard: http://localhost:3107
# API: /api/jobs, /api/stats, /api/upcoming, /api/history
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List all jobs |
| POST | `/api/jobs` | Create job `{cron, name, handlerName, tags, ...}` |
| GET | `/api/jobs/:id` | Get job details |
| DELETE | `/api/jobs/:id` | Remove job |
| POST | `/api/jobs/:id/trigger` | Manual trigger |
| POST | `/api/jobs/:id/enable` | Enable job |
| POST | `/api/jobs/:id/disable` | Disable job |
| GET | `/api/upcoming?minutes=60` | Upcoming jobs |
| GET | `/api/history?limit=50` | Run history |
| GET | `/api/stats` | Scheduler statistics |
| GET | `/health` | Health check |

## MCP Server

```bash
node mcp-server.mjs
# Tools: schedule, unschedule, enable, disable, get, list, trigger, upcoming, history, stats
```

## CLI

```bash
node cli.mjs schedule --cron "*/5 * * * *" --name "my-job" --tag "ops"
node cli.mjs list
node cli.mjs trigger <id>
node cli.mjs upcoming 120
node cli.mjs history --limit 20
node cli.mjs parse "0 9 * * 1-5"
node cli.mjs serve --port 3107
node cli.mjs demo
node cli.mjs mcp
```

## Cron Format

```
*    *    *    *    *
│    │    │    │    │
│    │    │    │    └── day of week (0-6, 0=Sun)
│    │    │    └─────── month (1-12)
│    │    └──────────── day of month (1-31)
│    └───────────────── hour (0-23)
└────────────────────── minute (0-59)
```

**Examples:**
- `*/5 * * * *` — Every 5 minutes
- `0 9 * * *` — Every day at 9:00 AM
- `0 */2 * * 1-5` — Every 2 hours, Mon-Fri
- `30 14 1 * *` — 1st of month at 2:30 PM
- `0 0 * * 0` — Every Sunday at midnight
- `0 9,17 * * *` — 9 AM and 5 PM daily

## Configuration

```js
const sched = new AgentSchedule({
  tickMs: 1000,              // Check interval (default 1s)
  persistenceDir: './data',  // Persist jobs to disk
  maxHistory: 1000,          // Max run history entries
});
```

## License

MIT
