#!/usr/bin/env node
// agent-cache CLI
import { AgentCache } from './index.mjs';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const USAGE = `agent-cache — caching layer for AI agents

Usage:
  agent-cache set <key> <value> [--ttl ms] [--tags t1,t2]
  agent-cache get <key>
  agent-cache has <key>
  agent-cache delete <key>
  agent-cache peek <key>
  agent-cache touch <key> [--ttl ms]
  agent-cache keys [pattern]
  agent-cache tags
  agent-cache invalidate-tag <tag>
  agent-cache invalidate-pattern <pattern>
  agent-cache mget <key1> <key2> ...
  agent-cache stats
  agent-cache clear
  agent-cache export
  agent-cache set-json <key> <json-file> [--ttl ms] [--tags t1,t2]
  agent-cache serve [--port 3102]
  agent-cache mcp
  agent-cache demo

Options:
  --ttl ms           TTL in milliseconds (default: 300000)
  --tags t1,t2       Comma-separated tags
  --port PORT        HTTP server port (default: 3102)
  --persist PATH     Path for persistence file
  --max-size N       Max cache entries (default: 10000)`;

function getArg(args, flag, def) {
  const i = args.indexOf(flag);
  if (i === -1) return def;
  return args[i + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(USAGE); return; }

  const cache = new AgentCache({
    defaultTTL: +(getArg(args, '--ttl', 300000)),
    maxSize: +(getArg(args, '--max-size', 10000)),
    persistPath: getArg(args, '--persist', null),
  });

  switch (cmd) {
    case 'set': {
      await cache.set(args[1], args[2], {
        ttl: +(getArg(args, '--ttl', cache.defaultTTL)),
        tags: getArg(args, '--tags', '')?.split(',').filter(Boolean),
      });
      console.log(JSON.stringify({ success: true, key: args[1] }));
      break;
    }
    case 'get': {
      const val = await cache.get(args[1]);
      console.log(JSON.stringify({ found: val !== null, value: val }, null, 2));
      break;
    }
    case 'has': {
      console.log(JSON.stringify({ exists: cache.has(args[1]) }));
      break;
    }
    case 'delete': {
      const deleted = await cache.delete(args[1]);
      console.log(JSON.stringify({ deleted }));
      break;
    }
    case 'peek': {
      const val = await cache.peek(args[1]);
      console.log(JSON.stringify({ found: val !== null, value: val }, null, 2));
      break;
    }
    case 'touch': {
      const ok = await cache.touch(args[1], getArg(args, '--ttl', null) ? +(getArg(args, '--ttl')) : undefined);
      console.log(JSON.stringify({ touched: ok }));
      break;
    }
    case 'keys': {
      console.log(JSON.stringify({ keys: cache.keys(args[1]) }, null, 2));
      break;
    }
    case 'tags': {
      console.log(JSON.stringify({ tags: cache.tags() }, null, 2));
      break;
    }
    case 'invalidate-tag': {
      const count = await cache.invalidateTag(args[1]);
      console.log(JSON.stringify({ invalidated: count }));
      break;
    }
    case 'invalidate-pattern': {
      const count = await cache.invalidatePattern(args[1]);
      console.log(JSON.stringify({ invalidated: count }));
      break;
    }
    case 'mget': {
      const result = await cache.mget(args.slice(1));
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'stats': {
      console.log(JSON.stringify(cache.stats(), null, 2));
      break;
    }
    case 'clear': {
      const count = await cache.clear();
      console.log(JSON.stringify({ cleared: count }));
      break;
    }
    case 'export': {
      console.log(JSON.stringify(cache.export(), null, 2));
      break;
    }
    case 'set-json': {
      const data = JSON.parse(readFileSync(args[2], 'utf8'));
      await cache.set(args[1], data, {
        ttl: +(getArg(args, '--ttl', cache.defaultTTL)),
        tags: getArg(args, '--tags', '')?.split(',').filter(Boolean),
      });
      console.log(JSON.stringify({ success: true, key: args[1], type: typeof data }));
      break;
    }
    case 'serve': {
      const port = +(getArg(args, '--port', 3102));
      await startServer(cache, port);
      break;
    }
    case 'mcp': {
      // Forward to MCP server
      const { execFileSync } = await import('child_process');
      execFileSync('node', [new URL('./mcp-server.mjs', import.meta.url).pathname], { stdio: 'inherit' });
      break;
    }
    case 'demo': {
      await runDemo(cache);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(USAGE);
      process.exit(1);
  }

  cache.destroy();
}

async function startServer(cache, port) {
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;

    try {
      if (path === '/' && req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html');
        res.end(dashboardHTML(cache));
        return;
      }

      if (path === '/api/stats' && req.method === 'GET') {
        res.end(JSON.stringify(cache.stats()));
        return;
      }

      if (path === '/api/keys' && req.method === 'GET') {
        const pattern = url.searchParams.get('pattern');
        res.end(JSON.stringify({ keys: cache.keys(pattern) }));
        return;
      }

      if (path === '/api/tags' && req.method === 'GET') {
        res.end(JSON.stringify({ tags: cache.tags() }));
        return;
      }

      if (path.match(/^\/api\/get\//) && req.method === 'GET') {
        const key = decodeURIComponent(path.slice(9));
        const val = await cache.get(key);
        res.end(JSON.stringify({ found: val !== null, value: val }));
        return;
      }

      if (path.match(/^\/api\/has\//) && req.method === 'GET') {
        const key = decodeURIComponent(path.slice(9));
        res.end(JSON.stringify({ exists: cache.has(key) }));
        return;
      }

      if (path === '/api/set' && req.method === 'POST') {
        const body = await readBody(req);
        const { key, value, ttl, tags } = JSON.parse(body);
        await cache.set(key, value, { ttl, tags });
        res.end(JSON.stringify({ success: true, key }));
        return;
      }

      if (path.match(/^\/api\/delete\//) && req.method === 'DELETE') {
        const key = decodeURIComponent(path.slice(13));
        const deleted = await cache.delete(key);
        res.end(JSON.stringify({ deleted }));
        return;
      }

      if (path === '/api/invalidate-tag' && req.method === 'POST') {
        const body = await readBody(req);
        const { tag } = JSON.parse(body);
        const count = await cache.invalidateTag(tag);
        res.end(JSON.stringify({ invalidated: count }));
        return;
      }

      if (path === '/api/invalidate-pattern' && req.method === 'POST') {
        const body = await readBody(req);
        const { pattern } = JSON.parse(body);
        const count = await cache.invalidatePattern(pattern);
        res.end(JSON.stringify({ invalidated: count }));
        return;
      }

      if (path === '/api/clear' && req.method === 'POST') {
        const count = await cache.clear();
        res.end(JSON.stringify({ cleared: count }));
        return;
      }

      if (path === '/api/export' && req.method === 'GET') {
        res.end(JSON.stringify(cache.export()));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(port, () => {
    console.error(`[agent-cache] HTTP server on :${port}`);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function dashboardHTML(cache) {
  const stats = cache.stats();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-cache</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', monospace; background: #0d1117; color: #c9d1d9; padding: 24px; }
  h1 { color: #58a6ff; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
  .card .value { font-size: 28px; font-weight: bold; color: #58a6ff; }
  .card .label { font-size: 12px; color: #8b949e; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px 12px; border: 1px solid #30363d; text-align: left; }
  th { background: #161b22; color: #58a6ff; }
  tr:hover { background: #161b22; }
  .tag { display: inline-block; background: #1f6feb; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin: 2px; }
  #search { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 6px; width: 300px; margin: 12px 0; }
  button { background: #238636; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; margin: 4px; }
  button:hover { background: #2ea043; }
  button.danger { background: #da3633; }
</style>
</head>
<body>
<h1>🐋 agent-cache</h1>
<div class="grid">
  <div class="card"><div class="value" id="size">${stats.size}</div><div class="label">Entries</div></div>
  <div class="card"><div class="value" id="hitRate">${stats.hitRate != null ? (stats.hitRate * 100).toFixed(1) + '%' : 'N/A'}</div><div class="label">Hit Rate</div></div>
  <div class="card"><div class="value" id="hits">${stats.hits}</div><div class="label">Hits</div></div>
  <div class="card"><div class="value" id="misses">${stats.misses}</div><div class="label">Misses</div></div>
  <div class="card"><div class="value" id="evictions">${stats.evictions}</div><div class="label">Evictions</div></div>
  <div class="card"><div class="value" id="tags">${stats.tagCount}</div><div class="label">Tags</div></div>
</div>
<div>
  <input id="search" placeholder="Search keys (glob: user:*)">
  <button onclick="search()">Search</button>
  <button class="danger" onclick="clearCache()">Clear All</button>
</div>
<table id="entries"><thead><tr><th>Key</th><th>Value</th><th>Tags</th><th>Hits</th><th>Actions</th></tr></thead><tbody></tbody></table>
<script>
async function load(pattern) {
  const keys = await fetch('/api/keys' + (pattern ? '?pattern=' + encodeURIComponent(pattern) : '')).then(r => r.json());
  const tbody = document.querySelector('#entries tbody');
  tbody.innerHTML = '';
  for (const key of keys.keys) {
    const entry = await fetch('/api/get/' + encodeURIComponent(key)).then(r => r.json());
    const val = JSON.stringify(entry.value);
    const preview = val.length > 60 ? val.slice(0, 60) + '...' : val;
    tbody.innerHTML += '<tr><td>' + key + '</td><td><code>' + preview + '</code></td><td>' + (entry.value?.tags?.map(t => '<span class="tag">' + t + '</span>').join('') || '') + '</td><td>' + (entry.hits ?? '-') + '</td><td><button onclick="del(\\'' + key + '\\')">Delete</button></td></tr>';
  }
  const stats = await fetch('/api/stats').then(r => r.json());
  document.getElementById('size').textContent = stats.size;
  document.getElementById('hitRate').textContent = stats.hitRate != null ? (stats.hitRate * 100).toFixed(1) + '%' : 'N/A';
  document.getElementById('hits').textContent = stats.hits;
  document.getElementById('misses').textContent = stats.misses;
  document.getElementById('evictions').textContent = stats.evictions;
  document.getElementById('tags').textContent = stats.tagCount;
}
function search() { load(document.getElementById('search').value); }
async function del(key) { await fetch('/api/delete/' + encodeURIComponent(key), { method: 'DELETE' }); load(); }
async function clearCache() { if (confirm('Clear all?')) { await fetch('/api/clear', { method: 'POST' }); load(); } }
load();
setInterval(() => load(), 5000);
</script></body></html>`;
}

async function runDemo(cache) {
  console.log('🐋 agent-cache demo\n');

  console.log('1. Setting cache entries...');
  await cache.set('llm:gpt4:prompt1', { response: 'Hello Reza!', tokens: 42 }, { tags: ['llm', 'gpt4'], ttl: 60000 });
  await cache.set('llm:claude:prompt1', { response: 'Hi there!', tokens: 38 }, { tags: ['llm', 'claude'] });
  await cache.set('api:weather:jakarta', { temp: 32, humidity: 78 }, { tags: ['api', 'weather'] });
  await cache.set('api:weather:singapore', { temp: 31, humidity: 85 }, { tags: ['api', 'weather'] });
  console.log('   Set 4 entries with tags\n');

  console.log('2. Reading back...');
  const gpt4 = await cache.get('llm:gpt4:prompt1');
  console.log('   GPT-4 response:', gpt4.response);
  console.log('   Cache size:', cache.stats().size, '\n');

  console.log('3. Batch get...');
  const batch = await cache.mget(['llm:gpt4:prompt1', 'llm:claude:prompt1', 'nonexistent']);
  console.log('   Keys found:', Object.values(batch).filter(v => v !== null).length, '/ 3\n');

  console.log('4. Tag-based invalidation...');
  const invalidated = await cache.invalidateTag('weather');
  console.log('   Invalidated', invalidated, 'weather entries');
  console.log('   Remaining:', cache.stats().size, '\n');

  console.log('5. Pattern invalidation...');
  await cache.set('session:user1:token', 'abc');
  await cache.set('session:user2:token', 'def');
  const patCount = await cache.invalidatePattern('session:*');
  console.log('   Invalidated', patCount, 'session entries\n');

  console.log('6. LRU eviction demo (max 3)...');
  const small = new AgentCache({ maxSize: 3 });
  for (let i = 1; i <= 5; i++) await small.set(`item:${i}`, i);
  console.log('   Added 5 items to max-3 cache:', small.keys());
  console.log('   item:1 evicted:', !(small.has('item:1')));
  console.log('   item:5 present:', small.has('item:5'), '\n');

  console.log('7. getOrSet (lazy compute)...');
  let computed = 0;
  const v1 = await cache.getOrSet('expensive', () => { computed++; return { data: 'computed result' }; });
  const v2 = await cache.getOrSet('expensive', () => { computed++; return { data: 'computed result' }; });
  console.log('   Computed only once:', computed === 1, '\n');

  console.log('8. Stats:');
  console.log(JSON.stringify(cache.stats(), null, 2));

  console.log('\n✅ Demo complete');
}

main().catch(e => { console.error(e); process.exit(1); });
