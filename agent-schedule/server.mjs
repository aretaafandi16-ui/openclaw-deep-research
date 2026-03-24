#!/usr/bin/env node
/**
 * agent-schedule HTTP server with dark-theme web dashboard
 */

import { createServer } from 'node:http';
import { AgentSchedule } from './index.mjs';

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf8' });
  res.end(body);
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-schedule</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:1rem}
h1{color:#58a6ff;margin-bottom:.5rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin:1rem 0}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem}.card h3{color:#8b949e;font-size:.8rem;text-transform:uppercase}
.card .val{font-size:1.8rem;font-weight:700;color:#58a6ff}table{width:100%;border-collapse:collapse;margin-top:1rem}
th,td{padding:.5rem .75rem;text-align:left;border-bottom:1px solid #30363d}th{color:#8b949e;font-size:.75rem;text-transform:uppercase}
.tag{display:inline-block;background:#1f6feb;color:#fff;border-radius:4px;padding:2px 8px;font-size:.7rem;margin:2px}
.on{color:#3fb950}.off{color:#f85149}code{background:#161b22;padding:2px 6px;border-radius:4px;font-size:.85rem}
.upcoming{margin-top:1.5rem}h2{color:#c9d1d9;margin:1rem 0 .5rem}
</style></head><body>
<h1>🐋 agent-schedule</h1>
<div class="cards" id="cards"></div>
<h2>Jobs</h2><table><thead><tr><th>Name</th><th>Cron</th><th>Status</th><th>Next Run</th><th>Runs</th><th>✓</th><th>✗</th><th>Tags</th></tr></thead><tbody id="jobs"></tbody></table>
<h2>Upcoming (next 60min)</h2><table><thead><tr><th>Name</th><th>Cron</th><th>Next Run</th></tr></thead><tbody id="upcoming"></tbody></table>
<h2>Recent Runs</h2><table><thead><tr><th>Job</th><th>Status</th><th>Duration</th><th>Time</th></tr></thead><tbody id="history"></tbody></table>
<script>
const fmt=t=>t?new Date(t).toLocaleString():'-';
async function refresh(){
  try{
    const[s,j,u,h]=await Promise.all(['/api/stats','/api/jobs','/api/upcoming?minutes=60','/api/history?limit=20'].map(p=>fetch(p).then(r=>r.json())));
    document.getElementById('cards').innerHTML=
      '<div class="card"><h3>Total Jobs</h3><div class="val">'+s.totalJobs+'</div></div>'+
      '<div class="card"><h3>Enabled</h3><div class="val">'+s.enabledJobs+'</div></div>'+
      '<div class="card"><h3>Running</h3><div class="val">'+s.runningJobs+'</div></div>'+
      '<div class="card"><h3>Total Runs</h3><div class="val">'+s.totalRuns+'</div></div>'+
      '<div class="card"><h3>Success</h3><div class="val on">'+s.successes+'</div></div>'+
      '<div class="card"><h3>Failures</h3><div class="val off">'+s.failures+'</div></div>';
    document.getElementById('jobs').innerHTML=j.map(e=>'<tr><td><code>'+e.name+'</code></td><td>'+e.cron+'</td><td>'+(e.enabled?'<span class="on">● on</span>':'<span class="off">○ off</span>')+'</td><td>'+fmt(e.nextRun)+'</td><td>'+e.stats.totalRuns+'</td><td class="on">'+e.stats.successes+'</td><td class="off">'+e.stats.failures+'</td><td>'+(e.tags||[]).map(t=>'<span class="tag">'+t+'</span>').join(' ')+'</td></tr>').join('')||'<tr><td colspan="8">No jobs</td></tr>';
    document.getElementById('upcoming').innerHTML=u.map(e=>'<tr><td><code>'+e.name+'</code></td><td>'+e.cron+'</td><td>'+fmt(e.nextRun)+'</td></tr>').join('')||'<tr><td colspan="3">No upcoming jobs</td></tr>';
    document.getElementById('history').innerHTML=h.map(r=>'<tr><td><code>'+r.name+'</code></td><td>'+(r.success?'<span class="on">✓</span>':'<span class="off">✗ '+r.error+'</span>')+'</td><td>'+(r.duration||0)+'ms</td><td>'+fmt(r.startTime)+'</td></tr>').join('')||'<tr><td colspan="4">No history</td></tr>';
  }catch(e){}
}
refresh();setInterval(refresh,3000);
</script></body></html>`;

export function createApp(opts = {}) {
  const port = opts.port || parseInt(process.env.PORT) || 3107;
  const sched = new AgentSchedule(opts);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;

    // CORS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }

    let body = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      for await (const chunk of req) body += chunk;
    }

    try {
      // Dashboard
      if (path === '/' || path === '/dashboard') return html(res, DASHBOARD_HTML);

      // Stats
      if (path === '/api/stats' && req.method === 'GET') return json(res, sched.getStats());

      // Jobs CRUD
      if (path === '/api/jobs' && req.method === 'GET') return json(res, sched.list());
      if (path === '/api/jobs' && req.method === 'POST') {
        const opts = JSON.parse(body);
        return json(res, sched.schedule(opts), 201);
      }
      if (path.startsWith('/api/jobs/') && req.method === 'GET') {
        const id = path.split('/')[3];
        const job = sched.get(id);
        return job ? json(res, job) : json(res, { error: 'Not found' }, 404);
      }
      if (path.startsWith('/api/jobs/') && req.method === 'DELETE') {
        const id = path.split('/')[3];
        return json(res, { removed: sched.unschedule(id) });
      }
      if (path.match(/^\/api\/jobs\/[^/]+\/trigger$/) && req.method === 'POST') {
        const id = path.split('/')[3];
        try {
          const result = await sched.trigger(id);
          return json(res, result);
        } catch (e) { return json(res, { error: e.message }, 404); }
      }
      if (path.match(/^\/api\/jobs\/[^/]+\/enable$/) && req.method === 'POST') {
        const id = path.split('/')[3];
        return json(res, { enabled: sched.enable(id) });
      }
      if (path.match(/^\/api\/jobs\/[^/]+\/disable$/) && req.method === 'POST') {
        const id = path.split('/')[3];
        return json(res, { disabled: sched.disable(id) });
      }

      // Upcoming
      if (path === '/api/upcoming' && req.method === 'GET') {
        const minutes = parseInt(url.searchParams.get('minutes') || '60');
        return json(res, sched.getUpcoming(minutes));
      }

      // History
      if (path === '/api/history' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const entryId = url.searchParams.get('entryId');
        const success = url.searchParams.has('success') ? url.searchParams.get('success') === 'true' : undefined;
        return json(res, sched.getHistory({ limit, entryId, success }));
      }

      // Health
      if (path === '/health') return json(res, { ok: true, jobs: sched.entries.size });

      json(res, { error: 'Not found' }, 404);
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
  });

  return { server, sched, listen: () => {
    server.listen(port, () => console.log(`🐋 agent-schedule dashboard: http://localhost:${port}`));
    return { port, sched };
  }};
}

// Standalone
if (process.argv[1]?.endsWith('server.mjs')) {
  const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3107');
  const { listen } = createApp({ port });
  listen();
}
