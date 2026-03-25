#!/usr/bin/env node
/**
 * AgentInvoke MCP Server — 12 tools via JSON-RPC stdio
 */
import { AgentInvoke } from './index.mjs';
import { createInterface } from 'readline';

const engine = new AgentInvoke();

// Built-in demo tools
function registerDemoTools() {
  engine.register('echo', async (input) => input, {
    description: 'Echo back the input',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    tags: ['demo']
  });
  engine.register('math_add', async ({ a, b }) => ({ result: a + b }), {
    description: 'Add two numbers',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    tags: ['math']
  });
  engine.register('math_multiply', async ({ a, b }) => ({ result: a * b }), {
    description: 'Multiply two numbers',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    tags: ['math']
  });
  engine.register('string_reverse', async ({ text }) => ({ result: text.split('').reverse().join('') }), {
    description: 'Reverse a string',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    tags: ['string']
  });
  engine.register('json_transform', async ({ data, path }) => {
    const keys = path.split('.');
    let result = data;
    for (const k of keys) result = result?.[k];
    return { result };
  }, {
    description: 'Extract value from JSON by dot-path',
    inputSchema: { type: 'object', properties: { data: { type: 'object' }, path: { type: 'string' } }, required: ['data', 'path'] },
    tags: ['json']
  });
}

registerDemoTools();

const TOOLS = {
  invoke_register: {
    description: 'Register a new tool with handler code (evaluated)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        handler_js: { type: 'string', description: 'JavaScript async function body, receives `input`' },
        inputSchema: { type: 'object' },
        tags: { type: 'array', items: { type: 'string' } },
        timeout: { type: 'number' },
        retries: { type: 'number' },
        cacheTTL: { type: 'number' }
      },
      required: ['name', 'handler_js']
    },
    handler: async ({ name, description, handler_js, inputSchema, tags, timeout, retries, cacheTTL }) => {
      const fn = new Function('input', `return (async (input) => { ${handler_js} })(input)`);
      engine.register(name, fn, { description, inputSchema, tags, timeout, retries, cacheTTL });
      return { registered: name };
    }
  },
  invoke_call: {
    description: 'Call a registered tool by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        input: { type: 'object' },
        timeout: { type: 'number' },
        retries: { type: 'number' }
      },
      required: ['name']
    },
    handler: async ({ name, input, timeout, retries }) => {
      const result = await engine.call(name, input || {}, { timeout, retries });
      return result;
    }
  },
  invoke_chain: {
    description: 'Chain multiple tool calls sequentially',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              input: { type: 'object' }
            },
            required: ['tool']
          }
        },
        initialInput: { type: 'object' }
      },
      required: ['steps']
    },
    handler: async ({ steps, initialInput }) => engine.chain(steps, initialInput || {})
  },
  invoke_parallel: {
    description: 'Call multiple tools in parallel',
    inputSchema: {
      type: 'object',
      properties: {
        calls: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              input: { type: 'object' }
            },
            required: ['tool']
          }
        }
      },
      required: ['calls']
    },
    handler: async ({ calls }) => engine.parallel(calls)
  },
  invoke_conditional: {
    description: 'Conditionally call one of two tools',
    inputSchema: {
      type: 'object',
      properties: {
        condition: { type: 'boolean' },
        trueTool: { type: 'string' },
        falseTool: { type: 'string' },
        input: { type: 'object' }
      },
      required: ['condition', 'trueTool', 'falseTool']
    },
    handler: async ({ condition, trueTool, falseTool, input }) =>
      engine.conditional(condition, trueTool, falseTool, input || {})
  },
  invoke_fallback: {
    description: 'Try tools in order until one succeeds',
    inputSchema: {
      type: 'object',
      properties: {
        tools: { type: 'array', items: { type: 'string' } },
        input: { type: 'object' }
      },
      required: ['tools']
    },
    handler: async ({ tools, input }) =>
      engine.fallback(tools.map(t => ({ tool: t })), input || {})
  },
  invoke_list: {
    description: 'List all registered tools',
    inputSchema: { type: 'object', properties: { tag: { type: 'string' }, search: { type: 'string' } } },
    handler: async (opts) => engine.listTools(opts)
  },
  invoke_unregister: {
    description: 'Unregister a tool',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: async ({ name }) => { engine.unregister(name); return { unregistered: name }; }
  },
  invoke_validate: {
    description: 'Validate data against a JSON schema',
    inputSchema: {
      type: 'object',
      properties: {
        data: {},
        schema: { type: 'object' }
      },
      required: ['data', 'schema']
    },
    handler: async ({ data, schema }) => engine.validate(data, schema)
  },
  invoke_history: {
    description: 'Get execution history',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string' },
        success: { type: 'boolean' },
        limit: { type: 'number' }
      }
    },
    handler: async (opts) => engine.getHistory(opts)
  },
  invoke_stats: {
    description: 'Get execution statistics',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => engine.getStats()
  },
  invoke_cache_clear: {
    description: 'Clear result cache',
    inputSchema: { type: 'object', properties: { tool: { type: 'string' } } },
    handler: async ({ tool }) => {
      if (tool) engine.clearCache((k) => k.startsWith(tool + ':'));
      else engine.clearCache();
      return { cleared: true };
    }
  }
};

// JSON-RPC stdio
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const respond = (result, error) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result, error }) + '\n');
  };
  try {
    const tool = TOOLS[req.params?.name];
    if (!tool) return respond(null, { code: -32601, message: `Unknown tool: ${req.params?.name}` });
    const result = await tool.handler(req.params?.arguments || {});
    respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (e) {
    respond(null, { code: -32000, message: e.message });
  }
});

// List tools handler
process.stdout.write(JSON.stringify({
  jsonrpc: '2.0', id: 0,
  result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) }
}) + '\n');

process.stderr.write('[agent-invoke] MCP server ready\n');
