#!/usr/bin/env node
/**
 * agent-cost HTTP server
 * 
 * Endpoints:
 *   POST /record     — Record usage
 *   GET  /estimate   — Estimate cost
 *   GET  /cheapest   — Find cheapest model
 *   GET  /stats      — Usage statistics
 *   GET  /budgets    — Budget status
 *   GET  /recent     — Recent records
 *   POST /budget     — Set budget
 *   POST /pricing    — Add custom pricing
 *   GET  /models     — List models
 *   GET  /export     — Export CSV
 *   DELETE /records  — Clear records
 *   GET  /health     — Health check
 */

import { createServer } from 'http';
import { CostTracker } from './index.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const PORT = parseInt(process.env.PORT || '3100');
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.agent-cost');

const tracker = new CostTracker({ dataPath: DATA_DIR });

// Budget warnings → log
tracker.on('budget:warning', (info) => {
  console.warn(`⚠️  Budget warning: ${info.period} at ${info.percentUsed}% ($${info.spent}/$${info.limit})`);
});

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) { reject(e); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function error(res, msg, status = 400) {
  json(res, { error: msg }, status);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }

    // Health
    if (path === '/health' && req.method === 'GET') {
      return json(res, { status: 'ok', service: 'agent-cost', records: tracker.allRecords().length, uptime: process.uptime() });
    }

    // Record usage
    if (path === '/record' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.provider || !body.model || body.inputTokens == null || body.outputTokens == null) {
        return error(res, 'Missing required fields: provider, model, inputTokens, outputTokens');
      }
      const record = tracker.record(body.provider, body.model, body.inputTokens, body.outputTokens, body.metadata);
      return json(res, record, 201);
    }

    // Estimate
    if (path === '/estimate' && req.method === 'GET') {
      const provider = url.searchParams.get('provider');
      const model = url.searchParams.get('model');
      const inputTokens = parseInt(url.searchParams.get('inputTokens') || '0');
      const outputTokens = parseInt(url.searchParams.get('outputTokens') || '0');
      if (!provider || !model) return error(res, 'Missing provider or model');
      return json(res, tracker.estimate(provider, model, inputTokens, outputTokens));
    }

    // Cheapest
    if (path === '/cheapest' && req.method === 'GET') {
      const inputTokens = parseInt(url.searchParams.get('inputTokens') || '1000');
      const outputTokens = parseInt(url.searchParams.get('outputTokens') || '500');
      const provider = url.searchParams.get('provider') || undefined;
      const maxCost = url.searchParams.get('maxCost') ? parseFloat(url.searchParams.get('maxCost')) : undefined;
      const results = tracker.findCheapest(inputTokens, outputTokens, { provider, maxCost });
      return json(res, results.slice(0, 10));
    }

    // Stats
    if (path === '/stats' && req.method === 'GET') {
      const period = url.searchParams.get('period') || undefined;
      return json(res, tracker.stats(period as any));
    }

    // Budgets
    if (path === '/budgets' && req.method === 'GET') {
      return json(res, { config: tracker.getBudget(), status: tracker.budgetStatus() });
    }

    // Set budget
    if (path === '/budget' && req.method === 'POST') {
      const body = await parseBody(req);
      tracker.setBudget(body);
      return json(res, { ok: true, budget: tracker.getBudget() });
    }

    // Recent records
    if (path === '/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      return json(res, tracker.recent(limit));
    }

    // Add pricing
    if (path === '/pricing' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.provider || !body.model || body.inputPer1k == null || body.outputPer1k == null) {
        return error(res, 'Missing fields: provider, model, inputPer1k, outputPer1k');
      }
      tracker.addPricing(body.provider, body.model, body.inputPer1k, body.outputPer1k);
      return json(res, { ok: true });
    }

    // List models
    if (path === '/models' && req.method === 'GET') {
      const provider = url.searchParams.get('provider') || undefined;
      return json(res, tracker.listModels(provider));
    }

    // Export CSV
    if (path === '/export' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="cost-export.csv"' });
      return res.end(tracker.toCSV());
    }

    // Clear
    if (path === '/records' && req.method === 'DELETE') {
      tracker.clear();
      return json(res, { ok: true, cleared: true });
    }

    // Dashboard
    if (path === '/' || path === '/dashboard') {
      const stats = tracker.stats();
      const budgets = tracker.budgetStatus();
      const recent = tracker.recent(10);
      const html = renderDashboard(stats, budgets, recent);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    error(res, 'Not found', 404);
  } catch (e) {
    error(res, e.message, 500);
  }
});

server.listen(PORT, () => {
  console.log(`💰 agent-cost server running on http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/`);
  console.log(`   Data dir:  ${DATA_DIR}`);
});

// ─── Dashboard HTML ──────────────────────────────────────────────────

function renderDashboard(stats, budgets, recent) {
  const fmt = (n) => '$' + (n || 0).toFixed(6);
  const fmtD = (n) => '$' + (n || 0).toFixed(2);
  const ago = (ts) => {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d/60000) + 'm ago';
    if (d < 86400000) return Math.floor(d/3600000) + 'h ago';
    return Math.floor(d/86400000) + 'd ago';
  };

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-cost</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0f1117;color:#e0e0e0;padding:20px}
h1{font-size:24px;margin-bottom:20px;color:#f0f0f0}
h1 span{color:#fbbf24}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.card{background:#1a1d27;border-radius:8px;padding:16px;border:1px solid #2a2d37}
.card .label{font-size:12px;color:#888;text-transform:uppercase;margin-bottom:4px}
.card .value{font-size:22px;font-weight:600}
.card .value.green{color:#34d399}.card .value.yellow{color:#fbbf24}.card .value.red{color:#ef4444}.card .value.blue{color:#60a5fa}
.budget-bar{height:6px;background:#2a2d37;border-radius:3px;margin-top:8px;overflow:hidden}
.budget-bar .fill{height:100%;border-radius:3px;transition:width .3s}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #2a2d37;font-size:13px}
th{color:#888;text-transform:uppercase;font-size:11px}
.tag{display:inline-block;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600}
.tag.openai{background:#10b98133;color:#10b981}.tag.anthropic{background:#8b5cf633;color:#8b5cf6}
.tag.google{background:#3b82f633;color:#3b82f6}.tag.mistral{background:#f9731633;color:#f97316}
.tag.deepseek{background:#06b6d433;color:#06b6d4}.tag.groq{background:#eab30833;color:#eab308}
.tag.xai{background:#ec489933;color:#ec4899}.tag.cohere{background:#14b8a633;color:#14b8a6}
.providers{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.providers .p{background:#1a1d27;padding:6px 12px;border-radius:6px;font-size:12px;border:1px solid #2a2d37}
.providers .p b{color:#fbbf24}
</style></head><body>
<h1>💰 <span>agent-cost</span> — AI Cost Tracker</h1>

<div class="cards">
  <div class="card"><div class="label">Total Requests</div><div class="value blue">${stats.totalRequests.toLocaleString()}</div></div>
  <div class="card"><div class="label">Total Tokens</div><div class="value blue">${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}</div></div>
  <div class="card"><div class="label">Total Cost</div><div class="value yellow">${fmtD(stats.totalCost)}</div></div>
  <div class="card"><div class="label">Avg Cost/Request</div><div class="value">${fmt(stats.avgCostPerRequest)}</div></div>
</div>

${budgets.length ? '<h2 style="margin-bottom:12px;font-size:16px">📊 Budgets</h2><div class="cards">' + budgets.map(b => {
  const color = b.percentUsed > 90 ? 'red' : b.percentUsed > 70 ? 'yellow' : 'green';
  return `<div class="card"><div class="label">${b.period} Budget</div><div class="value ${color}">${fmtD(b.spent)} / ${fmtD(b.limit)}</div><div class="budget-bar"><div class="fill" style="width:${Math.min(b.percentUsed,100)}%;background:var(--c,${color === 'red' ? '#ef4444' : color === 'yellow' ? '#fbbf24' : '#34d399'})"></div></div><div style="font-size:11px;color:#888;margin-top:4px">${b.percentUsed}% used · Projected: ${fmtD(b.projectedEnd)}</div></div>`;
}).join('') + '</div>' : ''}

${Object.keys(stats.byProvider).length ? '<h2 style="margin:16px 0 8px;font-size:16px">📡 By Provider</h2><div class="providers">' + Object.entries(stats.byProvider).map(([p, s]) => `<div class="p"><span class="tag ${p}">${p}</span> <b>${fmtD(s.cost)}</b> · ${s.requests} req</div>`).join('') + '</div>' : ''}

<h2 style="margin:20px 0 8px;font-size:16px">📝 Recent Requests</h2>
<table>
<thead><tr><th>Time</th><th>Provider</th><th>Model</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th></tr></thead>
<tbody>
${recent.map(r => `<tr><td>${ago(r.timestamp)}</td><td><span class="tag ${r.provider}">${r.provider}</span></td><td>${r.model}</td><td>${r.inputTokens.toLocaleString()}</td><td>${r.outputTokens.toLocaleString()}</td><td>${fmt(r.totalCost)}</td></tr>`).join('')}
${recent.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#888">No records yet. POST /record to start tracking.</td></tr>' : ''}
</tbody></table>
<p style="margin-top:20px;font-size:11px;color:#666">agent-cost v1.0 · Auto-refreshes every 10s</p>
<script>setTimeout(()=>location.reload(),10000)</script>
</body></html>`;
}
