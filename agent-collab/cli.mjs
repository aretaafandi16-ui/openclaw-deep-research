#!/usr/bin/env node
/**
 * agent-collab CLI — multi-agent collaboration from the terminal
 */
import { CollabEngine, ROLES, STATUS, STRATEGIES } from './index.mjs';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const engine = new CollabEngine({ dataDir: '/tmp/agent-collab' });
await engine.load();

const [cmd, ...rest] = process.argv.slice(2);
const arg = Object.fromEntries(rest.filter(a => a.includes('=')).map(a => { const [k, ...v] = a.split('='); return [k.replace(/^--/, ''), v.join('=')]; }));
const positional = rest.filter(a => !a.includes('='));

function out(data) { console.log(JSON.stringify(data, null, 2)); }
function err(msg) { console.error(`Error: ${msg}`); process.exit(1); }

switch (cmd) {
  case 'register': {
    const agent = engine.registerAgent({
      name: arg.name || positional[0] || 'unnamed',
      role: arg.role || ROLES.WORKER,
      capabilities: arg.capabilities ? arg.capabilities.split(',') : [],
      maxConcurrent: parseInt(arg.max) || 3,
    });
    await engine.save();
    out(agent.toJSON());
    break;
  }
  case 'unregister': {
    const id = arg.id || positional[0];
    if (!id) err('Usage: unregister --id=<agentId>');
    engine.unregisterAgent(id);
    await engine.save();
    out({ success: true });
    break;
  }
  case 'agents': {
    out(engine.listAgents({ role: arg.role || null, available: arg.available ? arg.available === 'true' : null }));
    break;
  }
  case 'task': {
    const task = engine.createTask({
      type: arg.type || positional[0] || 'default',
      payload: arg.payload ? JSON.parse(arg.payload) : {},
      priority: parseInt(arg.priority) || 5,
      requires: arg.requires ? arg.requires.split(',') : [],
    });
    await engine.save();
    out(task.toJSON());
    break;
  }
  case 'assign': {
    const taskId = arg.task || positional[0];
    const agentId = arg.agent || positional[1];
    if (!taskId || !agentId) err('Usage: assign --task=<taskId> --agent=<agentId>');
    const task = engine.assignTask(taskId, agentId);
    await engine.save();
    out(task.toJSON());
    break;
  }
  case 'auto': {
    const taskId = arg.task || positional[0];
    if (!taskId) err('Usage: auto --task=<taskId> [--strategy=<strategy>]');
    const result = engine.autoAssign(taskId, arg.strategy || STRATEGIES.LEAST_LOADED);
    await engine.save();
    out(result ? result.toJSON() : { error: 'No available agent' });
    break;
  }
  case 'start': {
    const taskId = arg.task || positional[0];
    engine.startTask(taskId);
    await engine.save();
    out(engine.getTask(taskId));
    break;
  }
  case 'done': {
    const taskId = arg.task || positional[0];
    engine.completeTask(taskId, arg.result ? JSON.parse(arg.result) : null);
    await engine.save();
    out(engine.getTask(taskId));
    break;
  }
  case 'fail': {
    const taskId = arg.task || positional[0];
    engine.failTask(taskId, arg.error || 'unknown');
    await engine.save();
    out(engine.getTask(taskId));
    break;
  }
  case 'cancel': {
    const taskId = arg.task || positional[0];
    engine.cancelTask(taskId);
    await engine.save();
    out(engine.getTask(taskId));
    break;
  }
  case 'tasks': {
    out(engine.listTasks({ status: arg.status || null, assignedTo: arg.agent || null, type: arg.type || null }));
    break;
  }
  case 'msg': {
    const msg = engine.sendMessage(
      arg.from || positional[0],
      arg.to || positional[1],
      arg.content || positional[2] || '',
      { type: arg.type || 'info' }
    );
    await engine.save();
    out(msg);
    break;
  }
  case 'messages': {
    out(engine.getMessages({ agentId: arg.agent || null, since: arg.since ? parseInt(arg.since) : null, type: arg.type || null }));
    break;
  }
  case 'broadcast': {
    const msgs = engine.broadcast(arg.from || positional[0], arg.content || positional[1] || '');
    await engine.save();
    out({ sent: msgs.length });
    break;
  }
  case 'stats': {
    out(engine.stats());
    break;
  }
  case 'demo': {
    // Run a quick demo
    console.log('🐋 agent-collab demo\n');
    const coord = engine.registerAgent({ name: 'coordinator', role: ROLES.COORDINATOR, capabilities: ['planning'] });
    const w1 = engine.registerAgent({ name: 'coder', role: ROLES.WORKER, capabilities: ['python', 'testing'] });
    const w2 = engine.registerAgent({ name: 'reviewer', role: ROLES.SPECIALIST, capabilities: ['review', 'python'] });
    console.log('Registered 3 agents:', engine.listAgents().map(a => `${a.name} (${a.role})`).join(', '));

    const parent = engine.createTask({ type: 'build-feature', payload: { feature: 'auth' } });
    console.log('\nCreated parent task:', parent.id.slice(0, 8));

    const subs = engine.delegate(parent.id, [
      { type: 'implement', payload: { module: 'auth' }, requires: ['python'] },
      { type: 'test', payload: { module: 'auth' }, requires: ['testing'] },
      { type: 'review', payload: { module: 'auth' }, requires: ['review'] },
    ]);
    console.log('Delegated subtasks:', subs.map(s => `${s.task.type} → ${engine.getAgent(s.task.assignedTo)?.name}`).join(', '));

    engine.sendMessage(coord.id, w1.id, 'Please implement the auth module');
    engine.sendMessage(w1.id, coord.id, 'Done! Ready for review', { type: 'status' });
    engine.broadcast(coord.id, 'Sprint update: auth module in review');

    // Complete tasks
    for (const s of subs) {
      engine.startTask(s.task.id);
      engine.completeTask(s.task.id, { status: 'ok' });
    }
    engine.completeTask(parent.id, { feature: 'auth', status: 'shipped' });

    console.log('\nStats:', JSON.stringify(engine.stats(), null, 2));
    console.log('\nMessages:');
    for (const m of engine.getMessages()) {
      console.log(`  ${engine.getAgent(m.from)?.name || m.from} → ${engine.getAgent(m.to)?.name || m.to}: ${m.content}`);
    }
    await engine.save();
    break;
  }
  case 'serve': {
    const port = parseInt(arg.port) || 3132;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      res.setHeader('Content-Type', 'application/json');
      try {
        if (url.pathname === '/api/stats') { res.end(JSON.stringify(engine.stats())); }
        else if (url.pathname === '/api/agents') { res.end(JSON.stringify(engine.listAgents())); }
        else if (url.pathname === '/api/tasks') { res.end(JSON.stringify(engine.listTasks())); }
        else if (url.pathname === '/api/messages') { res.end(JSON.stringify(engine.getMessages())); }
        else { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); }
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    server.listen(port, () => console.log(`agent-collab server on :${port}`));
    break;
  }
  case 'help':
  default:
    console.log(`
agent-collab CLI — Multi-agent collaboration

Commands:
  register --name=<n> [--role=worker] [--capabilities=a,b] [--max=3]
  unregister --id=<agentId>
  agents [--role=<r>] [--available=true|false]
  task --type=<t> [--payload='{}'] [--priority=5] [--requires=a,b]
  assign --task=<id> --agent=<id>
  auto --task=<id> [--strategy=least_loaded]
  start --task=<id>
  done --task=<id> [--result='{}']
  fail --task=<id> [--error='msg']
  cancel --task=<id>
  tasks [--status=<s>] [--agent=<id>] [--type=<t>]
  msg --from=<id> --to=<id> --content=<msg>
  messages [--agent=<id>] [--since=<ts>] [--type=<t>]
  broadcast --from=<id> --content=<msg>
  stats
  demo
  serve [--port=3132]
  help
    `);
}
