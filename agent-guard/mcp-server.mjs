#!/usr/bin/env node
/**
 * agent-guard MCP Server
 * Exposes guard, validate, detect, redact as MCP tools over JSON-RPC stdio
 */

import { AgentGuard } from './index.mjs';
import { readFileSync } from 'node:fs';

const guard = new AgentGuard({ dataDir: process.env.AGENT_GUARD_DATA_DIR || './data' });
guard.loadAllPresets();

const TOOLS = [
  {
    name: 'guard_validate',
    description: 'Validate data against a JSON schema. Returns {valid, errors}.',
    inputSchema: {
      type: 'object',
      required: ['schema', 'data'],
      properties: {
        schema: { type: 'object', description: 'JSON Schema object' },
        data: { type: 'object', description: 'Data to validate' },
      },
    },
  },
  {
    name: 'guard_check',
    description: 'Run full guard pipeline (schema + rules + content guardrails) on data.',
    inputSchema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { description: 'Data to guard (string or object)' },
        profile: { type: 'string', description: 'Guard profile name' },
        operation: { type: 'string', description: 'Operation name for audit' },
        direction: { type: 'string', enum: ['input', 'output'], default: 'input' },
        schema: { type: 'object', description: 'Inline JSON schema' },
        rules: { type: 'array', items: { type: 'string' }, description: 'Rule names to apply' },
        contentGuard: {
          type: 'object',
          properties: {
            blockPII: { type: 'boolean' },
            redact: { type: 'boolean' },
            blockProfanity: { type: 'boolean' },
            maxBytes: { type: 'number' },
          },
        },
      },
    },
  },
  {
    name: 'guard_detect_pii',
    description: 'Detect PII (emails, phones, SSNs, credit cards, IPs, JWTs) in text.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
  },
  {
    name: 'guard_redact_pii',
    description: 'Redact PII from text, replacing with placeholder tokens.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
  },
  {
    name: 'guard_detect_profanity',
    description: 'Detect profane words in text.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
  },
  {
    name: 'guard_sanitize',
    description: 'Sanitize text (strip HTML, redact PII, trim, lowercase, limit length).',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        redactPII: { type: 'boolean' },
        stripHTML: { type: 'boolean' },
        stripMarkdown: { type: 'boolean' },
        maxLength: { type: 'number' },
        lowercase: { type: 'boolean' },
        trim: { type: 'boolean' },
      },
    },
  },
  {
    name: 'guard_schema_add',
    description: 'Register a named JSON schema for later validation.',
    inputSchema: {
      type: 'object',
      required: ['name', 'schema'],
      properties: {
        name: { type: 'string' },
        schema: { type: 'object' },
      },
    },
  },
  {
    name: 'guard_profile_add',
    description: 'Create a guard profile (schema + rules + content guard + rate limit).',
    inputSchema: {
      type: 'object',
      required: ['name', 'profile'],
      properties: {
        name: { type: 'string' },
        profile: {
          type: 'object',
          properties: {
            schema: {},
            rules: { type: 'array', items: { type: 'string' } },
            contentGuard: { type: 'object' },
            rateLimit: { type: 'object', properties: { limit: { type: 'number' }, windowMs: { type: 'number' } } },
            description: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'guard_stats',
    description: 'Get guard statistics (checks, passes, blocks, warnings, audit summary).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'guard_audit',
    description: 'Read audit log entries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
        operation: { type: 'string' },
        action: { type: 'string', enum: ['pass', 'block', 'warn'] },
      },
    },
  },
  {
    name: 'guard_list_schemas',
    description: 'List registered schema names.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'guard_list_profiles',
    description: 'List registered guard profiles.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function handleRequest(req) {
  switch (req.method) {
    case 'initialize':
      return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-guard', version: '1.0.0' } };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call': {
      const { name, arguments: args } = req.params;
      try {
        let result;
        switch (name) {
          case 'guard_validate': {
            const v = guard.validate(args.data, args.schema);
            result = { content: [{ type: 'text', text: JSON.stringify(v) }] };
            break;
          }
          case 'guard_check': {
            const r = guard.guard(args.data, {
              profile: args.profile,
              operation: args.operation,
              direction: args.direction || 'input',
              schema: args.schema,
              rules: args.rules,
              contentGuard: args.contentGuard,
            });
            result = { content: [{ type: 'text', text: JSON.stringify(r) }] };
            break;
          }
          case 'guard_detect_pii':
            result = { content: [{ type: 'text', text: JSON.stringify(guard.detectPII(args.text)) }] };
            break;
          case 'guard_redact_pii':
            result = { content: [{ type: 'text', text: guard.redactPII(args.text) }] };
            break;
          case 'guard_detect_profanity':
            result = { content: [{ type: 'text', text: JSON.stringify(guard.detectProfanity(args.text)) }] };
            break;
          case 'guard_sanitize': {
            const rules = { redactPII: args.redactPII, stripHTML: args.stripHTML, stripMarkdown: args.stripMarkdown, maxLength: args.maxLength, lowercase: args.lowercase, trim: args.trim };
            result = { content: [{ type: 'text', text: guard.sanitizeText(args.text, rules) }] };
            break;
          }
          case 'guard_schema_add':
            guard.addSchema(args.name, args.schema);
            result = { content: [{ type: 'text', text: `Schema '${args.name}' added.` }] };
            break;
          case 'guard_profile_add':
            guard.addProfile(args.name, args.profile);
            result = { content: [{ type: 'text', text: `Profile '${args.name}' added.` }] };
            break;
          case 'guard_stats':
            result = { content: [{ type: 'text', text: JSON.stringify(guard.getStats()) }] };
            break;
          case 'guard_audit':
            result = { content: [{ type: 'text', text: JSON.stringify(guard.audit.read(args || {})) }] };
            break;
          case 'guard_list_schemas':
            result = { content: [{ type: 'text', text: JSON.stringify(guard.listSchemas()) }] };
            break;
          case 'guard_list_profiles':
            result = { content: [{ type: 'text', text: JSON.stringify(guard.listProfiles()) }] };
            break;
          default:
            return { error: { code: -32601, message: `Unknown tool: ${name}` } };
        }
        return result;
      } catch (err) {
        return { error: { code: -32000, message: err.message } };
      }
    }

    default:
      return { error: { code: -32601, message: `Unknown method: ${req.method}` } };
  }
}

// JSON-RPC over stdio
let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const resp = handleRequest(req);
      if (resp !== null) {
        const out = JSON.stringify({ jsonrpc: '2.0', id: req.id, ...resp });
        process.stdout.write(out + '\n');
      }
    } catch {
      // ignore parse errors
    }
  }
});

process.stdin.resume();

if (process.stdout.isTTY) {
  console.error('agent-guard MCP server ready (stdio JSON-RPC)');
}
