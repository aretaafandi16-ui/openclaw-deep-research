#!/usr/bin/env node

/**
 * agent-transform CLI
 * Usage: agent-transform <command> [options]
 */

import { TransformEngine, parseCSV, stringifyCSV, transform, transforms } from './index.mjs';
import { readFileSync, writeFileSync } from 'fs';

const USAGE = `
agent-transform — Data transformation engine for AI agents

COMMANDS:
  transform   Apply transform steps to JSON/CSV input
  map         Apply field mapping to records
  filter      Filter array by condition
  flatten     Flatten nested JSON
  csv         Convert between CSV and JSON
  validate    Validate data against rules
  aggregate   Aggregate array data
  pipeline    Run a named pipeline
  list        List available transforms
  demo        Run demonstration
  serve       Start HTTP server
  mcp         Start MCP server
  help        Show this help

OPTIONS:
  --input, -i     Input file (default: stdin)
  --output, -o    Output file (default: stdout)
  --steps, -s     Transform steps as JSON
  --mapping, -m   Field mapping as JSON
  --condition, -c Filter condition
  --fields, -f    Comma-separated field names
  --separator     CSV separator (default: ,)
  --format        Output format: json, csv, jsonl (default: json)
  --indent        JSON indent (default: 2)
`;

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') || args[i].startsWith('-')) {
      const key = args[i].replace(/^-+/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      flags[key] = args[i + 1] || true;
      if (args[i + 1] && !args[i + 1].startsWith('-')) i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

function getInput(flags) {
  if (flags.input || flags.i) {
    return readFileSync(flags.input || flags.i, 'utf8');
  }
  // Read from stdin
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 100);
  });
}

function output(data, flags) {
  const fmt = flags.format || 'json';
  const indent = flags.indent !== undefined ? Number(flags.indent) : 2;
  let str;
  if (fmt === 'csv') {
    str = stringifyCSV(Array.isArray(data) ? data : [data]);
  } else if (fmt === 'jsonl') {
    str = (Array.isArray(data) ? data : [data]).map(l => JSON.stringify(l)).join('\n');
  } else {
    str = JSON.stringify(data, null, indent);
  }
  if (flags.output || flags.o) {
    writeFileSync(flags.output || flags.o, str);
  } else {
    process.stdout.write(str + '\n');
  }
}

function demo() {
  const engine = new TransformEngine();
  const sampleData = [
    { id: 1, name: '  Alice Smith  ', email: 'ALICE@EXAMPLE.COM', age: '30', score: 85.5, tags: ['admin', 'user'], nested: { city: 'NYC', zip: '10001' } },
    { id: 2, name: '  Bob Jones  ', email: 'bob@example.com', age: '25', score: 92.3, tags: ['user'], nested: { city: 'LA', zip: '90001' } },
    { id: 3, name: '  charlie brown  ', email: 'CHARLIE@EXAMPLE.COM', age: '35', score: 78.1, tags: ['user', 'moderator'], nested: { city: 'Chicago', zip: '60601' } },
    { id: 4, name: '  Diana Prince  ', email: 'diana@example.com', age: '28', score: 95.7, tags: ['admin'], nested: { city: 'NYC', zip: '10002' } },
  ];

  console.log('=== agent-transform Demo ===\n');

  // 1. Field mapping
  console.log('1. Field Mapping:');
  const mapped = engine.execute([
    {
      type: 'map',
      mapping: {
        user_id: { $source: 'id' },
        full_name: { $source: 'name', $transform: ['trim', 'titleCase'] },
        contact: { $source: 'email', $transform: ['lowercase'] },
        age_years: { $source: 'age', $transform: ['coerce_number'] },
        rating: { $source: 'score' },
        location: { $expr: '{{nested.city}} ({{nested.zip}})' },
      }
    }
  ], sampleData);
  console.log(JSON.stringify(mapped.result.slice(0, 2), null, 2));

  // 2. Filter
  console.log('\n2. Filter (age > 27):');
  const filtered = engine.execute([
    { type: 'filter', condition: { age: { $gt: 27 } } }
  ], sampleData);
  console.log(JSON.stringify(filtered.result.map(r => r.name.trim()), null, 2));

  // 3. Flatten
  console.log('\n3. Flatten:');
  const flat = engine.execute([{ type: 'flatten' }], sampleData[0]);
  console.log(JSON.stringify(flat.result, null, 2));

  // 4. Coerce types
  console.log('\n4. Type Coercion:');
  const coerced = engine.execute([
    { type: 'coerce', fields: { age: 'number', email: 'string' } }
  ], sampleData[0]);
  console.log(JSON.stringify({ age: coerced.result.age, ageType: typeof coerced.result.age }, null, 2));

  // 5. CSV round-trip
  console.log('\n5. CSV Parse/Stringify:');
  const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
  const parsed = engine.execute([{ type: 'csv_parse' }], csv);
  console.log('Parsed:', JSON.stringify(parsed.result, null, 2));
  const csvOut = engine.execute([{ type: 'csv_stringify' }], parsed.result);
  console.log('Back to CSV:', csvOut.result);

  // 6. Aggregate
  console.log('\n6. Aggregate:');
  const agg = engine.execute([{
    type: 'aggregate',
    operations: {
      avg_score: { fn: 'avg', field: 'score' },
      max_age: { fn: 'max', field: 'age' },
      total: { fn: 'count' },
    }
  }], sampleData);
  console.log(JSON.stringify(agg.result, null, 2));

  // 7. Sort + Pick
  console.log('\n7. Sort by score desc, pick name+score:');
  const sorted = engine.execute([
    { type: 'sort', by: [{ field: 'score', desc: true }] },
    { type: 'pick', fields: ['name', 'score'] },
  ], sampleData);
  console.log(JSON.stringify(sorted.result, null, 2));

  // 8. Group
  console.log('\n8. Group by city:');
  const grouped = engine.execute([
    { type: 'group', by: 'nested.city', asArray: true }
  ], sampleData);
  console.log(JSON.stringify(grouped.result.map(g => ({ city: g.key, count: g.items.length })), null, 2));

  // 9. Pipeline
  console.log('\n9. Pipeline (filter → sort → pick → add computed field):');
  const piped = engine.execute([
    { type: 'filter', condition: 'score' },
    { type: 'sort', by: [{ field: 'score', desc: true }] },
    { type: 'pick', fields: ['name', 'score', 'age'] },
    { type: 'add', fields: { tier: { $expr: 'Tier {{score}}' } } },
  ], sampleData);
  console.log(JSON.stringify(piped.result, null, 2));

  // 10. Pivot
  console.log('\n10. Pivot:');
  const pivotData = [
    { metric: 'score', alice: 85, bob: 92 },
    { metric: 'age', alice: 30, bob: 25 },
  ];
  const unpivoted = engine.execute([{ type: 'unpivot', exclude: ['metric'], key: 'person', value: 'val' }], pivotData[0]);
  console.log(JSON.stringify(unpivoted.result, null, 2));

  // 11. Validate
  console.log('\n11. Validate:');
  const valid = engine.execute([{
    type: 'validate',
    rules: {
      name: { required: true, type: 'string', minLength: 3 },
      age: { required: true, type: 'number', min: 0, max: 150 },
      email: { required: true, pattern: '^.+@.+\\..+$' },
    }
  }], sampleData);
  console.log(JSON.stringify({ valid: valid.result.valid, errorCount: valid.result.errors.length }, null, 2));

  // 12. Template
  console.log('\n12. Template:');
  const templated = engine.execute([
    { type: 'template', template: '{{name}} is {{age}} years old from {{nested.city}}' }
  ], sampleData);
  console.log(JSON.stringify(templated.result.slice(0, 2), null, 2));

  console.log('\n=== Stats ===');
  console.log(JSON.stringify(engine.getStats(), null, 2));
  console.log('\n=== Available Transforms ===');
  console.log(engine.listTransforms().join(', '));
}

async function main() {
  const args = process.argv.slice(2);
  const { flags, positional } = parseArgs(args);
  const cmd = positional[0] || 'help';

  switch (cmd) {
    case 'demo':
      demo();
      break;

    case 'list': {
      const engine = new TransformEngine();
      console.log('Available transforms:\n');
      for (const name of engine.listTransforms()) {
        console.log(`  ${name}`);
      }
      break;
    }

    case 'transform': {
      const steps = JSON.parse(flags.steps || flags.s || '[]');
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const data = input.trim().startsWith('{') || input.trim().startsWith('[') ? JSON.parse(input) : input;
      const engine = new TransformEngine();
      const { result, errors, elapsed } = engine.execute(steps, data);
      output(flags.format === 'csv' ? result : (errors.length ? { result, errors } : result), flags);
      break;
    }

    case 'map': {
      const mapping = JSON.parse(flags.mapping || flags.m || '{}');
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const data = JSON.parse(input);
      const engine = new TransformEngine();
      const { result } = engine.execute([{ type: 'map', mapping }], data);
      output(result, flags);
      break;
    }

    case 'filter': {
      const condition = JSON.parse(flags.condition || flags.c || '{}');
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const data = JSON.parse(input);
      const engine = new TransformEngine();
      const { result } = engine.execute([{ type: 'filter', condition }], data);
      output(result, flags);
      break;
    }

    case 'flatten': {
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const data = JSON.parse(input);
      const engine = new TransformEngine();
      const { result } = engine.execute([{ type: 'flatten', unflatten: flags.unflatten }], data);
      output(result, flags);
      break;
    }

    case 'csv': {
      const subcmd = positional[1] || 'parse';
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const engine = new TransformEngine();
      if (subcmd === 'parse') {
        const { result } = engine.execute([{ type: 'csv_parse', separator: flags.separator || ',' }], input);
        output(result, flags);
      } else {
        const data = JSON.parse(input);
        const { result } = engine.execute([{ type: 'csv_stringify', separator: flags.separator || ',', fields: flags.fields?.split(',') }], data);
        process.stdout.write(result + '\n');
      }
      break;
    }

    case 'validate': {
      const rules = JSON.parse(flags.rules || flags.r || '{}');
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const data = JSON.parse(input);
      const engine = new TransformEngine();
      const { result } = engine.execute([{ type: 'validate', rules, strict: flags.strict }], data);
      output(result, flags);
      break;
    }

    case 'aggregate': {
      const ops = JSON.parse(flags.operations || flags.ops || '{}');
      const input = flags.input || flags.i
        ? readFileSync(flags.input || flags.i, 'utf8')
        : await new Promise(r => { let d = ''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); });
      const data = JSON.parse(input);
      const engine = new TransformEngine();
      const { result } = engine.execute([{ type: 'aggregate', operations: ops }], data);
      output(result, flags);
      break;
    }

    case 'help':
    default:
      console.log(USAGE);
      break;
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
