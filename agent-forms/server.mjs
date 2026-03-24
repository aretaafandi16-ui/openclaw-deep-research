// agent-forms/server.mjs — HTTP server with REST API + dark-theme web dashboard
import { createServer } from 'node:http';
import { FormEngine } from './index.mjs';

const PERSIST = process.env.AGENT_FORMS_DATA || '/tmp/agent-forms-data';
const engine = new FormEngine({ persistPath: PERSIST });

const PORT = parseInt(process.env.PORT) || 3127;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

async function parseBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return {}; }
}

const dashboard = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agent-forms Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card h3{color:#8b949e;font-size:12px;text-transform:uppercase;margin-bottom:4px}
.card .val{color:#58a6ff;font-size:28px;font-weight:bold}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #30363d}
th{color:#8b949e;font-size:12px;text-transform:uppercase}
td{font-size:14px}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge-submitted{background:#1f6feb22;color:#58a6ff}
.badge-draft{background:#d2992222;color:#d29922}
input,select,textarea{background:#0d1117;color:#c9d1d9;border:1px solid #30363d;padding:6px 10px;border-radius:4px;width:100%;margin:4px 0}
button{background:#238636;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;margin:4px}
button:hover{background:#2ea043}
.section{margin-top:24px}
.section h2{color:#58a6ff;margin-bottom:12px;font-size:18px}
form{display:flex;flex-direction:column;gap:8px;max-width:500px}
.prompt{background:#161b22;border-left:3px solid #58a6ff;padding:12px;margin:8px 0;border-radius:0 4px 4px 0;white-space:pre-wrap}
</style></head><body>
<h1>📋 agent-forms Dashboard</h1>
<div class="grid" id="stats"></div>
<div class="section"><h2>Forms</h2><div id="forms"></div></div>
<div class="section"><h2>Create Form</h2>
<form id="createForm">
  <input name="name" placeholder="Form name" required>
  <textarea name="description" placeholder="Description" rows="2"></textarea>
  <textarea name='fields' placeholder='Fields JSON array, e.g. [{"name":"email","type":"email","validation":{"required":true}}]' rows="4"></textarea>
  <button type="submit">Create Form</button>
</form></div>
<div class="section"><h2>Chat-Style Form Fill</h2>
<div id="chatArea"></div>
<div id="chatForm" style="display:none;margin-top:12px">
  <select id="chatFormSelect"></select>
  <button onclick="startChat()">Start Chat</button>
</div></div>
<div class="section"><h2>Responses</h2><div id="responses"></div></div>
<script>
const API='';
async function api(path,body){
  const opts=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{};
  return(await fetch(API+path,opts)).json();
}
async function refresh(){
  const stats=await api('/api/stats');
  document.getElementById('stats').innerHTML=\`
    <div class="card"><h3>Forms</h3><div class="val">\${stats.forms}</div></div>
    <div class="card"><h3>Total Responses</h3><div class="val">\${stats.totalResponses}</div></div>\`;
  const {forms}=await api('/api/forms');
  let fh='<table><tr><th>ID</th><th>Name</th><th>Fields</th><th>Actions</th></tr>';
  for(const f of forms) fh+=\`<tr><td>\${f.id.slice(0,12)}…</td><td>\${f.name}</td><td>\${f.fields.length}</td>
    <td><button onclick="viewForm('\${f.id}')">View</button>
    <button onclick="loadResponses('\${f.id}')">Responses</button>
    <button onclick="deleteForm('\${f.id}')">Delete</button></td></tr>\`;
  document.getElementById('forms').innerHTML=fh+'</table>';
  // Populate chat select
  const sel=document.getElementById('chatFormSelect');
  sel.innerHTML=forms.map(f=>\`<option value="\${f.id}">\${f.name}</option>\`).join('');
  document.getElementById('chatForm').style.display=forms.length?'block':'none';
}
async function viewForm(id){
  const form=await api('/api/forms/'+id);
  alert(JSON.stringify(form,null,2));
}
async function loadResponses(id){
  const {responses}=await api('/api/forms/'+id+'/responses');
  let h='<table><tr><th>ID</th><th>Status</th><th>Submitted</th><th>Data</th></tr>';
  for(const r of responses) h+=\`<tr><td>\${r.id.slice(0,10)}…</td>
    <td><span class="badge badge-\${r.status}">\${r.status}</span></td>
    <td>\${r.submittedAt||'-'}</td><td><pre>\${JSON.stringify(r.data,null,1)}</pre></td></tr>\`;
  document.getElementById('responses').innerHTML=h+'</table>';
}
async function deleteForm(id){if(confirm('Delete?')){await api('/api/forms/'+id+'/delete',{});refresh();}}
// Chat-style fill
let chatState=null;
async function startChat(){
  const formId=document.getElementById('chatFormSelect').value;
  const resp=await api('/api/forms/'+formId+'/start',{});
  chatState={formId,responseId:resp.id};
  document.getElementById('chatArea').innerHTML='<div class="prompt">Form started! Let me ask you the questions one by one.</div>';
  askNext();
}
async function askNext(){
  if(!chatState)return;
  const next=await api(\`/api/forms/\${chatState.formId}/responses/\${chatState.responseId}/next\`);
  if(!next.field){
    const sub=await api(\`/api/forms/\${chatState.formId}/responses/\${chatState.responseId}/submit\`,{});
    document.getElementById('chatArea').innerHTML+=\`<div class="prompt" style="border-color:#238636">✅ Form submitted successfully!</div>\`;
    refresh();return;
  }
  let optionsHtml='';
  if(next.field.options && next.field.options.length){
    optionsHtml='<div style="margin-top:8px">'+next.field.options.map(o=>{
      const v=typeof o==='string'?o:o.value;const l=typeof o==='string'?o:(o.label||o.value);
      return \`<button onclick="fillChat('\${v}')">\${l}</button>\`;
    }).join('')+'</div>';
  }
  document.getElementById('chatArea').innerHTML+=\`<div class="prompt">\${next.prompt}\${optionsHtml}
    <div style="margin-top:8px"><input id="chatInput" placeholder="Your answer..." onkeydown="if(event.key==='Enter')fillChat(this.value)">
    <button onclick="fillChat(document.getElementById('chatInput').value)">Send</button></div></div>\`;
  document.getElementById('chatInput')?.focus();
}
async function fillChat(val){
  if(!chatState||!val)return;
  await api(\`/api/forms/\${chatState.formId}/responses/\${chatState.responseId}/fill\`,{field:document.getElementById('chatArea').querySelectorAll('.prompt:last-of-type input')?.[0]?.placeholder?Object.keys(chatState).slice(-1)[0]:'',value:val});
  document.getElementById('chatArea').innerHTML+=\`<div style="text-align:right;color:#58a6ff;margin:4px 0">→ \${val}</div>\`;
  document.querySelectorAll('#chatArea .prompt:last-child input,#chatArea .prompt:last-child button').forEach(el=>el.disabled=true);
  askNext();
}
document.getElementById('createForm').onsubmit=async e=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const fields=fd.get('fields')?JSON.parse(fd.get('fields')):[{name:'default',type:'text'}];
  await api('/api/forms',{name:fd.get('name'),description:fd.get('description'),fields});
  e.target.reset();refresh();
};
refresh();setInterval(refresh,10000);
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // Dashboard
    if (path === '/' || path === '/dashboard') return html(res, dashboard);

    // API routes
    if (path === '/api/stats') return json(res, engine.stats());
    if (path === '/api/forms' && req.method === 'GET') return json(res, { forms: engine.listForms().map(f => f.toJSON()) });
    if (path === '/api/forms' && req.method === 'POST') {
      const body = await parseBody(req);
      const form = engine.createForm(body);
      return json(res, form.toJSON(), 201);
    }

    const formMatch = path.match(/^\/api\/forms\/([^/]+)$/);
    if (formMatch && req.method === 'GET') return json(res, engine.getForm(formMatch[1]).toJSON());

    const deleteMatch = path.match(/^\/api\/forms\/([^/]+)\/delete$/);
    if (deleteMatch && req.method === 'POST') { engine.deleteForm(deleteMatch[1]); return json(res, { deleted: true }); }

    const startMatch = path.match(/^\/api\/forms\/([^/]+)\/start$/);
    if (startMatch && req.method === 'POST') { const r = engine.startResponse(startMatch[1]); return json(res, { id: r.id, formId: r.formId, status: r.status }); }

    const fillMatch = path.match(/^\/api\/forms\/([^/]+)\/responses\/([^/]+)\/fill$/);
    if (fillMatch && req.method === 'POST') {
      const body = await parseBody(req);
      engine.fillField(fillMatch[1], fillMatch[2], body.field, body.value);
      return json(res, { filled: true });
    }

    const nextMatch = path.match(/^\/api\/forms\/([^/]+)\/responses\/([^/]+)\/next$/);
    if (nextMatch) return json(res, engine.getNextField(nextMatch[1], nextMatch[2]) || { complete: true });

    const validateMatch = path.match(/^\/api\/forms\/([^/]+)\/responses\/([^/]+)\/validate$/);
    if (validateMatch) return json(res, engine.validateResponse(validateMatch[1], validateMatch[2]));

    const submitMatch = path.match(/^\/api\/forms\/([^/]+)\/responses\/([^/]+)\/submit$/);
    if (submitMatch && req.method === 'POST') return json(res, engine.submitResponse(submitMatch[1], submitMatch[2]));

    const progressMatch = path.match(/^\/api\/forms\/([^/]+)\/responses\/([^/]+)\/progress$/);
    if (progressMatch) return json(res, engine.getProgress(progressMatch[1], progressMatch[2]));

    const respMatch = path.match(/^\/api\/forms\/([^/]+)\/responses$/);
    if (respMatch) return json(res, { responses: engine.getFormResponses(respMatch[1]).map(r => r.toJSON()) });

    const aggMatch = path.match(/^\/api\/forms\/([^/]+)\/aggregate\/([^/]+)$/);
    if (aggMatch) return json(res, engine.aggregate(aggMatch[1], aggMatch[2]));

    const csvMatch = path.match(/^\/api\/forms\/([^/]+)\/export.csv$/);
    if (csvMatch) { res.writeHead(200, { 'Content-Type': 'text/csv' }); return res.end(engine.exportCSV(csvMatch[1])); }

    const jsonMatch = path.match(/^\/api\/forms\/([^/]+)\/export.json$/);
    if (jsonMatch) return json(res, engine.exportJSON(jsonMatch[1]));

    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`agent-forms dashboard: http://localhost:${PORT}`));

export default (port) => { server.listen(port || PORT); };
