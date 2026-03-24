#!/usr/bin/env node
/**
 * agent-plugin HTTP Server
 * 
 * REST API + dark-theme web dashboard on port 3129
 */

import { createServer } from 'http';
import { PluginManager } from './index.mjs';

const PORT = parseInt(process.env.PORT || '3129');
const manager = new PluginManager({ dataDir: process.env.DATA_DIR || './data' });

// ── Demo plugins ─────────────────────────────────────────────────
function registerDemoPlugins() {
  manager.register({
    name: 'logger',
    version: '1.0.0',
    description: 'Simple console logger plugin',
    tags: ['logging', 'core'],
    hooks: ['beforeAction', 'afterAction'],
    provides: ['logging'],
    priority: 50
  }, () => ({
    log(msg) { return { time: new Date().toISOString(), msg }; },
    beforeAction(data) { console.log(`[before] ${JSON.stringify(data)}`); return data; },
    afterAction(data) { console.log(`[after] ${JSON.stringify(data)}`); return data; }
  }));

  manager.register({
    name: 'validator',
    version: '1.0.0',
    description: 'Input validation plugin',
    tags: ['validation', 'core'],
    hooks: ['validate'],
    provides: ['validation'],
    priority: 30
  }, () => ({
    validate(data) {
      if (!data || typeof data !== 'object') return { valid: false, error: 'Must be an object' };
      return { valid: true, data };
    },
    checkSchema(schema, data) {
      for (const [key, rule] of Object.entries(schema)) {
        if (rule.required && !(key in data)) return { valid: false, error: `Missing required: ${key}` };
        if (rule.type && typeof data[key] !== rule.type) return { valid: false, error: `Wrong type for ${key}` };
      }
      return { valid: true, data };
    }
  }));

  manager.register({
    name: 'transformer',
    version: '1.0.0',
    description: 'Data transformation plugin',
    tags: ['transform', 'data'],
    hooks: ['transform'],
    consumes: ['validation'],
    dependencies: ['validator'],
    provides: ['transform'],
    priority: 70
  }, (ctx) => ({
    transform(data) {
      if (typeof data === 'object') {
        return Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
        );
      }
      return data;
    },
    uppercaseKeys(data) {
      return Object.fromEntries(Object.entries(data).map(([k, v]) => [k.toUpperCase(), v]));
    },
    getInfo() {
      return { validatorAvailable: ctx.plugin.providers('validation').length > 0 };
    }
  }));

  // Auto-enable demo plugins
  (async () => {
    for (const p of ['logger', 'validator', 'transformer']) {
      try { await manager.enable(p); } catch {}
    }
  })();
}

registerDemoPlugins();

// ── Routes ───────────────────────────────────────────────────────
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API routes
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (path === '/api/plugins' && req.method === 'GET') {
        const state = url.searchParams.get('state');
        const tag = url.searchParams.get('tag');
        res.end(JSON.stringify(manager.list({ state, tag })));
        return;
      }

      if (path === '/api/plugins' && req.method === 'POST') {
        const body = await readBody(req);
        const { factoryCode, ...manifest } = JSON.parse(body);
        const factory = new Function('return ' + factoryCode)();
        const plugin = manager.register(manifest, factory);
        res.end(JSON.stringify(plugin.toJSON()));
        return;
      }

      const pluginMatch = path.match(/^\/api\/plugins\/([^/]+)(?:\/(.*))?$/);
      if (pluginMatch) {
        const [, name, action] = pluginMatch;

        if (req.method === 'GET' && !action) {
          const plugin = manager.get(name);
          if (!plugin) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
          res.end(JSON.stringify(plugin));
          return;
        }

        if (req.method === 'POST' && action === 'enable') {
          const plugin = await manager.enable(name);
          res.end(JSON.stringify(plugin.toJSON()));
          return;
        }

        if (req.method === 'POST' && action === 'disable') {
          const plugin = await manager.disable(name);
          res.end(JSON.stringify(plugin.toJSON()));
          return;
        }

        if (req.method === 'POST' && action === 'load') {
          const plugin = await manager.load(name);
          res.end(JSON.stringify(plugin.toJSON()));
          return;
        }

        if (req.method === 'POST' && action === 'reload') {
          const plugin = await manager.reload(name);
          res.end(JSON.stringify(plugin.toJSON()));
          return;
        }

        if (req.method === 'POST' && action === 'call') {
          const body = await readBody(req);
          const { method, args } = JSON.parse(body);
          const result = await manager.callPlugin(name, method, ...(args || []));
          res.end(JSON.stringify({ result }));
          return;
        }

        if (req.method === 'DELETE') {
          await manager.uninstall(name);
          res.end(JSON.stringify({ success: true }));
          return;
        }
      }

      if (path === '/api/hooks' && req.method === 'GET') {
        res.end(JSON.stringify(manager.listHooks()));
        return;
      }

      if (path === '/api/hooks/call' && req.method === 'POST') {
        const body = await readBody(req);
        const { hookName, data, sequential } = JSON.parse(body);
        const result = await manager.callHook(hookName, data, { sequential: sequential !== false });
        res.end(JSON.stringify({ result }));
        return;
      }

      if (path === '/api/stats' && req.method === 'GET') {
        res.end(JSON.stringify(manager.stats()));
        return;
      }

      if (path === '/api/deps' && req.method === 'GET') {
        res.end(JSON.stringify(manager.depGraph()));
        return;
      }

      if (path === '/api/resolve' && req.method === 'GET') {
        const names = url.searchParams.get('names')?.split(',') || undefined;
        res.end(JSON.stringify({ order: manager.resolveLoadOrder(names) }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Dashboard
  if (path === '/' || path === '/dashboard' || path === '/index.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end(DASHBOARD_HTML);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });
}

// ── Dashboard HTML ───────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-plugin Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
.card .val{font-size:28px;font-weight:bold;color:#58a6ff}
.card .label{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
.tag{background:#1f6feb33;color:#58a6ff;padding:2px 6px;border-radius:4px;font-size:11px;margin:1px}
.state-enabled{color:#3fb950}.state-disabled{color:#f0883e}.state-error{color:#f85149}
.state-loaded{color:#58a6ff}.state-registered{color:#8b949e}
button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px}
button:hover{background:#30363d}
.btn-enable{border-color:#238636;color:#3fb950}.btn-disable{border-color:#da3633;color:#f85149}
.btn-reload{border-color:#1f6feb;color:#58a6ff}
input,textarea,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:13px;font-family:inherit}
textarea{width:100%;height:100px;resize:vertical}
.section{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px}
.section h3{color:#58a6ff;margin-bottom:12px}
.flex{display:flex;gap:8px;align-items:center}
.logs{max-height:200px;overflow-y:auto;font-family:monospace;font-size:12px;background:#0d1117;padding:8px;border-radius:4px}
.log-line{color:#8b949e;padding:2px 0}
.log-line .ts{color:#484f58}
</style></head><body>
<h1>🔌 agent-plugin Dashboard</h1>
<div class="cards" id="stats"></div>
<div class="section"><h3>Plugins</h3><table><thead><tr><th>Name</th><th>Version</th><th>State</th><th>Tags</th><th>Provides</th><th>Calls</th><th>Actions</th></tr></thead><tbody id="plugins"></tbody></table></div>
<div class="section"><h3>Hooks</h3><div id="hooks"></div></div>
<div class="section"><h3>Dependency Graph</h3><div id="deps"></div></div>
<div class="section"><h3>Events</h3><div class="logs" id="logs"></div></div>
<script>
const api = async (p, o={}) => { const r = await fetch('/api'+p, o); return r.json(); };
function stateClass(s) { return 'state-'+s; }
async function refresh() {
  try {
    const [stats, plugins, hooks, deps] = await Promise.all([
      api('/stats'), api('/plugins'), api('/hooks'), api('/deps')
    ]);
    document.getElementById('stats').innerHTML = [
      ['Total', stats.total], ['Enabled', stats.byState.enabled||0],
      ['Loaded', stats.byState.loaded||0], ['Disabled', stats.byState.disabled||0],
      ['Errors', stats.byState.error||0], ['Hooks', stats.hooks],
      ['Calls', stats.totalCalls], ['Err', stats.totalErrors]
    ].map(([l,v]) => '<div class="card"><div class="val">'+v+'</div><div class="label">'+l+'</div></div>').join('');

    document.getElementById('plugins').innerHTML = plugins.map(p =>
      '<tr><td><b>'+p.name+'</b><br><small>'+p.description+'</small></td><td>'+p.version+'</td>'+
      '<td class="'+stateClass(p.state)+'">'+p.state+'</td>'+
      '<td>'+p.tags.map(t=>'<span class="tag">'+t+'</span>').join(' ')+'</td>'+
      '<td>'+p.provides.join(', ')+'</td><td>'+p.stats.calls+'</td>'+
      '<td class="flex">'+
      (p.state!=='enabled'?'<button class="btn-enable" onclick="doAction(\\''+p.name+"','enable')\">Enable</button>":'')+
      (p.state==='enabled'?'<button class="btn-disable" onclick="doAction(\\''+p.name+"','disable')\">Disable</button>":'')+
      '<button class="btn-reload" onclick="doAction(\\''+p.name+"','reload')\">Reload</button>"+
      '</td></tr>'
    ).join('');

    document.getElementById('hooks').innerHTML = Object.entries(hooks).map(([name, handlers]) =>
      '<div><b>'+name+'</b>: '+handlers.map(h => '<span class="tag">'+h.plugin+' ('+h.priority+')</span>').join(' ')+'</div>'
    ).join('') || '<em style="color:#484f58">No hooks registered</em>';

    document.getElementById('deps').innerHTML = Object.entries(deps).map(([name, d]) =>
      '<div><b>'+name+'</b> → deps: '+(d.dependencies.join(', ')||'none')+
      ' | used by: '+(d.dependents.join(', ')||'none')+'</div>'
    ).join('');
  } catch(e) { console.error(e); }
}
async function doAction(name, action) {
  await api('/plugins/'+name+'/'+action, {method:'POST'});
  addLog('Plugin '+name+': '+action);
  refresh();
}
function addLog(msg) {
  const el = document.getElementById('logs');
  el.innerHTML = '<div class="log-line"><span class="ts">'+new Date().toLocaleTimeString()+'</span> '+msg+'</div>' + el.innerHTML;
}
refresh(); setInterval(refresh, 5000);
</script></body></html>`;

// ── Start Server ─────────────────────────────────────────────────
const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(\`🔌 agent-plugin dashboard: http://localhost:\${PORT}\`);
  console.log(\`📡 API: http://localhost:\${PORT}/api/plugins\`);
});
