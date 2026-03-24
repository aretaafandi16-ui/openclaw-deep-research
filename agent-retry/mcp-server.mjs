#!/usr/bin/env node
// agent-retry/mcp-server.mjs — MCP server for agent-retry
import { createServer } from 'http';
import { CircuitBreaker, Bulkhead, RetryOrchestrator, HealthChecker, ExponentialBackoff, retry, withTimeout } from './index.mjs';

const breakers = new Map();
const bulkheads = new Map();
const orchestrators = new Map();
const healthChecker = new HealthChecker();

// ─── Tool Definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'retry_execute',
    description: 'Execute a function with retry logic, exponential backoff, and optional timeout',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Operation name for logging' },
        maxRetries: { type: 'number', default: 3 },
        initialMs: { type: 'number', default: 200 },
        maxMs: { type: 'number', default: 30000 },
        timeoutMs: { type: 'number', description: 'Per-attempt timeout' },
        command: { type: 'string', description: 'Shell command to execute (for demo)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'circuit_breaker_create',
    description: 'Create a named circuit breaker with configurable thresholds',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        failureThreshold: { type: 'number', default: 5 },
        resetTimeoutMs: { type: 'number', default: 30000 },
        halfOpenMaxAttempts: { type: 'number', default: 1 },
      },
      required: ['name'],
    },
  },
  {
    name: 'circuit_breaker_execute',
    description: 'Execute through a named circuit breaker',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        success: { type: 'boolean', description: 'Simulate success (true) or failure (false)' },
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['name'],
    },
  },
  {
    name: 'circuit_breaker_status',
    description: 'Get circuit breaker status and stats',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'circuit_breaker_reset',
    description: 'Reset a circuit breaker to closed state',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'bulkhead_create',
    description: 'Create a named bulkhead for concurrency control',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        maxConcurrent: { type: 'number', default: 10 },
        maxQueued: { type: 'number', default: 100 },
        timeoutMs: { type: 'number', default: 30000 },
      },
      required: ['name'],
    },
  },
  {
    name: 'bulkhead_status',
    description: 'Get bulkhead status and stats',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'orchestrator_create',
    description: 'Create a retry orchestrator combining backoff + circuit breaker + bulkhead + timeout',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        maxRetries: { type: 'number', default: 5 },
        timeoutMs: { type: 'number', default: 30000 },
        circuitBreaker: {
          type: 'object',
          properties: { failureThreshold: { type: 'number' }, resetTimeoutMs: { type: 'number' } },
        },
        bulkhead: {
          type: 'object',
          properties: { maxConcurrent: { type: 'number' }, maxQueued: { type: 'number' } },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'orchestrator_execute',
    description: 'Execute through a named orchestrator',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        success: { type: 'boolean', description: 'Simulate success/failure' },
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['name'],
    },
  },
  {
    name: 'orchestrator_status',
    description: 'Get orchestrator status including circuit breaker and bulkhead stats',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'health_register',
    description: 'Register a health check',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        critical: { type: 'boolean', default: false },
        timeoutMs: { type: 'number', default: 5000 },
        command: { type: 'string', description: 'Shell command to run as health check' },
      },
      required: ['name', 'command'],
    },
  },
  {
    name: 'health_status',
    description: 'Run all health checks and return status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'registry_status',
    description: 'Get full status of all registered components',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Execute shell command ────────────────────────────────────────────────────
async function execCmd(cmd) {
  const { execSync } = await import('child_process');
  try {
    return execSync(cmd, { timeout: 10000, encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error(e.message);
  }
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case 'retry_execute': {
      const maxRetries = args.maxRetries ?? 3;
      let lastErr;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          const delay = Math.min(200 * Math.pow(2, i), 30000);
          const result = args.command
            ? await (args.timeoutMs ? withTimeout(() => execCmd(args.command), args.timeoutMs) : execCmd(args.command))
            : `Simulated success on attempt ${i + 1}`;
          return { ok: true, attempt: i + 1, result };
        } catch (err) {
          lastErr = err;
          if (i < maxRetries) await new Promise(r => setTimeout(r, Math.min(200 * Math.pow(2, i), 30000)));
        }
      }
      return { ok: false, attempts: maxRetries + 1, error: lastErr.message };
    }

    case 'circuit_breaker_create': {
      const cb = new CircuitBreaker(args);
      breakers.set(args.name, cb);
      return cb.stats;
    }

    case 'circuit_breaker_execute': {
      const cb = breakers.get(args.name);
      if (!cb) throw new Error(`Circuit breaker '${args.name}' not found`);
      try {
        const result = args.command
          ? await cb.execute(() => execCmd(args.command))
          : await cb.execute(async () => {
              if (args.success === false) throw new Error('Simulated failure');
              return 'ok';
            });
        return { ok: true, state: cb.state, result };
      } catch (err) {
        return { ok: false, state: cb.state, error: err.message, code: err.code };
      }
    }

    case 'circuit_breaker_status': {
      const cb = breakers.get(args.name);
      if (!cb) throw new Error(`Circuit breaker '${args.name}' not found`);
      return cb.stats;
    }

    case 'circuit_breaker_reset': {
      const cb = breakers.get(args.name);
      if (!cb) throw new Error(`Circuit breaker '${args.name}' not found`);
      cb.reset();
      return { ok: true, state: cb.state };
    }

    case 'bulkhead_create': {
      const bh = new Bulkhead(args);
      bulkheads.set(args.name, bh);
      return bh.stats;
    }

    case 'bulkhead_status': {
      const bh = bulkheads.get(args.name);
      if (!bh) throw new Error(`Bulkhead '${args.name}' not found`);
      return bh.stats;
    }

    case 'orchestrator_create': {
      const o = new RetryOrchestrator({
        ...args,
        backoff: { maxRetries: args.maxRetries, initialMs: 200, maxMs: 30000 },
      });
      orchestrators.set(args.name, o);
      return o.stats;
    }

    case 'orchestrator_execute': {
      const o = orchestrators.get(args.name);
      if (!o) throw new Error(`Orchestrator '${args.name}' not found`);
      try {
        const result = await o.execute(async () => {
          if (args.command) return execCmd(args.command);
          if (args.success === false) throw new Error('Simulated failure');
          return 'ok';
        });
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err.message, code: err.code };
      }
    }

    case 'orchestrator_status': {
      const o = orchestrators.get(args.name);
      if (!o) throw new Error(`Orchestrator '${args.name}' not found`);
      return o.stats;
    }

    case 'health_register': {
      healthChecker.register(args.name, () => execCmd(args.command), { critical: args.critical, timeoutMs: args.timeoutMs });
      return { ok: true, name: args.name };
    }

    case 'health_status': {
      const results = await healthChecker.runAll();
      return { ...healthChecker.status, results };
    }

    case 'registry_status': {
      return {
        circuitBreakers: [...breakers.values()].map(b => b.stats),
        bulkheads: [...bulkheads.values()].map(b => b.stats),
        orchestrators: [...orchestrators.values()].map(o => o.stats),
        health: healthChecker.status,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP JSON-RPC Server ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.MCP_PORT ?? '3104');

const server = createServer(async (req, res) => {
  // Handle MCP over HTTP (SSE-style or JSON-RPC)
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, tools: TOOLS.length }));
  }

  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tools: TOOLS }));
  }

  if (req.method === 'POST' && req.url === '/call') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { tool, arguments: args } = JSON.parse(body);
        const result = await handleTool(tool, args ?? {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Default: MCP JSON-RPC over stdio-style HTTP
  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        let result;
        if (msg.method === 'tools/list') {
          result = { tools: TOOLS };
        } else if (msg.method === 'tools/call') {
          result = await handleTool(msg.params.name, msg.params.arguments ?? {});
        } else {
          throw new Error(`Unknown method: ${msg.method}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🛡️  agent-retry MCP server: http://localhost:${PORT}`);
  console.log(`   POST /mcp — JSON-RPC | GET /tools — list | POST /call — direct`);
  console.log(`   ${TOOLS.length} tools available`);
});

export { server, TOOLS, handleTool };
