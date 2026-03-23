#!/usr/bin/env node
/**
 * tool-bridge tests
 * Zero dependencies. Run: node test.mjs
 */

import { ToolBridge, parseYAML, resolveTemplate, applyTransform, jsonPath } from './index.mjs';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0, failed = 0, total = 0;

function assert(condition, name) {
  total++;
  if (condition) {
    console.log(`  ${PASS} ${name}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${name}`);
    failed++;
  }
}

function assertEq(a, b, name) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  assert(eq, name);
  if (!eq) {
    console.log(`    expected: ${JSON.stringify(b)}`);
    console.log(`    got:      ${JSON.stringify(a)}`);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\n🧪 tool-bridge test suite\n');

// YAML Parser
console.log('YAML Parser:');
{
  const yaml = `
tools:
  weather:
    description: Get weather
    type: rest
    method: GET
    url: https://api.example.com/weather
    params:
      city: "{{args.city}}"
    timeout: 5000
    transform:
      temp: current.temp
`;
  const parsed = parseYAML(yaml);
  assert(parsed.tools !== undefined, 'parses top-level key');
  assert(parsed.tools.weather !== undefined, 'parses nested key');
  assert(parsed.tools.weather.description === 'Get weather', 'parses string value');
  assert(parsed.tools.weather.method === 'GET', 'parses uppercase string');
  assert(parsed.tools.weather.timeout === 5000, 'parses integer');
  assert(parsed.tools.weather.transform.temp === 'current.temp', 'parses nested transform');
}

// Template Engine
console.log('\nTemplate Engine:');
{
  const ctx = { args: { city: 'Jakarta', count: 5 } };
  
  assertEq(
    resolveTemplate('Hello {{args.city}}', ctx),
    'Hello Jakarta',
    'resolves args'
  );
  
  assertEq(
    resolveTemplate('{{args.count}}', ctx),
    '5',
    'resolves numeric args as string'
  );
  
  assertEq(
    resolveTemplate('{{env.HOME}}', {}),
    process.env.HOME || '',
    'resolves env vars'
  );
  
  const ts = resolveTemplate('{{date.now}}', {});
  assert(ts.length > 10, 'date.now generates ISO string');
  
  const uuid = resolveTemplate('{{uuid}}', {});
  assert(uuid.length === 36, 'uuid generates valid UUID');
}

// JSONPath
console.log('\nJSONPath:');
{
  const obj = {
    current: { temp: 28, condition: [{ desc: 'Sunny' }] },
    items: [{ name: 'a' }, { name: 'b' }],
  };
  
  assertEq(jsonPath(obj, 'current.temp'), 28, 'extracts nested value');
  assertEq(jsonPath(obj, 'current.condition.0.desc'), 'Sunny', 'extracts array item');
  assertEq(jsonPath(obj, 'items.1.name'), 'b', 'extracts second array item');
  assertEq(jsonPath(obj, ''), obj, 'empty path returns root');
}

// Transform
console.log('\nTransform:');
{
  const data = {
    weather: { temp: 28, humidity: 75 },
    location: { city: 'Jakarta' },
  };
  
  const result = applyTransform(data, {
    temperature: 'weather.temp',
    city: 'location.city',
    humidity: 'weather.humidity',
  });
  
  assertEq(result.temperature, 28, 'transforms field');
  assertEq(result.city, 'Jakarta', 'transforms nested field');
}

// ToolBridge Core
console.log('\nToolBridge:');
{
  // Empty bridge
  const bridge = new ToolBridge();
  await bridge.load();
  assertEq(bridge.list(), [], 'empty bridge has no tools');
  
  // Presets
  assert(bridge.presets.github !== undefined, 'has github preset');
  assert(bridge.presets.weather !== undefined, 'has weather preset');
  assert(bridge.presets.httpbin !== undefined, 'has httpbin preset');
  assert(bridge.presets.system !== undefined, 'has system preset');
  
  // Preset tools
  bridge.config = bridge.presets.github;
  const tools = bridge.list();
  assert(tools.length === 5, 'github preset has 5 tools');
  assert(tools.some(t => t.name === 'github_repo'), 'has github_repo tool');
  assert(tools.some(t => t.name === 'github_issues'), 'has github_issues tool');
  
  // Info
  const info = bridge.info('github_repo');
  assert(info.type === 'rest', 'info returns tool type');
  assert(info.method === 'GET', 'info returns method');
  assert(info.url.includes('github.com'), 'info returns URL');
}

// CLI Tool
console.log('\nCLI Tool:');
{
  const bridge = new ToolBridge();
  bridge.config = {
    tools: {
      test_echo: {
        description: 'Echo test',
        type: 'cli',
        command: 'echo "hello {{args.name}}"',
      },
      test_ls: {
        description: 'List directory',
        type: 'cli',
        command: 'ls -la {{args.path || "."}}',
      },
      test_json: {
        description: 'Output JSON',
        type: 'cli',
        command: 'echo \'{"key":"value"}\'',
      },
    },
  };
  
  const result = await bridge.call('test_echo', { name: 'world' });
  assert(result.ok === true, 'cli call succeeds');
  assert(result.data.includes('hello world'), 'cli resolves template args');
  
  const jsonResult = await bridge.call('test_json');
  assert(jsonResult.ok === true, 'cli parses JSON output');
  assertEq(jsonResult.data, { key: 'value' }, 'cli returns parsed JSON');
  
  const lsResult = await bridge.call('test_ls');
  assert(lsResult.ok === true, 'cli with default args works');
}

// Rate Limiter
console.log('\nRate Limiter:');
{
  const bridge = new ToolBridge();
  bridge.config = {
    defaults: { rateLimit: 2 },
    tools: {
      limited: {
        description: 'Rate limited',
        type: 'cli',
        command: 'echo ok',
        rateLimit: 2,
      },
    },
  };
  
  // Call within limit
  const r1 = await bridge.call('limited');
  assert(r1.ok === true, 'first call succeeds');
  
  const r2 = await bridge.call('limited');
  assert(r2.ok === true, 'second call succeeds');
  
  // Third should be rate limited (within same minute)
  const r3 = await bridge.call('limited');
  assert(r3.error === 'rate_limited', 'third call is rate limited');
}

// Batch
console.log('\nBatch:');
{
  const bridge = new ToolBridge();
  bridge.config = {
    tools: {
      step1: { type: 'cli', command: 'echo \'{"name":"test"}\'' },
      step2: { type: 'cli', command: 'echo "got {{response.name}}"' },
    },
  };
  
  const results = await bridge.batch([
    { tool: 'step1' },
    { tool: 'step2' },
  ], { chainResponses: true });
  
  assert(results.length === 2, 'batch returns 2 results');
  assert(results[0].ok === true, 'first step succeeds');
  assert(results[1].ok === true, 'second step succeeds');
}

// File-based config
console.log('\nFile Config:');
{
  const tmpConfig = resolve(__dirname, 'test-config.yaml');
  writeFileSync(tmpConfig, `
tools:
  file_test:
    description: Test from file
    type: cli
    command: echo hello
    timeout: 3000
`);
  
  const bridge = new ToolBridge({ config: tmpConfig });
  await bridge.load();
  
  assert(bridge.list().length === 1, 'loads tools from file');
  assert(bridge.info('file_test').timeout === 3000, 'reads config values');
  
  unlinkSync(tmpConfig);
}

// Error handling
console.log('\nError Handling:');
{
  const bridge = new ToolBridge();
  bridge.config = { tools: {} };
  
  try {
    await bridge.call('nonexistent');
    assert(false, 'should throw for missing tool');
  } catch (err) {
    assert(err.message.includes('not found'), 'throws for missing tool');
  }
  
  try {
    bridge.info('nonexistent');
    assert(false, 'should throw for missing tool info');
  } catch (err) {
    assert(err.message.includes('not found'), 'info throws for missing tool');
  }
  
  // CLI timeout
  bridge.config.tools = {
    slow: {
      type: 'cli',
      command: 'sleep 10',
      timeout: 100,
    },
  };
  
  const result = await bridge.call('slow');
  assert(result.error !== undefined, 'cli timeout returns error');
}

// Config loading with JSON
console.log('\nJSON Config:');
{
  const tmpConfig = resolve(__dirname, 'test-config.json');
  writeFileSync(tmpConfig, JSON.stringify({
    tools: {
      json_test: {
        description: 'From JSON',
        type: 'cli',
        command: 'echo json',
      },
    },
  }));
  
  const bridge = new ToolBridge({ config: tmpConfig });
  await bridge.load();
  
  assert(bridge.list().length === 1, 'loads tools from JSON file');
  
  unlinkSync(tmpConfig);
}

// Preset validation
console.log('\nPreset Validation:');
{
  const bridge = new ToolBridge();
  
  for (const [name, preset] of Object.entries(bridge.presets)) {
    let valid = true;
    for (const [toolName, def] of Object.entries(preset.tools || {})) {
      if (!def.type) valid = false;
      if (def.type === 'rest' && !def.url) valid = false;
      if (def.type === 'cli' && !def.command) valid = false;
    }
    assert(valid, `preset "${name}" is valid`);
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!\n');
}
