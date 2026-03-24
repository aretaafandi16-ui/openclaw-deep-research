#!/usr/bin/env node

/**
 * agent-transform MCP Server
 * Exposes data transformation tools via Model Context Protocol (JSON-RPC stdio)
 */

import { TransformEngine } from './index.mjs';

const engine = new TransformEngine();

// ─── MCP Protocol ──────────────────────────────────────────────────────────

function handleRequest(req) {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-transform', version: '1.0.0' }
      };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call':
      return callTool(req.params);

    default:
      throw new Error(`Unknown method: ${req.method}`);
  }
}

async function callTool(params) {
  const { name, arguments: args } = params;
  let result;

  try {
    switch (name) {
      case 'transform_execute': {
        const { result: r, errors, elapsed } = engine.execute(args.steps || [], args.data);
        result = { result: r, errors, elapsed };
        break;
      }
      case 'transform_map': {
        const { result: r } = engine.execute([{ type: 'map', mapping: args.mapping, when: args.when }], args.data);
        result = r;
        break;
      }
      case 'transform_filter': {
        const { result: r } = engine.execute([{ type: 'filter', condition: args.condition }], args.data);
        result = r;
        break;
      }
      case 'transform_flatten': {
        const { result: r } = engine.execute([{ type: 'flatten', unflatten: args.unflatten }], args.data);
        result = r;
        break;
      }
      case 'transform_coerce': {
        const { result: r } = engine.execute([{ type: 'coerce', fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_pick': {
        const { result: r } = engine.execute([{ type: 'pick', fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_omit': {
        const { result: r } = engine.execute([{ type: 'omit', fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_rename': {
        const { result: r } = engine.execute([{ type: 'rename', fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_sort': {
        const { result: r } = engine.execute([{ type: 'sort', by: args.by }], args.data);
        result = r;
        break;
      }
      case 'transform_group': {
        const { result: r } = engine.execute([{ type: 'group', by: args.by, asArray: args.asArray }], args.data);
        result = r;
        break;
      }
      case 'transform_aggregate': {
        const { result: r } = engine.execute([{ type: 'aggregate', operations: args.operations }], args.data);
        result = r;
        break;
      }
      case 'transform_validate': {
        const { result: r } = engine.execute([{ type: 'validate', rules: args.rules, strict: args.strict }], args.data);
        result = r;
        break;
      }
      case 'transform_csv_parse': {
        const { result: r } = engine.execute([{ type: 'csv_parse', separator: args.separator }], args.data);
        result = r;
        break;
      }
      case 'transform_csv_stringify': {
        const { result: r } = engine.execute([{ type: 'csv_stringify', separator: args.separator, fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_jsonl_parse': {
        const { result: r } = engine.execute([{ type: 'jsonl_parse' }], args.data);
        result = r;
        break;
      }
      case 'transform_jsonl_stringify': {
        const { result: r } = engine.execute([{ type: 'jsonl_stringify' }], args.data);
        result = r;
        break;
      }
      case 'transform_template': {
        const { result: r } = engine.execute([{ type: 'template', template: args.template }], args.data);
        result = r;
        break;
      }
      case 'transform_add_fields': {
        const { result: r } = engine.execute([{ type: 'add', fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_delete_fields': {
        const { result: r } = engine.execute([{ type: 'delete', fields: args.fields }], args.data);
        result = r;
        break;
      }
      case 'transform_unique': {
        const { result: r } = engine.execute([{ type: 'unique', by: args.by }], args.data);
        result = r;
        break;
      }
      case 'transform_pivot': {
        const { result: r } = engine.execute([{ type: 'pivot', key: args.key, value: args.value, group: args.group }], args.data);
        result = r;
        break;
      }
      case 'transform_unpivot': {
        const { result: r } = engine.execute([{ type: 'unpivot', exclude: args.exclude, key: args.key, value: args.value }], args.data);
        result = r;
        break;
      }
      case 'transform_spread': {
        const { result: r } = engine.execute([{ type: 'spread', field: args.field, as: args.as }], args.data);
        result = r;
        break;
      }
      case 'transform_chunk': {
        const { result: r } = engine.execute([{ type: 'chunk', size: args.size }], args.data);
        result = r;
        break;
      }
      case 'transform_sample': {
        const { result: r } = engine.execute([{ type: 'sample', count: args.count, random: args.random }], args.data);
        result = r;
        break;
      }
      case 'transform_stats': {
        result = engine.getStats();
        break;
      }
      case 'transform_list': {
        result = engine.listTransforms();
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'transform_execute',
    description: 'Execute a pipeline of transform steps on data. Supports all step types.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Input data (any JSON value)' },
        steps: { type: 'array', description: 'Array of transform step objects', items: { type: 'object' } }
      },
      required: ['data', 'steps']
    }
  },
  {
    name: 'transform_map',
    description: 'Map/transform fields using a mapping definition with $source, $expr, $const, $transform',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Input record or array of records' },
        mapping: { type: 'object', description: 'Field mapping: { targetField: { $source: "src.path" } or { $expr: "template" } }' },
        when: { description: 'Optional condition to apply mapping' }
      },
      required: ['data', 'mapping']
    }
  },
  {
    name: 'transform_filter',
    description: 'Filter array by condition (supports $gt, $lt, $eq, $ne, $in, $contains, $regex, $and, $or)',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to filter' },
        condition: { description: 'Filter condition object or expression string' }
      },
      required: ['data', 'condition']
    }
  },
  {
    name: 'transform_flatten',
    description: 'Flatten nested object to dot-notation keys, or unflatten',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Object to flatten/unflatten' },
        unflatten: { type: 'boolean', description: 'If true, unflatten instead' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_coerce',
    description: 'Coerce field types: string, number, boolean, date, array, object, null',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Input data' },
        fields: { type: 'object', description: '{ fieldName: "type" } mapping' }
      },
      required: ['data', 'fields']
    }
  },
  {
    name: 'transform_pick',
    description: 'Pick only specified fields from records',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Record or array of records' },
        fields: { type: 'array', items: { type: 'string' } }
      },
      required: ['data', 'fields']
    }
  },
  {
    name: 'transform_omit',
    description: 'Omit specified fields from records',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Record or array of records' },
        fields: { type: 'array', items: { type: 'string' } }
      },
      required: ['data', 'fields']
    }
  },
  {
    name: 'transform_rename',
    description: 'Rename fields in records',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Record or array of records' },
        fields: { type: 'object', description: '{ oldName: newName } mapping' }
      },
      required: ['data', 'fields']
    }
  },
  {
    name: 'transform_sort',
    description: 'Sort array by one or more fields',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to sort' },
        by: { type: 'array', description: 'Sort fields: ["field"] or [{ field, desc }]', items: {} }
      },
      required: ['data', 'by']
    }
  },
  {
    name: 'transform_group',
    description: 'Group array items by a field value',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to group' },
        by: { type: 'string', description: 'Field to group by' },
        asArray: { type: 'boolean', description: 'Return as [{ key, items }] array' }
      },
      required: ['data', 'by']
    }
  },
  {
    name: 'transform_aggregate',
    description: 'Aggregate array data: sum, avg, min, max, count, distinct, first, last',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to aggregate' },
        operations: { type: 'object', description: '{ name: { fn, field } } operations' }
      },
      required: ['data', 'operations']
    }
  },
  {
    name: 'transform_validate',
    description: 'Validate data against schema rules (required, type, min, max, pattern, enum, minLength, maxLength)',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Data to validate (record or array)' },
        rules: { type: 'object', description: '{ field: { required, type, min, max, pattern, enum } }' },
        strict: { type: 'boolean', description: 'Throw on validation failure' }
      },
      required: ['data', 'rules']
    }
  },
  {
    name: 'transform_csv_parse',
    description: 'Parse CSV text to array of objects',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'CSV text' },
        separator: { type: 'string', description: 'Field separator (default: ,)' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_csv_stringify',
    description: 'Convert array of objects to CSV text',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array of objects' },
        separator: { type: 'string', description: 'Field separator' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Explicit field order' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_jsonl_parse',
    description: 'Parse JSONL (newline-delimited JSON) to array',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'JSONL text' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_jsonl_stringify',
    description: 'Convert array to JSONL text',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Array or single object' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_template',
    description: 'Apply template with {{field}} interpolation to data',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Data object or array' },
        template: { type: 'string', description: 'Template string with {{field}} placeholders' }
      },
      required: ['data', 'template']
    }
  },
  {
    name: 'transform_add_fields',
    description: 'Add computed/constant fields to records',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Record or array' },
        fields: { type: 'object', description: '{ field: { $const, $expr, $transform } }' }
      },
      required: ['data', 'fields']
    }
  },
  {
    name: 'transform_delete_fields',
    description: 'Delete fields from records',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Record or array' },
        fields: { type: 'array', items: { type: 'string' } }
      },
      required: ['data', 'fields']
    }
  },
  {
    name: 'transform_unique',
    description: 'Remove duplicate items from array (by field or full object)',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to deduplicate' },
        by: { type: 'string', description: 'Optional field to deduplicate by' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_pivot',
    description: 'Pivot array from long to wide format',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to pivot' },
        key: { type: 'string', description: 'Field to use as new column names' },
        value: { type: 'string', description: 'Field to use as values' },
        group: { type: 'string', description: 'Optional grouping field' }
      },
      required: ['data', 'key', 'value']
    }
  },
  {
    name: 'transform_unpivot',
    description: 'Unpivot object from wide to long format',
    inputSchema: {
      type: 'object',
      properties: {
        data: { description: 'Object to unpivot' },
        exclude: { type: 'array', items: { type: 'string' } },
        key: { type: 'string', description: 'Output key field name' },
        value: { type: 'string', description: 'Output value field name' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_spread',
    description: 'Spread array field into separate records',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array with nested array fields' },
        field: { type: 'string', description: 'Array field to spread' },
        as: { type: 'string', description: 'Output field name' }
      },
      required: ['data', 'field']
    }
  },
  {
    name: 'transform_chunk',
    description: 'Split array into chunks of specified size',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to chunk' },
        size: { type: 'number', description: 'Chunk size (default: 100)' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_sample',
    description: 'Get random or sequential sample from array',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'array', description: 'Array to sample' },
        count: { type: 'number', description: 'Number of items (default: 10)' },
        random: { type: 'boolean', description: 'Random sampling' }
      },
      required: ['data']
    }
  },
  {
    name: 'transform_stats',
    description: 'Get engine statistics (runs, items, errors, avg time)',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'transform_list',
    description: 'List all available built-in transform functions',
    inputSchema: { type: 'object', properties: {} }
  }
];

// ─── JSON-RPC stdio server ─────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const respond = result => {
        const res = { jsonrpc: '2.0', id: req.id };
        if (result instanceof Error) res.error = { code: -32000, message: result.message };
        else res.result = result;
        process.stdout.write(JSON.stringify(res) + '\n');
      };
      Promise.resolve(handleRequest(req)).then(respond).catch(respond);
    } catch {}
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

console.error('agent-transform MCP server started');
