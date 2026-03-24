#!/usr/bin/env node
/**
 * agent-events CLI
 */
import { EventStore, ProjectionEngine, SagaEngine } from './index.mjs';
import { createServer } from 'http';

const [,, cmd, ...args] = process.argv;
const dir = process.env.EVENTS_DIR || '.agent-events';

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[i + 1] || true;
      if (opts[key] !== true) i++;
    }
  }
  return opts;
}

const HELP = `
agent-events — Zero-dep event sourcing & saga engine for AI agents

Commands:
  append <stream> <type> [json]   Append event to stream
  get <stream>                    Get all events from a stream
  all                             Get all events across streams
  by-type <type>                  Get events by type
  by-correlation <id>             Get events by correlation ID
  snapshot <id> <state_json> <v>  Save aggregate snapshot
  get-snapshot <id>               Get aggregate snapshot
  streams                         List all streams
  delete-stream <id>              Delete a stream
  stats                           Show store statistics
  demo                            Run interactive demo
  serve [--port 3131]             Start HTTP server
  mcp                             Start MCP server (stdio)
  help                            Show this help

Options:
  --dir <path>    Data directory (default: .agent-events)
  --no-persist    Disable disk persistence
`;

const store = new EventStore({ dir, persist: cmd !== 'demo' });

switch (cmd) {
  case 'append': {
    const [streamId, type, jsonStr] = args;
    if (!streamId || !type) { console.error('Usage: append <streamId> <eventType> [jsonPayload]'); process.exit(1); }
    const payload = jsonStr ? JSON.parse(jsonStr) : {};
    const event = store.append(streamId, type, payload);
    console.log(JSON.stringify(event, null, 2));
    break;
  }
  case 'get': {
    const [streamId] = args;
    if (!streamId) { console.error('Usage: get <streamId>'); process.exit(1); }
    console.log(JSON.stringify(store.getStream(streamId), null, 2));
    break;
  }
  case 'all': {
    console.log(JSON.stringify(store.getAllEvents(), null, 2));
    break;
  }
  case 'by-type': {
    const [type] = args;
    if (!type) { console.error('Usage: by-type <eventType>'); process.exit(1); }
    console.log(JSON.stringify(store.getByType(type), null, 2));
    break;
  }
  case 'by-correlation': {
    const [cid] = args;
    if (!cid) { console.error('Usage: by-correlation <correlationId>'); process.exit(1); }
    console.log(JSON.stringify(store.getByCorrelation(cid), null, 2));
    break;
  }
  case 'snapshot': {
    const [id, stateJson, version] = args;
    if (!id || !stateJson) { console.error('Usage: snapshot <id> <stateJson> <version>'); process.exit(1); }
    console.log(JSON.stringify(store.saveSnapshot(id, JSON.parse(stateJson), parseInt(version) || 0), null, 2));
    break;
  }
  case 'get-snapshot': {
    const [id] = args;
    if (!id) { console.error('Usage: get-snapshot <id>'); process.exit(1); }
    console.log(JSON.stringify(store.getSnapshot(id), null, 2));
    break;
  }
  case 'streams': {
    console.log(JSON.stringify(store.listStreams()));
    break;
  }
  case 'delete-stream': {
    const [id] = args;
    if (!id) { console.error('Usage: delete-stream <id>'); process.exit(1); }
    store.deleteStream(id);
    console.log(`Deleted stream: ${id}`);
    break;
  }
  case 'stats': {
    console.log(JSON.stringify(store.stats(), null, 2));
    break;
  }
  case 'serve': {
    const opts = parseArgs(args);
    const port = parseInt(opts.port) || 3131;
    startServer(port);
    break;
  }
  case 'mcp': {
    import('./mcp-server.mjs');
    break;
  }
  case 'demo': {
    runDemo();
    break;
  }
  default:
    console.log(HELP);
}

function runDemo() {
  console.log('🐋 agent-events demo\n');
  const demoStore = new EventStore({ persist: false });

  // Event sourcing
  console.log('📦 Event Sourcing:');
  demoStore.append('order-001', 'OrderCreated', { items: ['widget'], total: 100 });
  demoStore.append('order-001', 'OrderPaid', { method: 'card', amount: 100 });
  demoStore.append('order-001', 'OrderShipped', { tracking: 'UPS-123' });
  console.log(`  Stream 'order-001': ${demoStore.getStream('order-001').length} events`);

  // Aggregate state via reducer
  const reducer = (s, e) => {
    if (e.type === 'OrderCreated') return { ...s, status: 'created', total: e.payload.total };
    if (e.type === 'OrderPaid') return { ...s, status: 'paid' };
    if (e.type === 'OrderShipped') return { ...s, status: 'shipped', tracking: e.payload.tracking };
    return s;
  };
  const state = demoStore.getAggregateState('order-001', reducer, {});
  console.log(`  Aggregate state: ${JSON.stringify(state)}`);

  // Projections
  console.log('\n📊 Projections:');
  const proj = new ProjectionEngine(demoStore, { persist: false });
  proj.define('revenue', { total: 0, orders: 0 }, {
    'OrderCreated': (s) => ({ ...s, orders: s.orders + 1 }),
    'OrderPaid': (s, e) => ({ ...s, total: s.total + e.payload.amount })
  });
  console.log(`  Revenue projection: ${JSON.stringify(proj.getState('revenue'))}`);

  // Saga
  console.log('\n🔗 Saga (success):');
  const sagaEng = new SagaEngine(demoStore, { persist: false });
  sagaEng.define('checkout', {
    steps: [
      { id: 'validate', action: async () => ({ valid: true }) },
      { id: 'charge', action: async () => ({ charged: true }), compensate: async () => console.log('  ↩ Refunded!') },
      { id: 'notify', action: async () => ({ notified: true }) }
    ]
  });
  sagaEng.start('checkout', { userId: 'u1' }).then(inst => {
    console.log(`  Status: ${inst.status}, Steps: ${Object.keys(inst.results).join(', ')}`);

    // Saga with failure
    console.log('\n🔗 Saga (failure + compensation):');
    sagaEng.define('riskyCheckout', {
      steps: [
        { id: 'step1', action: async () => 'ok', compensate: async () => console.log('  ↩ Compensated step1') },
        { id: 'step2', action: async () => { throw new Error('payment failed'); } }
      ]
    });
    sagaEng.start('riskyCheckout', {}).then(failed => {
      console.log(`  Status: ${failed.status}, Errors: ${failed.errors.map(e => e.error).join(', ')}`);

      // Correlation
      console.log('\n🔗 Correlation Tracking:');
      demoStore.append('audit', 'CheckoutStarted', { userId: 'u1' }, { correlationId: 'corr-1' });
      demoStore.append('audit', 'CheckoutCompleted', { userId: 'u1' }, { correlationId: 'corr-1' });
      const corr = demoStore.getByCorrelation('corr-1');
      console.log(`  Events with correlation 'corr-1': ${corr.length}`);

      // Stats
      console.log('\n📈 Stats:');
      console.log(`  ${JSON.stringify(demoStore.stats(), null, 2)}`);
      console.log('\n✅ Demo complete!');
    });
  });
}

function startServer(port) {
  const html = getDashboardHtml();
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
    }
    if (url.pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.stats())); return;
    }
    if (url.pathname === '/api/streams') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.listStreams())); return;
    }
    if (url.pathname.startsWith('/api/stream/')) {
      const streamId = decodeURIComponent(url.pathname.slice(12));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.getStream(streamId))); return;
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.getAllEvents())); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/append') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { streamId, eventType, payload, correlationId } = JSON.parse(body);
          const event = store.append(streamId, eventType, payload || {}, { correlationId });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(event));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end('Not found');
  });
  server.listen(port, () => console.log(`🐋 agent-events dashboard: http://localhost:${port}/dashboard`));
}

function getDashboardHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-events</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;color:#c9d1d9;font-family:system-ui;padding:20px}
h1{color:#58a6ff;margin-bottom:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;text-align:center}
.card .num{font-size:28px;font-weight:700;color:#58a6ff}.card .lbl{font-size:12px;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;border:1px solid #30363d;text-align:left;font-size:13px}
th{background:#161b22;color:#58a6ff;font-weight:600}tr:nth-child(even){background:#161b22}
.tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.tag-create{background:#238636}.tag-update{background:#1f6feb}.tag-delete{background:#da3633}
button{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px}
button:hover{background:#2ea043}
input,textarea,select{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:6px;font-size:13px;width:100%}
.form{display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;align-items:center;margin-bottom:20px}
.form label{font-size:12px;color:#8b949e}
</style></head><body>
<h1>🐋 agent-events — Event Store Dashboard</h1>
<div class="cards" id="cards"></div>
<h2 style="color:#58a6ff;margin:16px 0 8px">Append Event</h2>
<div class="form">
  <input id="f-stream" placeholder="streamId"><input id="f-type" placeholder="eventType">
  <input id="f-payload" placeholder='{"key":"value"}'><button onclick="appendEvent()">Append</button>
</div>
<h2 style="color:#58a6ff;margin:16px 0 8px">Streams</h2>
<div id="streams"></div>
<h2 style="color:#58a6ff;margin:16px 0 8px">Recent Events</h2>
<table><thead><tr><th>Seq</th><th>Stream</th><th>Type</th><th>Version</th><th>Time</th><th>Payload</th></tr></thead><tbody id="events"></tbody></table>
<script>
async function load(){
  const stats=await(await fetch('/api/stats')).json();
  document.getElementById('cards').innerHTML=
    '<div class="card"><div class="num">'+stats.streams+'</div><div class="lbl">Streams</div></div>'+
    '<div class="card"><div class="num">'+stats.totalEvents+'</div><div class="lbl">Total Events</div></div>'+
    '<div class="card"><div class="num">'+stats.snapshots+'</div><div class="lbl">Snapshots</div></div>'+
    '<div class="card"><div class="num">'+stats.subscriptions+'</div><div class="lbl">Subscriptions</div></div>';
  const streams=await(await fetch('/api/streams')).json();
  document.getElementById('streams').innerHTML='<table><tr><th>Stream</th><th>Events</th></tr>'+
    streams.map(s=>'<tr><td>'+s+'</td><td>—</td></tr>').join('')+'</table>';
  const events=await(await fetch('/api/events')).json();
  document.getElementById('events').innerHTML=events.slice(-50).reverse().map(e=>
    '<tr><td>'+e.seq+'</td><td>'+e.streamId+'</td><td><span class="tag tag-create">'+e.type+'</span></td><td>v'+e.version+'</td><td>'+new Date(e.timestamp).toLocaleTimeString()+'</td><td><code>'+JSON.stringify(e.payload).slice(0,60)+'</code></td></tr>'
  ).join('');
}
async function appendEvent(){
  const streamId=document.getElementById('f-stream').value;
  const eventType=document.getElementById('f-type').value;
  const payloadStr=document.getElementById('f-payload').value;
  if(!streamId||!eventType)return;
  let payload={};try{payload=JSON.parse(payloadStr||'{}')}catch{}
  await fetch('/api/append',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({streamId,eventType,payload})});
  document.getElementById('f-stream').value='';document.getElementById('f-type').value='';document.getElementById('f-payload').value='';
  load();
}
load();setInterval(load,5000);
</script></body></html>`;
}
