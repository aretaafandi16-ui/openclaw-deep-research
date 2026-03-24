#!/usr/bin/env node

/**
 * agent-proxy MCP Server — Model Context Protocol interface
 */

import { AgentProxy } from './index.mjs';
import { readFileSync } from 'fs';

const proxy = new AgentProxy();

const TOOLS = [
  { name: 'proxy_add_route', description: 'Add a proxy route with targets, load balancing, rate limiting', inputSchema: { type: 'object', properties: { name: { type: 'string' }, config: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, prefix: { type: 'string' }, strategy: { type: 'string', enum: ['round-robin', 'random', 'weighted', 'least-connections'] }, timeoutMs: { type: 'number' }, retries: { type: 'number' }, cacheTtlMs: { type: 'number' }, rateLimit: { type: 'object' }, headers: { type: 'object' }, stripPrefix: { type: 'string' } } } }, required: ['name', 'config'] } },
  { name: 'proxy_remove_route', description: 'Remove a proxy route', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'proxy_list_routes', description: 'List all routes with stats', inputSchema: { type: 'object', properties: {} } },
  { name: 'proxy_forward', description: 'Forward a request through a named route', inputSchema: { type: 'object', properties: { route: { type: 'string' }, method: { type: 'string', default: 'GET' }, url: { type: 'string' }, headers: { type: 'object' }, body: {} }, required: ['route', 'url'] } },
  { name: 'proxy_stats', description: 'Get proxy gateway statistics', inputSchema: { type: 'object', properties: {} } },
  { name: 'proxy_circuit_status', description: 'Get circuit breaker status for all routes', inputSchema: { type: 'object', properties: {} } },
  { name: 'proxy_circuit_reset', description: 'Reset all circuit breakers', inputSchema: { type: 'object', properties: {} } },
  { name: 'proxy_cache_clear', description: 'Clear response cache', inputSchema: { type: 'object', properties: {} } },
  { name: 'proxy_health_check', description: 'Run health check on route upstreams', inputSchema: { type: 'object', properties: { route: { type: 'string' } } } },
  { name: 'proxy_reload', description: 'Hot-reload route configuration from JSON', inputSchema: { type: 'object', properties: { config: { type: 'string', description: 'JSON config with routes object' } }, required: ['config'] } },
];

// JSON-RPC over stdio
let id = 0;
function respond(reqId, result, error) {
  const resp = { jsonrpc: '2.0', id: reqId };
  if (error) resp.error = { code: -32000, message: error.message || error };
  else resp.result = result;
  process.stdout.write(JSON.stringify(resp) + '\n');
}

async function handleRequest(req) {
  const { method, params, id: reqId } = req;

  if (method === 'initialize') {
    return respond(reqId, { protocolVersion: '2024-11-05', serverInfo: { name: 'agent-proxy', version: '1.0.0' }, capabilities: { tools: {} } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'ping') return respond(reqId, {});
  if (method === 'tools/list') return respond(reqId, { tools: TOOLS });

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      switch (name) {
        case 'proxy_add_route': {
          const route = proxy.addRoute(args.name, args.config);
          respond(reqId, { content: [{ type: 'text', text: `Route "${args.name}" added with ${args.config.targets?.length || 0} targets` }] });
          break;
        }
        case 'proxy_remove_route': {
          proxy.removeRoute(args.name);
          respond(reqId, { content: [{ type: 'text', text: `Route "${args.name}" removed` }] });
          break;
        }
        case 'proxy_list_routes': {
          respond(reqId, { content: [{ type: 'text', text: JSON.stringify(proxy.routeStats(), null, 2) }] });
          break;
        }
        case 'proxy_forward': {
          const result = await proxy.forward({ method: args.method || 'GET', url: args.url, headers: args.headers || {}, body: args.body }, args.route);
          respond(reqId, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          break;
        }
        case 'proxy_stats': {
          respond(reqId, { content: [{ type: 'text', text: JSON.stringify(proxy.stats(), null, 2) }] });
          break;
        }
        case 'proxy_circuit_status': {
          const cbs = {};
          for (const [name, route] of proxy.routes) cbs[name] = route.circuitBreaker.status();
          respond(reqId, { content: [{ type: 'text', text: JSON.stringify(cbs, null, 2) }] });
          break;
        }
        case 'proxy_circuit_reset': {
          for (const [, route] of proxy.routes) route.circuitBreaker.reset();
          respond(reqId, { content: [{ type: 'text', text: 'All circuit breakers reset' }] });
          break;
        }
        case 'proxy_cache_clear': {
          proxy.cache.invalidate();
          respond(reqId, { content: [{ type: 'text', text: 'Cache cleared' }] });
          break;
        }
        case 'proxy_health_check': {
          if (args.route) {
            const route = proxy.getRoute(args.route);
            if (route?.healthChecker) {
              const result = await route.healthChecker.check();
              respond(reqId, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
            } else {
              respond(reqId, { content: [{ type: 'text', text: 'No health checker configured for this route' }] });
            }
          } else {
            const results = {};
            for (const [name, route] of proxy.routes) {
              if (route.healthChecker) results[name] = await route.healthChecker.check();
            }
            respond(reqId, { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] });
          }
          break;
        }
        case 'proxy_reload': {
          const config = JSON.parse(args.config);
          proxy.reload(config);
          respond(reqId, { content: [{ type: 'text', text: `Reloaded ${Object.keys(config.routes || {}).length} routes` }] });
          break;
        }
        default:
          respond(reqId, null, `Unknown tool: ${name}`);
      }
    } catch (err) {
      respond(reqId, null, err.message);
    }
    return;
  }

  respond(reqId, null, `Unknown method: ${method}`);
}

// stdin reader
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      handleRequest(req).catch(err => {
        if (req.id != null) respond(req.id, null, err.message);
      });
    } catch { /* skip invalid JSON */ }
  }
});

process.stdin.on('end', () => process.exit(0));
