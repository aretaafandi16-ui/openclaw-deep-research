# agent-proxy

Zero-dependency API gateway & request proxy for AI agents.

## Features

- **Named Routes** — Define proxy targets with URL prefixes
- **Load Balancing** — Round-robin, random, weighted, least-connections
- **Rate Limiting** — Per-route sliding window rate limits
- **Circuit Breaker** — Closed/open/half-open state machine with auto-recovery
- **Response Caching** — TTL-based GET response caching
- **Request Deduplication** — Coalesces identical in-flight requests
- **Health Checking** — Configurable interval health probes with threshold-based marking
- **Retry with Backoff** — Exponential backoff on upstream failures
- **Timeout Enforcement** — Per-route configurable request timeouts
- **Request/Response Transforms** — Header injection, path rewriting, body transforms
- **Middleware Pipeline** — Before/after hooks for request lifecycle
- **WebSocket Proxy** — Upgrade passthrough support
- **Hot Config Reload** — Update routes without restart
- **JSONL Logging** — Structured request logs to file
- **EventEmitter** — Real-time proxy event stream
- **HTTP Dashboard** — Dark-theme web UI on port 3111
- **MCP Server** — 10 tools via Model Context Protocol
- **CLI** — Full command-line interface

## Quick Start

```bash
# Start the gateway
node server.mjs

# Or via CLI
node cli.mjs serve --port 3110

# Add a route
node cli.mjs add api https://httpbin.org --prefix /api --strategy round-robin

# Forward a request
node cli.mjs forward --route api --url /api/get

# Check stats
node cli.mjs stats
```

## Library API

```javascript
import { AgentProxy } from './index.mjs';

const proxy = new AgentProxy({ port: 3110 });

// Add routes
proxy.addRoute('api', {
  targets: ['https://api.example.com', 'https://api-backup.example.com'],
  prefix: '/api',
  strategy: 'round-robin',
  timeoutMs: 10000,
  retries: 2,
  rateLimit: { maxRequests: 100, windowMs: 60000 },
  cacheTtlMs: 30000,
  circuitBreaker: { threshold: 5, resetTimeMs: 30000 },
  headers: { 'X-Api-Key': 'secret' },
  stripPrefix: '/api',
});

// Forward requests
const result = await proxy.forward({
  method: 'GET',
  url: '/api/users',
  headers: { 'Accept': 'application/json' },
}, 'api');

console.log(result); // { status: 200, headers: {...}, body: {...} }

// Add middleware
proxy.before(async (req, routeName) => {
  req.headers['X-Request-Id'] = crypto.randomUUID();
});

proxy.after(async (res, req, routeName) => {
  console.log(`${routeName}: ${res.status} in ${res.headers['x-proxy-latency']}`);
});

// Listen to events
proxy.on('request', (e) => console.log(`→ ${e.status} ${e.latency}ms`));
proxy.on('rate-limited', (e) => console.warn(`Rate limited: ${e.route}`));
proxy.on('circuit-open', (e) => console.warn(`Circuit open: ${e.route}`));

// Start HTTP server
await proxy.start();
```

## CLI Commands

```
agent-proxy serve [--port PORT]              Start proxy gateway + dashboard
agent-proxy add NAME TARGET [TARGET...]      Add a route
agent-proxy remove NAME                      Remove a route
agent-proxy list                             List all routes with stats
agent-proxy forward --route NAME --url URL   Forward a request
agent-proxy stats                            Show gateway statistics
agent-proxy circuit                          Show circuit breaker status
agent-proxy circuit-reset                    Reset all circuit breakers
agent-proxy cache-clear                      Clear response cache
agent-proxy health [--route NAME]            Run health checks
agent-proxy reload CONFIG.json               Hot-reload from config file
agent-proxy demo                             Run interactive demo
agent-proxy mcp                              Start MCP server
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `proxy_add_route` | Add a proxy route with targets, LB, rate limiting |
| `proxy_remove_route` | Remove a route |
| `proxy_list_routes` | List all routes with stats |
| `proxy_forward` | Forward a request through a named route |
| `proxy_stats` | Get gateway statistics |
| `proxy_circuit_status` | Get circuit breaker status |
| `proxy_circuit_reset` | Reset all circuit breakers |
| `proxy_cache_clear` | Clear response cache |
| `proxy_health_check` | Run health check on upstreams |
| `proxy_reload` | Hot-reload config from JSON |

## Dashboard

Access at `http://localhost:3111/dashboard` (admin API on port 3111, gateway on port 3110).

Features:
- Real-time stats cards (requests, errors, latency, routes, cache, uptime)
- Route table with success/error counts, avg latency, circuit state, rate limit usage
- Auto-refresh every 3 seconds

## Architecture

```
Request → Rate Limiter → Circuit Breaker → Cache Check → Dedup → Load Balancer
  → Health Check → Transform Request → HTTP Forward → Transform Response
  → Middleware After → Cache Store → Response
```

## Components

| Component | Description |
|-----------|-------------|
| `AgentProxy` | Main gateway class with route management, forwarding, HTTP server |
| `RateLimiter` | Sliding window rate limiter per route |
| `CircuitBreaker` | 3-state circuit breaker (closed/open/half-open) |
| `HealthChecker` | Periodic HTTP health probes with threshold-based marking |
| `LoadBalancer` | 4 strategies: round-robin, random, weighted, least-connections |
| `ResponseCache` | TTL-based LRU response cache |
| `Deduplicator` | Request deduplication for concurrent identical requests |

## License

MIT
