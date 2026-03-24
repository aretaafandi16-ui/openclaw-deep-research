#!/usr/bin/env node
/**
 * agent-eval CLI
 *
 * Usage:
 *   agent-eval run <suite.json> [--model name] [--parallel] [--concurrency N]
 *   agent-eval score <expected> <actual> [--scorer exact|contains|regex|similarity|json_schema]
 *   agent-eval add <suite.json> --name "Test" --input "..." --expected "..." [--scorer contains]
 *   agent-eval list <suite.json>
 *   agent-eval compare <resultsA.json> <resultsB.json>
 *   agent-eval demo
 *   agent-eval serve [--port PORT]
 *   agent-eval mcp
 */

import { EvalSuite, BenchmarkRunner, Scorers, generateReport } from './index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}
function hasFlag(name) { return args.includes(`--${name}`); }

async function main() {
  switch (cmd) {
    case 'run': return await cmdRun();
    case 'score': return cmdScore();
    case 'add': return cmdAdd();
    case 'list': return cmdList();
    case 'compare': return cmdCompare();
    case 'demo': return await cmdDemo();
    case 'serve': return await cmdServe();
    case 'mcp': return await import('./mcp-server.mjs');
    case 'help':
    case '--help':
    case undefined:
      return printHelp();
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
agent-eval — Evaluation & benchmarking toolkit for AI agents

COMMANDS:
  run <suite.json>      Run a test suite
    --executor <file>     JS module exporting async executor(input) => output
    --parallel            Run tests in parallel
    --concurrency N       Max parallel tests (default: 4)
    --output <file>       Save results to JSON
    --format text|json    Output format (default: text)

  score <expected> <actual>
    --scorer <type>       Scorer: exact, contains, regex, similarity, json_schema, numeric, length, not_empty

  add <suite.json>      Add a test case to a suite
    --name "..."          Test case name
    --input "..."         Input to send
    --expected "..."      Expected output
    --scorer <type>       Scorer type (default: contains)
    --tags "a,b,c"        Comma-separated tags

  list <suite.json>     List test cases in a suite
  compare <a.json> <b.json>  Compare two result files (A/B test)

  demo                  Run interactive demo
  serve                 Start HTTP dashboard (default port 3106)
  mcp                   Start MCP server (stdio)
  help                  Show this help

SCORERS:
  exact        Case-insensitive exact match
  contains     Output contains expected string
  regex        Regex pattern match
  similarity   Dice coefficient (bigram), threshold 0.7
  json_schema  Simplified JSON schema validation
  numeric      Numeric comparison with tolerance
  length       Length check (eq/gt/gte/lt/lte/between)
  notEmpty     Output is not empty

EXAMPLES:
  agent-eval score "hello world" "Hello World!" --scorer contains
  agent-eval score '{"type":"object"}' '{"name":"test"}' --scorer json_schema
  agent-eval run suite.json --executor executor.mjs --parallel
  agent-eval demo
`);
}

async function cmdRun() {
  const suiteFile = args[1];
  if (!suiteFile) { console.error('Usage: agent-eval run <suite.json> --executor <file>'); process.exit(1); }

  const data = JSON.parse(readFileSync(suiteFile, 'utf8'));
  const suite = new EvalSuite(data);
  suite.import(data);

  let executor;
  const executorFile = flag('executor');
  if (executorFile) {
    const mod = await import(executorFile);
    executor = mod.default || mod.executor || mod;
  } else {
    // Default: echo executor (for testing the eval framework itself)
    executor = async (input) => typeof input === 'string' ? input : JSON.stringify(input);
  }

  const format = flag('format') || 'text';
  const parallel = hasFlag('parallel');
  const concurrency = parseInt(flag('concurrency') || '4');

  suite.on('case:result', r => {
    if (format === 'text') {
      const icon = r.pass ? '✅' : '❌';
      console.log(`${icon} ${r.name}: ${r.detail} (${r.duration}ms)`);
    }
  });

  const { runId, results, summary } = await suite.run(executor, { parallel, concurrency });

  if (format === 'json') {
    console.log(JSON.stringify({ runId, results, summary }, null, 2));
  } else {
    console.log(`\n📊 Summary: ${summary.passed}/${summary.total} passed (${summary.passRate}%) | avg score: ${summary.avgScore} | avg latency: ${summary.avgDuration}ms`);
  }

  const output = flag('output');
  if (output) {
    writeFileSync(output, JSON.stringify({ runId, results, summary }, null, 2));
    console.log(`Results saved to ${output}`);
  }
}

function cmdScore() {
  const expected = args[1], actual = args[2];
  if (!expected || !actual) { console.error('Usage: agent-eval score <expected> <actual> --scorer <type>'); process.exit(1); }
  const scorer = flag('scorer') || 'contains';
  const result = Scorers[scorer]
    ? Scorers[scorer](expected, actual)
    : (() => { throw new Error(`Unknown scorer: ${scorer}`); })();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

function cmdAdd() {
  const suiteFile = args[1];
  if (!suiteFile) { console.error('Usage: agent-eval add <suite.json> --name "..." --input "..." --expected "..."'); process.exit(1); }
  const name = flag('name') || `test_${Date.now()}`;
  const input = flag('input');
  const expected = flag('expected');
  const scorer = flag('scorer') || 'contains';
  const tags = flag('tags')?.split(',').map(t => t.trim()) || [];
  if (!input || !expected) { console.error('--input and --expected required'); process.exit(1); }

  let data = existsSync(suiteFile) ? JSON.parse(readFileSync(suiteFile, 'utf8')) : { name: suiteFile.replace('.json', ''), cases: [] };
  data.cases.push({ name, input, expected, scorer, tags, createdAt: new Date().toISOString() });
  writeFileSync(suiteFile, JSON.stringify(data, null, 2));
  console.log(`✅ Added "${name}" to ${suiteFile} (${data.cases.length} cases)`);
}

function cmdList() {
  const suiteFile = args[1];
  if (!suiteFile) { console.error('Usage: agent-eval list <suite.json>'); process.exit(1); }
  const data = JSON.parse(readFileSync(suiteFile, 'utf8'));
  console.log(`Suite: ${data.name || suiteFile} (${data.cases?.length || 0} cases)\n`);
  for (const tc of (data.cases || [])) {
    console.log(`  ${tc.name}`);
    console.log(`    scorer: ${tc.scorer || 'contains'} | tags: ${(tc.tags || []).join(', ') || 'none'}`);
    console.log(`    input: ${typeof tc.input === 'string' ? tc.input.slice(0, 80) : JSON.stringify(tc.input).slice(0, 80)}`);
    console.log(`    expected: ${typeof tc.expected === 'string' ? tc.expected.slice(0, 80) : JSON.stringify(tc.expected).slice(0, 80)}`);
    console.log('');
  }
}

function cmdCompare() {
  const fileA = args[1], fileB = args[2];
  if (!fileA || !fileB) { console.error('Usage: agent-eval compare <resultsA.json> <resultsB.json>'); process.exit(1); }
  const a = JSON.parse(readFileSync(fileA, 'utf8'));
  const b = JSON.parse(readFileSync(fileB, 'utf8'));
  const runner = new BenchmarkRunner();
  const result = runner.abTest(a, b);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdDemo() {
  console.log('🧪 agent-eval Demo\n');

  const suite = new EvalSuite({ name: 'demo', description: 'Demo evaluation suite' });

  // Add test cases
  suite.add({ name: 'Exact match', input: 'hello', expected: 'hello', scorer: 'exact' });
  suite.add({ name: 'Contains check', input: 'The answer is 42', expected: 'answer is 42', scorer: 'contains' });
  suite.add({ name: 'Regex match', input: 'Order #12345 confirmed', expected: 'Order #\\d+ confirmed', scorer: 'regex' });
  suite.add({ name: 'Similarity high', input: 'The quick brown fox', expected: 'The fast brown fox', scorer: 'similarity', scorerOpts: { threshold: 0.6 } });
  suite.add({ name: 'JSON schema', input: '{"name":"test","value":42}', expected: { type: 'object', required: ['name', 'value'], properties: { name: { type: 'string' }, value: { type: 'number' } } }, scorer: 'json_schema' });
  suite.add({ name: 'Numeric tolerance', input: '3.14', expected: 3.14159, scorer: 'numeric', scorerOpts: { tolerance: 0.01 } });
  suite.add({ name: 'Not empty', input: 'some output', expected: '', scorer: 'notEmpty' });
  suite.add({ name: 'Length between', input: 'hello world', expected: [5, 20], scorer: 'length', scorerOpts: { operator: 'between' } });
  suite.add({ name: 'Should fail', input: 'wrong output', expected: 'correct output', scorer: 'exact' });
  suite.add({ name: 'Case insensitive', input: 'Hello World', expected: 'hello world', scorer: 'exact' });

  // Run with echo executor
  suite.on('case:result', r => {
    const icon = r.pass ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}: ${r.detail} (${r.duration}ms)`);
  });

  const { summary } = await suite.run(async (input) => input);
  console.log(`\n📊 ${summary.passed}/${summary.total} passed (${summary.passRate}%)`);
  console.log(`   Avg score: ${summary.avgScore} | Avg latency: ${summary.avgDuration}ms`);

  // Benchmark demo
  console.log('\n🏆 Benchmark Demo (2 mock models)\n');
  const bench = new BenchmarkRunner();
  bench.addSuite(suite);
  bench.addModel('fast-model', async (input) => input); // echo = always correct
  bench.addModel('slow-model', async (input) => {
    await new Promise(r => setTimeout(r, 50));
    return input === 'wrong output' ? 'different' : input.toUpperCase();
  });

  const benchResult = await bench.runAll('demo');
  console.log('\nLeaderboard:');
  for (const r of benchResult.comparison.ranked) {
    console.log(`  ${r.model}: score=${r.avgScore} pass=${r.passRate}% latency=${r.avgDuration}ms`);
  }
  console.log(`\nWinner: ${benchResult.comparison.best}`);
}

async function cmdServe() {
  const port = parseInt(flag('port') || '3106');
  const { default: server } = await import('./server.mjs');
  // server.mjs exports start function
  if (typeof server === 'function') server(port);
}

main().catch(err => { console.error(err); process.exit(1); });
