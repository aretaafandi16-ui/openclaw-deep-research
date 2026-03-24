#!/usr/bin/env node
// agent-diff CLI
import { AgentDiff } from './index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const diff = new AgentDiff();
const [,, cmd, ...args] = process.argv;

const commands = {
  'diff': () => {
    const [f1, f2] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff diff <file1.json> <file2.json>');
    const a = JSON.parse(readFileSync(f1, 'utf8'));
    const b = JSON.parse(readFileSync(f2, 'utf8'));
    console.log(JSON.stringify(diff.diff(a, b), null, 2));
  },
  'patch': () => {
    const [f1, f2] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff patch <file1.json> <file2.json>');
    const a = JSON.parse(readFileSync(f1, 'utf8'));
    const b = JSON.parse(readFileSync(f2, 'utf8'));
    console.log(JSON.stringify(diff.patch(a, b), null, 2));
  },
  'apply': () => {
    const [docFile, patchFile] = args;
    if (!docFile || !patchFile) return console.error('Usage: agent-diff apply <doc.json> <patches.json>');
    const doc = JSON.parse(readFileSync(docFile, 'utf8'));
    const patches = JSON.parse(readFileSync(patchFile, 'utf8'));
    console.log(JSON.stringify(diff.applyPatch(doc, patches), null, 2));
  },
  'merge': () => {
    const [f1, f2, strategy] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff merge <base.json> <override.json> [strategy]');
    const a = JSON.parse(readFileSync(f1, 'utf8'));
    const b = JSON.parse(readFileSync(f2, 'utf8'));
    console.log(JSON.stringify(diff.merge(a, b, strategy || 'override'), null, 2));
  },
  'three-way': () => {
    const [baseF, oursF, theirsF, strategy] = args;
    if (!baseF || !oursF || !theirsF) return console.error('Usage: agent-diff three-way <base.json> <ours.json> <theirs.json> [strategy]');
    const base = JSON.parse(readFileSync(baseF, 'utf8'));
    const ours = JSON.parse(readFileSync(oursF, 'utf8'));
    const theirs = JSON.parse(readFileSync(theirsF, 'utf8'));
    console.log(JSON.stringify(diff.threeWay(base, ours, theirs, strategy || 'override'), null, 2));
  },
  'text': () => {
    const [f1, f2] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff text <file1> <file2>');
    const a = readFileSync(f1, 'utf8');
    const b = readFileSync(f2, 'utf8');
    const result = diff.textDiff(a, b);
    for (const c of result.changes) {
      const prefix = c.type === 'add' ? '+' : c.type === 'remove' ? '-' : ' ';
      console.log(`${prefix} ${c.content}`);
    }
    console.log(`\n${result.stats.added} added, ${result.stats.removed} removed, ${result.stats.equal} unchanged`);
  },
  'unified': () => {
    const [f1, f2] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff unified <file1> <file2>');
    const a = readFileSync(f1, 'utf8');
    const b = readFileSync(f2, 'utf8');
    console.log(diff.unifiedDiff(f1, a, b).unified);
  },
  'stats': () => {
    const [f1, f2] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff stats <file1.json> <file2.json>');
    const a = JSON.parse(readFileSync(f1, 'utf8'));
    const b = JSON.parse(readFileSync(f2, 'utf8'));
    console.log(JSON.stringify(diff.stats(a, b), null, 2));
  },
  'equal': () => {
    const [f1, f2] = args;
    if (!f1 || !f2) return console.error('Usage: agent-diff equal <file1.json> <file2.json>');
    const a = JSON.parse(readFileSync(f1, 'utf8'));
    const b = JSON.parse(readFileSync(f2, 'utf8'));
    console.log(diff.isEqual(a, b) ? 'equal' : 'not equal');
  },
  'serve': async () => {
    await import('./server.mjs');
  },
  'mcp': async () => {
    await import('./mcp-server.mjs');
  },
  'demo': () => demo(),
  'help': () => printHelp()
};

function demo() {
  console.log('=== agent-diff Demo ===\n');

  const user1 = { name: 'Alice', age: 30, skills: ['js', 'python'], address: { city: 'NYC', zip: '10001' } };
  const user2 = { name: 'Alice', age: 31, skills: ['js', 'python', 'rust'], address: { city: 'SF', zip: '94102' } };

  console.log('1. Deep Diff:');
  console.log(JSON.stringify(diff.diff(user1, user2), null, 2));

  console.log('\n2. JSON Patch:');
  console.log(JSON.stringify(diff.patch(user1, user2), null, 2));

  console.log('\n3. Merge (override):');
  const base = { a: 1, b: { c: 2, d: 3 } };
  const over = { b: { c: 99, e: 5 }, f: 6 };
  console.log(JSON.stringify(diff.merge(base, over), null, 2));

  console.log('\n4. Three-way Merge:');
  const myBase = { x: 1, y: 2 };
  const mine = { x: 1, y: 10 };
  const theirs = { x: 1, y: 20 };
  const twm = diff.threeWay(myBase, mine, theirs);
  console.log('Merged:', JSON.stringify(twm.merged));
  console.log('Conflicts:', twm.conflicts.length);

  console.log('\n5. Text Diff:');
  const result = diff.textDiff('hello world\nfoo bar\nbaz', 'hello world\nfoo baz\nqux\nbaz');
  for (const c of result.changes) {
    const p = c.type === 'add' ? '+' : c.type === 'remove' ? '-' : ' ';
    console.log(`  ${p} ${c.content}`);
  }
  console.log(`  Stats: +${result.stats.added} -${result.stats.removed} =${result.stats.equal}`);

  console.log('\n6. Unified Diff:');
  console.log(diff.unifiedDiff('config.json', '{"a":1,"b":2}', '{"a":1,"b":3,"c":4}').unified);

  console.log('\n7. Stats:');
  console.log(JSON.stringify(diff.stats(user1, user2), null, 2));
}

function printHelp() {
  console.log(`agent-diff — Deep diff, patch & merge for AI agents

COMMANDS:
  diff <f1> <f2>           Deep diff two JSON files
  patch <f1> <f2>          Generate JSON patch (RFC 6902)
  apply <doc> <patch>      Apply JSON patches to document
  merge <base> <over> [s]  Deep merge (strategies: override, base, shallow, concat, deep, array_union)
  three-way <b> <o> <t>    Three-way merge with conflict detection
  text <f1> <f2>           Line-level text diff
  unified <f1> <f2>        Unified diff format
  stats <f1> <f2>          Diff statistics
  equal <f1> <f2>          Deep equality check
  serve                    Start HTTP server (port 3124)
  mcp                      Start MCP server (stdio)
  demo                     Run demo
  help                     Show this help`);
}

if (!cmd || cmd === 'help') printHelp();
else if (commands[cmd]) commands[cmd]();
else console.error(`Unknown command: ${cmd}. Run 'agent-diff help'`);
