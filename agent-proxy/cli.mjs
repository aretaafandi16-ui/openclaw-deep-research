#!/usr/bin/env node

/**
 * agent-proxy CLI
 */

import { AgentProxy } from './index.mjs';
import { readFileSync, writeFileSync } from 'fs';

const USAGE = `agent-proxy — API Gateway & Request Proxy for AI agents

Usage:
  agent-proxy serve [--port PORT]              Start proxy gateway
  agent-proxy add NAME TARGET [TARGET...]      Add a route
  agent-proxy remove NAME                      Remove a route
  agent-proxy list                             List routes
  agent-proxy forward --route NAME --url URL   Forward a request
  agent-proxy stats                            Show statistics
  agent-proxy circuit                          Show circuit breaker status
  agent-proxy circuit-reset                    Reset all circuit breakers
  agent-proxy cache-clear                      Clear response cache
  agent-proxy health [--route NAME]            Run health checks
  agent-proxy reload CONFIG.json               Hot-reload config
  agent-proxy demo                             Run interactive demo
  agent-proxy mcp                              Start MCP server

Options:
  --port PORT        Gateway port (default: 3110)
  --admin-port PORT  Admin API port (default: 3111)
  --timeout MS       Request timeout (default: 30000)
  --strategy STR     Load balancing strategy (default: round-robin)
  --rate-limit N     Requests per window (default: 100)
  --window MS        Rate limit window (default: 60000)
  --help             Show this help`;

function parseArgs(args) {
  const opts = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[++i] || true;
    } else {
      opts._.push(args[i]);
    }
  }
  return opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.help || !cmd) { console.log(USAGE); return; }

  const proxy = new AgentProxy({
    port: parseInt(args.port || '3110'),
    defaultTimeoutMs: parseInt(args.timeout || '30000'),
  });

  switch (cmd) {
    case 'serve': {
      await proxy.start();
      console.log(`🐋 agent-proxy listening on :${proxy.config.port}`);

      // Also start admin dashboard
      const { createServer } = await import('http');
      const adminPort = parseInt(args['admin-port'] || '3111');
      const admin = createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/_proxy/stats') return res.end(JSON.stringify(proxy.stats()));
        if (req.url === '/_proxy/routes') return res.end(JSON.stringify(proxy.routeStats()));
        res.writeHead(404); res.end('{}');
      });
      admin.listen(adminPort, () => console.log(`📊 Admin API: http://localhost:${adminPort}/_proxy/stats`));

      process.on('SIGINT', async () => { await proxy.stop(); admin.close(); process.exit(0); });
      process.on('SIGTERM', async () => { await proxy.stop(); admin.close(); process.exit(0); });
      break;
    }

    case 'add': {
      const name = args._[1];
      const targets = args._.slice(2);
      if (!name || !targets.length) { console.error('Usage: agent-proxy add NAME TARGET [TARGET...]'); process.exit(1); }
      proxy.addRoute(name, {
        targets,
        prefix: args.prefix || `/${name}`,
        strategy: args.strategy || 'round-robin',
        timeoutMs: parseInt(args.timeout || '30000'),
        rateLimit: args['rate-limit'] ? { maxRequests: parseInt(args['rate-limit']), windowMs: parseInt(args.window || '60000') } : null,
      });
      console.log(`✅ Route "${name}" added → ${targets.join(', ')}`);
      break;
    }

    case 'remove': {
      const name = args._[1];
      if (!name) { console.error('Usage: agent-proxy remove NAME'); process.exit(1); }
      proxy.removeRoute(name);
      console.log(`🗑️  Route "${name}" removed`);
      break;
    }

    case 'list': {
      const stats = proxy.routeStats();
      if (Object.keys(stats).length === 0) { console.log('No routes configured'); return; }
      for (const [name, s] of Object.entries(stats)) {
        console.log(`  ${name}: ${s.requests} reqs, ${s.success} ok, ${s.errors} err, ${Math.round(s.avgLatency)}ms avg, CB: ${s.circuitBreaker.state}`);
      }
      break;
    }

    case 'forward': {
      if (!args.route || !args.url) { console.error('Usage: agent-proxy forward --route NAME --url URL'); process.exit(1); }
      const result = await proxy.forward({ method: args.method || 'GET', url: args.url, headers: {}, body: args.body ? JSON.parse(args.body) : null }, args.route);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'stats': {
      console.log(JSON.stringify(proxy.stats(), null, 2));
      break;
    }

    case 'circuit': {
      const cbs = {};
      for (const [name, route] of proxy.routes) cbs[name] = route.circuitBreaker.status();
      console.log(JSON.stringify(cbs, null, 2));
      break;
    }

    case 'circuit-reset': {
      for (const [, route] of proxy.routes) route.circuitBreaker.reset();
      console.log('✅ All circuit breakers reset');
      break;
    }

    case 'cache-clear': {
      proxy.cache.invalidate();
      console.log('✅ Cache cleared');
      break;
    }

    case 'health': {
      if (args.route) {
        const route = proxy.getRoute(args.route);
        if (route?.healthChecker) {
          const result = await route.healthChecker.check();
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`No health checker for route "${args.route}"`);
        }
      } else {
        const results = {};
        for (const [name, route] of proxy.routes) {
          if (route.healthChecker) results[name] = await route.healthChecker.check();
        }
        console.log(JSON.stringify(results, null, 2));
      }
      break;
    }

    case 'reload': {
      const configFile = args._[1];
      if (!configFile) { console.error('Usage: agent-proxy reload CONFIG.json'); process.exit(1); }
      const config = JSON.parse(readFileSync(configFile, 'utf8'));
      proxy.reload(config);
      console.log(`✅ Reloaded ${Object.keys(config.routes || {}).length} routes`);
      break;
    }

    case 'demo': {
      console.log('🐋 agent-proxy demo\n');
      proxy.addRoute('httpbin', {
        targets: ['https://httpbin.org'],
        prefix: '/api',
        strategy: 'round-robin',
        timeoutMs: 10000,
        rateLimit: { maxRequests: 10, windowMs: 60000 },
        cacheTtlMs: 30000,
      });
      console.log('✅ Route "httpbin" → https://httpbin.org (prefix: /api)');

      proxy.addRoute('jsonplaceholder', {
        targets: ['https://jsonplaceholder.typicode.com'],
        prefix: '/posts',
        strategy: 'round-robin',
        timeoutMs: 5000,
      });
      console.log('✅ Route "jsonplaceholder" → https://jsonplaceholder.typicode.com (prefix: /posts)');

      // Test forwarding
      try {
        console.log('\n→ Forwarding GET /api/get...');
        const r1 = await proxy.forward({ method: 'GET', url: '/api/get', headers: {} }, 'httpbin');
        console.log(`  Status: ${r1.status}, Latency: ${r1.headers['X-Proxy-Latency']}`);
      } catch (e) { console.error(`  Error: ${e.message}`); }

      try {
        console.log('\n→ Forwarding GET /api/ip...');
        const r2 = await proxy.forward({ method: 'GET', url: '/api/ip', headers: {} }, 'httpbin');
        console.log(`  Status: ${r2.status}, Body: ${JSON.stringify(r2.body).slice(0, 80)}...`);
      } catch (e) { console.error(`  Error: ${e.message}`); }

      // Test cache
      console.log('\n→ Testing cache (same request again)...');
      try {
        const r3 = await proxy.forward({ method: 'GET', url: '/api/get', headers: {} }, 'httpbin');
        console.log(`  Cache: ${r3.headers['X-Cache'] || 'MISS'}`);
      } catch (e) { console.error(`  Error: ${e.message}`); }

      console.log('\n📊 Stats:');
      console.log(JSON.stringify(proxy.stats(), null, 2));

      console.log('\n📋 Routes:');
      console.log(JSON.stringify(proxy.routeStats(), null, 2));

      break;
    }

    case 'mcp': {
      // Handled by mcp-server.mjs directly
      const { execSync } = await import('child_process');
      execSync('node mcp-server.mjs', { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
