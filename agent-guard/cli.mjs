#!/usr/bin/env node
/**
 * agent-guard CLI
 */

import { AgentGuard } from './index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const USAGE = `
agent-guard — Schema validation & guardrails for AI agents

Usage:
  agent-guard validate <schema-name> <json-data>   Validate data against a schema
  agent-guard guard <profile> <json-data>           Run full guard pipeline
  agent-guard schema <action> [args...]             Schema management
  agent-guard rule <action> [args...]               Rule management
  agent-guard profile <action> [args...]            Profile management
  agent-guard detect <text>                         Detect PII/profanity in text
  agent-guard redact <text>                         Redact PII from text
  agent-guard audit [options]                       View audit log
  agent-guard stats                                 Show stats
  agent-guard serve [port]                          Start HTTP server
  agent-guard mcp                                   Start MCP server
  agent-guard demo                                  Run interactive demo

Schema actions:
  schema list                                       List schemas
  schema add <name> <json-schema>                   Add schema
  schema remove <name>                              Remove schema
  schema show <name>                                Show schema

Rule actions:
  rule list                                         List rules
  rule load-preset <name>                           Load a preset rule
  rule load-all-presets                             Load all preset rules

Profile actions:
  profile list                                      List profiles
  profile add <name> <json-profile>                 Add profile
  profile show <name>                               Show profile

Options:
  --data-dir <dir>    Data directory (default: ./data)
  --strict            Strict mode (default: true)
  --redact            Auto-redact PII
  -h, --help          Show help
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-h' || args[i] === '--help') { console.log(USAGE); process.exit(0); }
    if (args[i] === '--data-dir') { flags.dataDir = args[++i]; continue; }
    if (args[i] === '--strict') { flags.strict = true; continue; }
    if (args[i] === '--redact') { flags.autoRedact = true; continue; }
    positional.push(args[i]);
  }

  return { command: positional[0], subcommand: positional[1], args: positional.slice(2), flags };
}

function main() {
  const { command, subcommand, args, flags } = parseArgs();

  if (!command) { console.log(USAGE); process.exit(0); }

  const guard = new AgentGuard(flags);

  switch (command) {
    case 'validate': {
      const [schemaName, dataStr] = args;
      if (!schemaName || !dataStr) { console.error('Usage: agent-guard validate <schema> <json>'); process.exit(1); }
      // Try to load schema from file
      try {
        const schemaData = JSON.parse(readFileSync(schemaName, 'utf-8'));
        guard.addSchema('_inline', schemaData);
        const data = JSON.parse(dataStr);
        const result = guard.validate(data, '_inline');
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.valid ? 0 : 1);
      } catch {
        // schemaName is a pre-registered name
        const data = JSON.parse(dataStr);
        const result = guard.validate(data, schemaName);
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.valid ? 0 : 1);
      }
    }

    case 'guard': {
      const [profile, dataStr] = args;
      if (!profile || !dataStr) { console.error('Usage: agent-guard guard <profile> <json>'); process.exit(1); }
      const data = JSON.parse(dataStr);
      const result = guard.guardInput(data, { profile });
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.allowed ? 0 : 1);
    }

    case 'detect': {
      const text = args.join(' ');
      if (!text) { console.error('Usage: agent-guard detect <text>'); process.exit(1); }
      const pii = guard.detectPII(text);
      const profanity = guard.detectProfanity(text);
      console.log(JSON.stringify({ pii, profanity }, null, 2));
      break;
    }

    case 'redact': {
      const text = args.join(' ');
      if (!text) { console.error('Usage: agent-guard redact <text>'); process.exit(1); }
      console.log(guard.redactPII(text));
      break;
    }

    case 'schema': {
      switch (subcommand) {
        case 'list': console.log(JSON.stringify(guard.listSchemas())); break;
        case 'add': {
          const [name, ...rest] = args;
          const schema = JSON.parse(rest.join(' '));
          guard.addSchema(name, schema);
          console.log(`Schema '${name}' added.`);
          break;
        }
        case 'remove': guard.removeSchema(args[0]); console.log(`Schema '${args[0]}' removed.`); break;
        case 'show': console.log(JSON.stringify(guard.getSchema(args[0]), null, 2)); break;
        default: console.error('Unknown schema action'); process.exit(1);
      }
      break;
    }

    case 'rule': {
      switch (subcommand) {
        case 'list': console.log(JSON.stringify(guard.listRules(), null, 2)); break;
        case 'load-preset': guard.loadPreset(args[0]); console.log(`Preset '${args[0]}' loaded.`); break;
        case 'load-all-presets': guard.loadAllPresets(); console.log('All presets loaded.'); break;
        default: console.error('Unknown rule action'); process.exit(1);
      }
      break;
    }

    case 'profile': {
      switch (subcommand) {
        case 'list': console.log(JSON.stringify(guard.listProfiles(), null, 2)); break;
        case 'add': {
          const [name, ...rest] = args;
          const profile = JSON.parse(rest.join(' '));
          guard.addProfile(name, profile);
          console.log(`Profile '${name}' added.`);
          break;
        }
        case 'show': console.log(JSON.stringify(guard.getProfile(args[0]), null, 2)); break;
        default: console.error('Unknown profile action'); process.exit(1);
      }
      break;
    }

    case 'audit': {
      const entries = guard.audit.read({ limit: parseInt(args[0]) || 50 });
      console.log(JSON.stringify(entries, null, 2));
      break;
    }

    case 'stats': {
      console.log(JSON.stringify(guard.getStats(), null, 2));
      break;
    }

    case 'serve': {
      import('./server.mjs');
      break;
    }

    case 'mcp': {
      import('./mcp-server.mjs');
      break;
    }

    case 'demo': {
      runDemo(guard);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

function runDemo(guard) {
  console.log('🛡️  agent-guard demo\n');

  // Load presets
  guard.loadAllPresets();
  console.log('Loaded presets:', guard.listRules().map((r) => r.name).join(', '));

  // Add schemas
  guard.addSchema('user-input', {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', format: 'email' },
      age: { type: 'integer', minimum: 0, maximum: 150 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    },
    additionalProperties: false,
  });

  guard.addSchema('api-response', {
    type: 'object',
    required: ['status', 'data'],
    properties: {
      status: { type: 'string', enum: ['ok', 'error'] },
      data: { type: 'object' },
      message: { type: 'string', maxLength: 500 },
    },
  });

  console.log('\nSchemas:', guard.listSchemas().join(', '));

  // Add profile
  guard.addProfile('user-form', {
    description: 'User registration form guard',
    schema: 'user-input',
    rules: ['no-empty-strings', 'no-pii'],
    contentGuard: { blockPII: true, redact: true },
    rateLimit: { limit: 10, windowMs: 60000 },
  });

  console.log('Profiles:', guard.listProfiles().map((p) => p.name).join(', '));

  // Test cases
  const tests = [
    {
      label: '✅ Valid input',
      data: { name: 'Alice', email: 'alice@example.com', age: 30 },
      profile: 'user-form',
    },
    {
      label: '❌ Missing required field',
      data: { name: 'Bob' },
      profile: 'user-form',
    },
    {
      label: '❌ Wrong type',
      data: { name: 123, email: 'test@test.com' },
      profile: 'user-form',
    },
    {
      label: '❌ PII in name (email embedded)',
      data: { name: 'Contact me at bob@evil.com', email: 'bob@example.com' },
      profile: 'user-form',
    },
    {
      label: '❌ Extra properties (strict)',
      data: { name: 'Charlie', email: 'c@test.com', password: 'secret123' },
      profile: 'user-form',
    },
  ];

  for (const t of tests) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(t.label);
    console.log('Input:', JSON.stringify(t.data));
    const result = guard.guardInput(t.data, { profile: t.profile, operation: 'demo' });
    console.log('Allowed:', result.allowed);
    if (result.errors.length) console.log('Errors:', JSON.stringify(result.errors));
    if (result.warnings.length) console.log('Warnings:', JSON.stringify(result.warnings));
    if (JSON.stringify(result.sanitized) !== JSON.stringify(t.data)) {
      console.log('Sanitized:', JSON.stringify(result.sanitized));
    }
  }

  // Content detection
  console.log(`\n${'─'.repeat(50)}`);
  console.log('PII Detection:');
  const piiText = 'My email is john@example.com and SSN is 123-45-6789';
  console.log(`Input: "${piiText}"`);
  console.log('Detected:', JSON.stringify(guard.detectPII(piiText)));
  console.log('Redacted:', guard.redactPII(piiText));

  // Stats
  console.log(`\n${'─'.repeat(50)}`);
  console.log('Stats:', JSON.stringify(guard.getStats(), null, 2));

  console.log('\n🐋 Demo complete!');
}

main();
