# agent-diag 🩺

Zero-dependency diagnostic & health monitoring toolkit for AI agents.

## Features

- **Health Checks** — register, run, schedule checks with categories, tags, thresholds
- **System Diagnostics** — CPU, memory, disk, process metrics collector
- **Alert Engine** — threshold-based alerting with cooldowns and custom actions
- **Preset Checks** — HTTP endpoints, TCP ports, memory, disk, process alive, custom functions
- **HTTP Dashboard** — dark-theme web UI with real-time stats (port 3137)
- **MCP Server** — 10 tools via JSON-RPC stdio
- **CLI** — full command-line interface
- **Zero Dependencies** — pure Node.js 18+, no npm packages

## Quick Start

```bash
# CLI
node cli.mjs demo
node cli.mjs status
node cli.mjs system
node cli.mjs run-all https://api.example.com

# HTTP dashboard
node server.mjs
# → http://localhost:3137

# MCP server
node mcp-server.mjs
```

## API

```js
import { AgentDiag, presets, AlertEngine } from './index.mjs';

const diag = new AgentDiag();

// Register checks
diag.register(presets.memoryUsage(90));
diag.register(presets.httpEndpoint('https://api.example.com'));
diag.register(presets.tcpPort('localhost', 5432));
diag.register({
  name: 'custom-check',
  check: async () => ({ ok: true, message: 'All good' }),
  intervalMs: 10000,
});

// Run checks
const result = await diag.runCheck('memory:usage');
const allResults = await diag.runAll();

// Get status
const status = diag.getStatus();
console.log(status.overall); // 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

// System diagnostics
const sys = diag.collectSystem();
console.log(sys.memory.percent, sys.cpus.load1);

// Start periodic checking
diag.start();
diag.on('check:critical', result => console.error('CRITICAL:', result));
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `diag_register` | Register a health check |
| `diag_run` | Run a specific check |
| `diag_run_all` | Run all checks |
| `diag_run_category` | Run checks by category |
| `diag_status` | Get overall status |
| `diag_checks` | List all checks |
| `diag_history` | Get check history |
| `diag_system` | System diagnostics |
| `diag_remove` | Remove a check |
| `diag_start` | Start periodic checking |

## Alert Engine

```js
const alerts = new AlertEngine();

alerts.addRule({
  name: 'high-memory',
  condition: ctx => ctx.memoryPercent > 85,
  severity: 'warning',
  message: 'Memory above 85%',
  cooldownMs: 60000,
  action: alert => notifySlack(alert),
});

alerts.on('alert', a => console.warn(a));
alerts.evaluate({ memoryPercent: 92 }); // triggers if > 85%
```

## License

MIT
