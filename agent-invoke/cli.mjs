#!/usr/bin/env node
/**
 * AgentInvoke CLI
 */
import { AgentInvoke } from './index.mjs';

const engine = new AgentInvoke();
const [,, cmd, ...args] = process.argv;

const help = () => console.log(`
AgentInvoke — Tool Execution Engine CLI

Commands:
  call <tool> [json]        Call a tool with optional JSON input
  chain <json>              Chain multiple calls: [{"tool":"t","input":{}}]
  parallel <json>           Parallel calls: [{"tool":"t","input":{}}]
  conditional <cond> <t> <f> [json]  Conditionally call true/false tool
  fallback <tools> [json]   Try tools until one succeeds: 't1,t2,t3'
  list [--tag=X] [--search=X]  List registered tools
  register <name> <js> [desc]  Register a tool
  unregister <name>         Unregister a tool
  validate <data> <schema>  Validate JSON data against schema
  history [--tool=X] [--limit=N]  Show execution history
  stats                     Show execution statistics
  clear-cache [--tool=X]    Clear result cache
  serve                     Start HTTP server (port 3141)
  mcp                       Start MCP server (stdio)
  demo                      Run demo showcasing all features
  help                      Show this help
`);

// Register demo tools
function registerDemos() {
  engine.register('echo', async (i) => i, { description: 'Echo input', tags: ['demo'] });
  engine.register('timestamp', async () => ({ ts: Date.now(), iso: new Date().toISOString() }), { description: 'Current timestamp', tags: ['demo'] });
  engine.register('uuid', async () => ({ uuid: crypto.randomUUID() }), { description: 'Generate UUID', tags: ['demo'] });
  engine.register('math_add', async ({ a, b }) => ({ result: a + b }), {
    description: 'Add two numbers', tags: ['math'],
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }
  });
  engine.register('math_multiply', async ({ a, b }) => ({ result: a * b }), {
    description: 'Multiply two numbers', tags: ['math'],
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }
  });
  engine.register('string_upper', async ({ text }) => ({ result: text.toUpperCase() }), {
    description: 'Uppercase string', tags: ['string'],
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  });
  engine.register('string_reverse', async ({ text }) => ({ result: text.split('').reverse().join('') }), {
    description: 'Reverse string', tags: ['string'],
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  });
  engine.register('crypto_hash', async ({ text, algo = 'sha256' }) => {
    const h = (await import('crypto')).createHash(algo).update(text).digest('hex');
    return { hash: h, algo };
  }, {
    description: 'Hash a string', tags: ['crypto'],
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, algo: { type: 'string' } }, required: ['text'] }
  });
  engine.register('json_extract', async ({ data, path }) => {
    let r = data; for (const k of path.split('.')) r = r?.[k];
    return { result: r };
  }, {
    description: 'Extract by dot-path', tags: ['json'],
    inputSchema: { type: 'object', properties: { data: { type: 'object' }, path: { type: 'string' } }, required: ['data', 'path'] }
  });
  engine.register('fail_sometimes', async () => {
    if (Math.random() > 0.5) throw new Error('Random failure');
    return { success: true };
  }, { description: 'Fails randomly (for retry demo)', tags: ['demo'], retries: 2 });
}

registerDemos();

const pj = (v) => JSON.stringify(v, null, 2);

async function run() {
  switch (cmd) {
    case 'call': {
      const [, name, inputStr] = args;
      if (!name) { console.error('Usage: call <tool> [json]'); process.exit(1); }
      const input = inputStr ? JSON.parse(inputStr) : {};
      const r = await engine.call(name, input);
      console.log(pj(r));
      break;
    }
    case 'chain': {
      const steps = JSON.parse(args[0] || '[]');
      const r = await engine.chain(steps);
      console.log(pj(r));
      break;
    }
    case 'parallel': {
      const calls = JSON.parse(args[0] || '[]');
      const r = await engine.parallel(calls);
      console.log(pj(r));
      break;
    }
    case 'conditional': {
      const [, cond, trueTool, falseTool, inputStr] = args;
      const input = inputStr ? JSON.parse(inputStr) : {};
      const r = await engine.conditional(cond === 'true', trueTool, falseTool, input);
      console.log(pj(r));
      break;
    }
    case 'fallback': {
      const tools = args[0].split(',');
      const input = args[1] ? JSON.parse(args[1]) : {};
      const r = await engine.fallback(tools.map(t => ({ tool: t })), input);
      console.log(pj(r));
      break;
    }
    case 'list': {
      const opts = {};
      for (const a of args) {
        if (a.startsWith('--tag=')) opts.tag = a.slice(6);
        if (a.startsWith('--search=')) opts.search = a.slice(9);
      }
      console.log(pj(engine.listTools(opts)));
      break;
    }
    case 'register': {
      const [, name, handlerJs, desc] = args;
      const fn = new Function('input', `return (async (input) => { ${handlerJs} })(input)`);
      engine.register(name, fn, { description: desc || '' });
      console.log(`Registered: ${name}`);
      break;
    }
    case 'unregister': {
      engine.unregister(args[0]);
      console.log(`Unregistered: ${args[0]}`);
      break;
    }
    case 'validate': {
      const data = JSON.parse(args[0]);
      const schema = JSON.parse(args[1]);
      console.log(pj(engine.validate(data, schema)));
      break;
    }
    case 'history': {
      const opts = {};
      for (const a of args) {
        if (a.startsWith('--tool=')) opts.tool = a.slice(7);
        if (a.startsWith('--limit=')) opts.limit = parseInt(a.slice(8));
      }
      console.log(pj(engine.getHistory(opts)));
      break;
    }
    case 'stats': {
      console.log(pj(engine.getStats()));
      break;
    }
    case 'clear-cache': {
      const tool = args.find(a => a.startsWith('--tool='))?.slice(7);
      if (tool) engine.clearCache(k => k.startsWith(tool + ':'));
      else engine.clearCache();
      console.log('Cache cleared');
      break;
    }
    case 'serve': {
      await import('./server.mjs');
      break;
    }
    case 'mcp': {
      await import('./mcp-server.mjs');
      break;
    }
    case 'demo': {
      console.log('🐋 AgentInvoke Demo\n');

      console.log('── Basic Call ──');
      const r1 = await engine.call('echo', { message: 'Hello, AgentInvoke!' });
      console.log(pj(r1));

      console.log('\n── Schema Validation ──');
      const r2 = await engine.call('math_add', { a: 42, b: 58 });
      console.log(pj(r2));

      console.log('\n── Validation Error ──');
      const r3 = await engine.call('math_add', { a: 'not a number', b: 58 });
      console.log(pj(r3));

      console.log('\n── Chain ──');
      const r4 = await engine.chain([
        { tool: 'math_add', input: { a: 10, b: 20 } },
        { tool: 'json_extract', input: null, transform: (prev) => ({ data: prev.output, path: 'result' }) }
      ]);
      console.log(pj(r4));

      console.log('\n── Parallel ──');
      const r5 = await engine.parallel([
        { tool: 'uuid' },
        { tool: 'timestamp' },
        { tool: 'string_upper', input: { text: 'parallel!' } }
      ]);
      console.log(pj(r5));

      console.log('\n── Caching ──');
      engine.register('cached_tool', async () => ({ ts: Date.now() }), { cacheTTL: 60000 });
      const r6a = await engine.call('cached_tool', {});
      const r6b = await engine.call('cached_tool', {});
      console.log('First:', r6a.output.ts, 'Cached:', r6b.cached);

      console.log('\n── Retry ──');
      const r7 = await engine.call('fail_sometimes', {}, { retries: 3 });
      console.log('Attempts:', r7.attempt + 1, 'Success:', r7.success);

      console.log('\n── Stats ──');
      console.log(pj(engine.getStats()));

      console.log('\n── MCP Tools ──');
      console.log(pj(engine.toMCPTools()));

      console.log('\n✅ Demo complete');
      break;
    }
    default:
      help();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
