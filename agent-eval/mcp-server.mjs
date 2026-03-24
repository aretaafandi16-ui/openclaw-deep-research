#!/usr/bin/env node
/**
 * agent-eval MCP Server
 *
 * Tools:
 * 1. eval_score       — Score output against expected with a scorer
 * 2. eval_suite_create — Create an eval suite
 * 3. eval_case_add    — Add a test case
 * 4. eval_case_remove — Remove a test case
 * 5. eval_run         — Run all cases in a suite
 * 6. eval_run_case    — Run a single case
 * 7. eval_list        — List cases in a suite
 * 8. eval_history     — Get run history
 * 9. eval_export      — Export suite as JSON
 * 10. eval_import     — Import cases from JSON
 * 11. eval_compare    — A/B test two result sets
 * 12. eval_scorers    — List available scorers
 */

import { EvalSuite, BenchmarkRunner, Scorers, generateReport } from './index.mjs';
import { readFileSync } from 'node:fs';

const suites = new Map();

function getSuite(name, create = true) {
  if (!suites.has(name) && create) suites.set(name, new EvalSuite({ name }));
  return suites.get(name);
}

const TOOLS = [
  { name: 'eval_score', description: 'Score an actual output against expected using a scorer', inputSchema: { type: 'object', properties: { expected: { type: 'string' }, actual: { type: 'string' }, scorer: { type: 'string', enum: ['exact', 'contains', 'regex', 'similarity', 'json_schema', 'numeric', 'length', 'notEmpty'], default: 'contains' }, scorerOpts: { type: 'object' } }, required: ['expected', 'actual'] } },
  { name: 'eval_suite_create', description: 'Create a new eval suite', inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] } },
  { name: 'eval_case_add', description: 'Add a test case to a suite', inputSchema: { type: 'object', properties: { suite: { type: 'string' }, name: { type: 'string' }, input: { type: 'string' }, expected: { type: 'string' }, scorer: { type: 'string', default: 'contains' }, scorerOpts: { type: 'object' }, tags: { type: 'array', items: { type: 'string' } }, timeout: { type: 'number' }, retries: { type: 'number' } }, required: ['suite', 'name', 'input', 'expected'] } },
  { name: 'eval_case_remove', description: 'Remove a test case from a suite', inputSchema: { type: 'object', properties: { suite: { type: 'string' }, id: { type: 'string' } }, required: ['suite', 'id'] } },
  { name: 'eval_run', description: 'Run all cases in a suite with a provided executor (echo if not given)', inputSchema: { type: 'object', properties: { suite: { type: 'string' }, parallel: { type: 'boolean', default: false }, concurrency: { type: 'number', default: 4 }, filterTag: { type: 'string' } }, required: ['suite'] } },
  { name: 'eval_run_case', description: 'Run a single test case', inputSchema: { type: 'object', properties: { suite: { type: 'string' }, caseId: { type: 'string' } }, required: ['suite', 'caseId'] } },
  { name: 'eval_list', description: 'List test cases in a suite', inputSchema: { type: 'object', properties: { suite: { type: 'string' }, tag: { type: 'string' } }, required: ['suite'] } },
  { name: 'eval_history', description: 'Get run history for a suite', inputSchema: { type: 'object', properties: { suite: { type: 'string' } }, required: ['suite'] } },
  { name: 'eval_export', description: 'Export suite as JSON', inputSchema: { type: 'object', properties: { suite: { type: 'string' } }, required: ['suite'] } },
  { name: 'eval_import', description: 'Import test cases into a suite from JSON', inputSchema: { type: 'object', properties: { suite: { type: 'string' }, cases: { type: 'array', items: { type: 'object' } } }, required: ['suite', 'cases'] } },
  { name: 'eval_compare', description: 'Compare two run results (A/B test) for statistical significance', inputSchema: { type: 'object', properties: { suiteA: { type: 'string' }, suiteB: { type: 'string' }, runIdA: { type: 'string' }, runIdB: { type: 'string' } }, required: ['suiteA', 'suiteB', 'runIdA', 'runIdB'] } },
  { name: 'eval_scorers', description: 'List available scoring functions', inputSchema: { type: 'object', properties: {} } }
];

const HANDLERS = {
  async eval_score(args) {
    const scorer = args.scorer || 'contains';
    const fn = Scorers[scorer];
    if (!fn) throw new Error(`Unknown scorer: ${scorer}`);
    const result = fn(args.expected, args.actual, args.scorerOpts || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },

  async eval_suite_create(args) {
    const suite = new EvalSuite({ name: args.name, description: args.description || '' });
    suites.set(args.name, suite);
    return { content: [{ type: 'text', text: `Suite "${args.name}" created` }] };
  },

  async eval_case_add(args) {
    const suite = getSuite(args.suite);
    const tc = suite.add({ name: args.name, input: args.input, expected: args.expected, scorer: args.scorer, scorerOpts: args.scorerOpts, tags: args.tags, timeout: args.timeout, retries: args.retries });
    return { content: [{ type: 'text', text: `Added case "${tc.name}" (id: ${tc.id}) to suite "${args.suite}"` }] };
  },

  async eval_case_remove(args) {
    const suite = getSuite(args.suite, false);
    if (!suite) throw new Error(`Suite "${args.suite}" not found`);
    const ok = suite.remove(args.id);
    return { content: [{ type: 'text', text: ok ? `Removed case ${args.id}` : `Case ${args.id} not found` }] };
  },

  async eval_run(args) {
    const suite = getSuite(args.suite, false);
    if (!suite) throw new Error(`Suite "${args.suite}" not found`);
    const filter = args.filterTag ? { tag: args.filterTag } : {};
    const { runId, results, summary } = await suite.run(async (input) => input, { parallel: args.parallel, concurrency: args.concurrency, filter });
    return { content: [{ type: 'text', text: JSON.stringify({ runId, summary, results }, null, 2) }] };
  },

  async eval_run_case(args) {
    const suite = getSuite(args.suite, false);
    if (!suite) throw new Error(`Suite "${args.suite}" not found`);
    const tc = suite.cases.find(c => c.id === args.caseId);
    if (!tc) throw new Error(`Case "${args.caseId}" not found`);
    const result = await suite.runCase(tc, async (input) => input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },

  async eval_list(args) {
    const suite = getSuite(args.suite, false);
    if (!suite) throw new Error(`Suite "${args.suite}" not found`);
    const filter = args.tag ? { tag: args.tag } : {};
    const cases = suite.getCases(filter);
    return { content: [{ type: 'text', text: JSON.stringify(cases, null, 2) }] };
  },

  async eval_history(args) {
    const suite = getSuite(args.suite, false);
    if (!suite) throw new Error(`Suite "${args.suite}" not found`);
    const history = suite.getHistory();
    return { content: [{ type: 'text', text: JSON.stringify(history, null, 2) }] };
  },

  async eval_export(args) {
    const suite = getSuite(args.suite, false);
    if (!suite) throw new Error(`Suite "${args.suite}" not found`);
    return { content: [{ type: 'text', text: JSON.stringify(suite.export(), null, 2) }] };
  },

  async eval_import(args) {
    const suite = getSuite(args.suite);
    const count = suite.import(args.cases);
    return { content: [{ type: 'text', text: `Imported ${count} cases into "${args.suite}"` }] };
  },

  async eval_compare(args) {
    const suiteA = getSuite(args.suiteA, false);
    const suiteB = getSuite(args.suiteB, false);
    if (!suiteA || !suiteB) throw new Error('Both suites must exist');
    // For MCP, we compare the latest run results
    const historyA = suiteA.getHistory();
    const historyB = suiteB.getHistory();
    if (!historyA.length || !historyB.length) throw new Error('Both suites need run history');
    const runner = new BenchmarkRunner();
    const result = runner.abTest(
      { model: args.suiteA, results: historyA[historyA.length - 1].results || [] },
      { model: args.suiteB, results: historyB[historyB.length - 1].results || [] }
    );
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },

  async eval_scorers() {
    const list = Object.keys(Scorers).map(name => {
      const descriptions = {
        exact: 'Case-insensitive exact string match',
        contains: 'Output contains expected substring',
        regex: 'Regular expression pattern match',
        similarity: 'Dice coefficient on bigrams (default threshold 0.7)',
        json_schema: 'Simplified JSON schema validation',
        numeric: 'Numeric comparison with tolerance',
        length: 'Length check (eq/gt/gte/lt/lte/between)',
        notEmpty: 'Output is not empty'
      };
      return { name, description: descriptions[name] || '' };
    });
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
  }
};

// ─── JSON-RPC stdio MCP server ────────────────────────────────────────────────

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleRequest(line);
  }
});

async function handleRequest(raw) {
  let req;
  try { req = JSON.parse(raw); } catch { return; }

  const respond = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
  const error = (code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code, message } }) + '\n');

  if (req.method === 'initialize') {
    respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-eval', version: '1.0.0' } });
  } else if (req.method === 'notifications/initialized') {
    // no response needed
  } else if (req.method === 'tools/list') {
    respond({ tools: TOOLS });
  } else if (req.method === 'tools/call') {
    const handler = HANDLERS[req.params?.name];
    if (!handler) { error(-32601, `Unknown tool: ${req.params?.name}`); return; }
    try {
      const result = await handler(req.params.arguments || {});
      respond(result);
    } catch (err) {
      error(-32000, err.message);
    }
  } else {
    error(-32601, `Unknown method: ${req.method}`);
  }
}

process.stdin.resume();
