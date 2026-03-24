#!/usr/bin/env node
/**
 * agent-clock HTTP Server — Dark-theme dashboard + REST API
 */
import { createServer } from 'http';
import { AgentClock, parseDuration, formatDuration, parseNaturalTime, parseSchedule, nextOccurrence } from './index.mjs';

export function startServer(port = 3134) {
  const clock = new AgentClock({
    calendars: ['us'],
    persistencePath: process.env.AGENT_CLOCK_PERSIST || '.agent-clock-state.json',
    logPath: process.env.AGENT_CLOCK_LOG || '.agent-clock-log.jsonl',
  });

  const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>agent-clock</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
  h1{color:#58a6ff;margin-bottom:20px}
  h2{color:#8b949e;margin:20px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:1px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-bottom:24px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px}
  .card .label{color:#8b949e;font-size:12px;text-transform:uppercase}
  .card .value{font-size:28px;font-weight:700;color:#58a6ff;margin:8px 0}
  .card .sub{color:#8b949e;font-size:13px}
  table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
  th,td{padding:10px 16px;text-align:left;border-bottom:1px solid #30363d}
  th{background:#1c2128;color:#8b949e;font-size:12px;text-transform:uppercase}
  td{font-size:14px}
  .overdue{color:#f85149;font-weight:600}
  .ok{color:#3fb950}
  input,select,button{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:14px}
  button{background:#238636;color:#fff;cursor:pointer;border:none;font-weight:600}
  button:hover{background:#2ea043}
  .form{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
  #result{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:12px 0;font-family:monospace;white-space:pre-wrap;display:none}
</style></head><body>
<h1>🕐 agent-clock</h1>
<div class="grid" id="cards"></div>
<h2>⏱️ Duration Calculator</h2>
<div class="form">
  <input id="dur-expr" placeholder="e.g. 3 days, 2h 30m" style="flex:1">
  <button onclick="calcDuration()">Calculate</button>
</div>
<div id="dur-result"></div>
<h2>📅 Parse Natural Time</h2>
<div class="form">
  <input id="nl-expr" placeholder="e.g. tomorrow, in 2 weeks, next monday" style="flex:1">
  <button onclick="parseTime()">Parse</button>
</div>
<div id="nl-result"></div>
<h2>🎯 Deadlines</h2>
<div class="form">
  <input id="dl-name" placeholder="Name">
  <input id="dl-due" type="datetime-local">
  <input id="dl-alert" placeholder="Alert before (e.g. 2 days)">
  <button onclick="addDeadline()">Add Deadline</button>
</div>
<table id="deadlines-table"><thead><tr><th>Name</th><th>Due</th><th>Remaining</th><th>Status</th><th>Action</th></tr></thead><tbody></tbody></table>
<h2>📆 Schedules</h2>
<div class="form">
  <input id="sched-expr" placeholder="e.g. daily at 09:00, every 5m" style="flex:2">
  <button onclick="addSchedule()">Add</button>
</div>
<table id="schedules-table"><thead><tr><th>Expression</th><th>Next Run</th><th>Runs</th><th>Status</th></tr></thead><tbody></tbody></table>
<h2>🔍 Quick Tools</h2>
<div class="form">
  <input id="bizday-date" type="date">
  <button onclick="checkBizday()">Check Business Day</button>
  <input id="bizdays-start" type="date" placeholder="Start">
  <input id="bizdays-end" type="date" placeholder="End">
  <button onclick="countBizdays()">Count Business Days</button>
</div>
<div id="quick-result"></div>
<div id="result"></div>
<script>
async function api(path,method='GET',body=null){
  const opts={method,headers:{'Content-Type':'application/json'}};
  if(body)opts.body=JSON.stringify(body);
  return(await fetch('/api'+path,opts)).json();
}
function formatMs(ms){
  if(ms<0)return'-'+formatMs(-ms);
  const d=Math.floor(ms/864e5);ms%=864e5;
  const h=Math.floor(ms/36e5);ms%=36e5;
  const m=Math.floor(ms/6e4);ms%=6e4;
  const s=Math.floor(ms/1e3);
  return[d&&d+'d',h&&h+'h',m&&m+'m',s&&s+'s'].filter(Boolean).join(' ')||'0s';
}
async function refresh(){
  const stats=await api('/stats');
  const cards=document.getElementById('cards');
  cards.innerHTML=\`
    <div class="card"><div class="label">Holidays</div><div class="value">\${stats.holidays}</div><div class="sub">loaded</div></div>
    <div class="card"><div class="label">Deadlines</div><div class="value">\${stats.deadlines.pending}</div><div class="sub">\${stats.deadlines.overdue} overdue</div></div>
    <div class="card"><div class="label">Schedules</div><div class="value">\${stats.schedules.active}</div><div class="sub">\${stats.schedules.totalRuns} total runs</div></div>
    <div class="card"><div class="label">Calendars</div><div class="value">\${stats.calendars}</div><div class="sub">loaded</div></div>\`;
  const dls=await api('/deadlines');
  const dtb=document.querySelector('#deadlines-table tbody');
  dtb.innerHTML=dls.deadlines.map(d=>\`<tr>
    <td>\${d.name}</td><td>\${new Date(d.due).toLocaleString()}</td>
    <td class="\${d.overdue?'overdue':'ok'}">\${d.formatted}</td>
    <td>\${d.status}</td>
    <td><button onclick="completeDl('\${d.id}')" style="padding:4px 8px;font-size:12px">✓ Done</button></td>
  </tr>\`).join('');
  const scheds=await api('/schedules');
  const stb=document.querySelector('#schedules-table tbody');
  stb.innerHTML=scheds.schedules.map(s=>\`<tr>
    <td>\${s.expr}</td><td>\${s.nextRun?new Date(s.nextRun).toLocaleString():'—'}</td>
    <td>\${s.runCount}</td><td>\${s.enabled?'✅ Active':'⏸ Paused'}</td>
  </tr>\`).join('');
}
async function calcDuration(){
  const expr=document.getElementById('dur-expr').value;
  try{const ms=await api('/parse-duration?expr='+encodeURIComponent(expr));
  document.getElementById('dur-result').innerHTML=\`<div class="card"><div class="label">Duration</div><div class="value">\${ms.formatted}</div><div class="sub">\${ms.ms}ms</div></div>\`;}catch(e){
  document.getElementById('dur-result').textContent='Error: '+e.message;}
}
async function parseTime(){
  const expr=document.getElementById('nl-expr').value;
  try{const r=await api('/parse?expr='+encodeURIComponent(expr));
  document.getElementById('nl-result').innerHTML=\`<div class="card"><div class="label">"\${expr}"</div><div class="value" style="font-size:18px">\${r.parsed}</div><div class="sub">\${r.formatted}</div></div>\`;}catch(e){
  document.getElementById('nl-result').textContent='Error: '+e.message;}
}
async function addDeadline(){
  const name=document.getElementById('dl-name').value;
  const due=document.getElementById('dl-due').value;
  const alert=document.getElementById('dl-alert').value;
  if(!name||!due)return;
  await api('/deadlines','POST',{name,due:due+'Z',alert_before:alert||undefined});
  refresh();
}
async function completeDl(id){await api('/deadlines/'+id+'/complete','POST');refresh();}
async function addSchedule(){
  const expr=document.getElementById('sched-expr').value;
  if(!expr)return;
  await api('/schedules','POST',{expression:expr});
  refresh();
}
async function checkBizday(){
  const d=document.getElementById('bizday-date').value;
  const r=await api('/business-day?date='+d);
  document.getElementById('quick-result').innerHTML=\`<div class="card"><div class="label">\${d}</div><div class="value">\${r.is_business_day?'✅ Business Day':'❌ Not Business Day'}</div><div class="sub">Next: \${r.next_business_day?.split('T')[0]}</div></div>\`;
}
async function countBizdays(){
  const s=document.getElementById('bizdays-start').value;
  const e=document.getElementById('bizdays-end').value;
  if(!s||!e)return;
  const r=await api('/business-days-between?start='+s+'&end='+e);
  document.getElementById('quick-result').innerHTML=\`<div class="card"><div class="label">Business Days</div><div class="value">\${r.business_days}</div><div class="sub">\${s} → \${e}</div></div>\`;
}
refresh();setInterval(refresh,5000);
</script></body></html>`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;
    
    const json = (data, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    };
    
    try {
      // Dashboard
      if (path === '/' || path === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(HTML);
      }
      
      // CORS
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        return res.end();
      }
      
      // REST API
      if (path === '/api/stats') return json(clock.stats());
      
      if (path === '/api/now') return json({ utc: new Date().toISOString(), local: clock.nowIn(url.searchParams.get('tz') || 'UTC') });
      
      if (path === '/api/parse') {
        const expr = url.searchParams.get('expr');
        if (!expr) return json({ error: 'expr required' }, 400);
        const d = parseNaturalTime(expr);
        return json({ parsed: d.toISOString(), formatted: d.toString(), expression: expr });
      }
      
      if (path === '/api/parse-duration') {
        const expr = url.searchParams.get('expr');
        if (!expr) return json({ error: 'expr required' }, 400);
        const ms = parseDuration(expr);
        return json({ ms, formatted: formatDuration(ms), expression: expr });
      }
      
      if (path === '/api/add') {
        const date = url.searchParams.get('date') || new Date().toISOString();
        const dur = url.searchParams.get('duration');
        if (!dur) return json({ error: 'duration required' }, 400);
        return json({ result: clock.add(date, dur).toISOString() });
      }
      
      if (path === '/api/business-day') {
        const date = url.searchParams.get('date') ? new Date(url.searchParams.get('date')) : new Date();
        return json({
          date: date.toISOString(),
          is_business_day: clock.isBusinessDay(date),
          next_business_day: clock.nextBusinessDay(date).toISOString(),
          prev_business_day: clock.prevBusinessDay(date).toISOString(),
        });
      }
      
      if (path === '/api/business-days-between') {
        const a = new Date(url.searchParams.get('start'));
        const b = new Date(url.searchParams.get('end'));
        return json({ business_days: clock.businessDaysBetween(a, b) });
      }
      
      if (path === '/api/add-business-days') {
        const date = new Date(url.searchParams.get('date'));
        const n = parseInt(url.searchParams.get('n'), 10);
        return json({ result: clock.addBusinessDays(date, n).toISOString() });
      }
      
      if (path === '/api/deadlines' && req.method === 'GET') {
        return json({ deadlines: clock.listDeadlines() });
      }
      
      if (path === '/api/deadlines' && req.method === 'POST') {
        const body = await readBody(req);
        const id = clock.addDeadline(body.name, body.due, { alertBefore: body.alert_before, businessDaysOnly: body.business_days_only });
        return json({ id, ...clock.timeUntilDeadline(id) });
      }
      
      const dlMatch = path.match(/^\/api\/deadlines\/(dl_\d+)\/complete$/);
      if (dlMatch && req.method === 'POST') {
        clock.completeDeadline(dlMatch[1]);
        return json({ ok: true });
      }
      
      if (path === '/api/schedules' && req.method === 'GET') {
        return json({ schedules: clock.listSchedules() });
      }
      
      if (path === '/api/schedules' && req.method === 'POST') {
        const body = await readBody(req);
        const parsed = parseSchedule(body.expression);
        const next = nextOccurrence(parsed, new Date());
        return json({ schedule: parsed, next_run: next.toISOString(), expression: body.expression });
      }
      
      if (path === '/api/holidays') {
        if (req.method === 'POST') {
          const body = await readBody(req);
          clock.addHoliday(body.date, body.name);
        }
        return json({ holidays: clock.getHolidays() });
      }
      
      json({ error: 'Not found' }, 404);
    } catch (err) {
      json({ error: err.message }, 400);
    }
  });
  
  server.listen(port, () => {
    console.log(`🕐 agent-clock dashboard: http://localhost:${port}`);
  });
  
  return { server, clock };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
  });
}

if (process.argv[1]?.endsWith('server.mjs')) {
  startServer(parseInt(process.env.PORT || '3134', 10));
}
