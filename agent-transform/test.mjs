#!/usr/bin/env node

/**
 * agent-transform test suite
 */

import { TransformEngine, parseCSV, stringifyCSV, transform, transforms } from './index.mjs';

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log('agent-transform test suite\n');

const engine = new TransformEngine();
const sampleData = [
  { id: 1, name: 'Alice', age: 30, score: 85.5, status: 'active', tags: ['admin', 'user'], nested: { city: 'NYC', zip: '10001' } },
  { id: 2, name: 'Bob', age: 25, score: 92.3, status: 'inactive', tags: ['user'], nested: { city: 'LA', zip: '90001' } },
  { id: 3, name: 'Charlie', age: 35, score: 78.1, status: 'active', tags: ['user', 'mod'], nested: { city: 'NYC', zip: '10002' } },
  { id: 4, name: 'Diana', age: 28, score: 95.7, status: 'active', tags: ['admin'], nested: { city: 'Chicago', zip: '60601' } },
];

// ─── Field Mapping ─────────────────────────────────────────────────────────

test('map: field rename', () => {
  const { result } = engine.execute([{
    type: 'map',
    mapping: { user_id: 'id', full_name: 'name' }
  }], sampleData);
  assert('has user_id', result[0].user_id === 1);
  assert('has full_name', result[0].full_name === 'Alice');
  assert('original id removed', result[0].id === undefined);
});

test('map: $source with $transform', () => {
  const { result } = engine.execute([{
    type: 'map',
    mapping: {
      email: { $source: 'name', $transform: ['lowercase'] },
      rating: { $source: 'score' },
    }
  }], sampleData[0]);
  assert('email lowered', result.email === 'alice');
  assert('rating copied', result.rating === 85.5);
});

test('map: $expr template', () => {
  const { result } = engine.execute([{
    type: 'map',
    mapping: { location: { $expr: '{{nested.city}} ({{nested.zip}})' } }
  }], sampleData[0]);
  assert('template interpolated', result.location === 'NYC (10001)');
});

test('map: $const', () => {
  const { result } = engine.execute([{
    type: 'map',
    mapping: { source: { $const: 'internal' } }
  }], sampleData[0]);
  assert('const set', result.source === 'internal');
});

test('map: $default fallback', () => {
  const { result } = engine.execute([{
    type: 'map',
    mapping: { missing: { $source: 'nonexistent', $default: 'fallback' } }
  }], sampleData[0]);
  assert('default used', result.missing === 'fallback');
});

// ─── Filter ────────────────────────────────────────────────────────────────

test('filter: $gt', () => {
  const { result } = engine.execute([{ type: 'filter', condition: { age: { $gt: 27 } } }], sampleData);
  assert('filtered', result.length === 3);
  assert('no Bob', !result.find(r => r.name === 'Bob'));
});

test('filter: $and + $or', () => {
  const { result } = engine.execute([{
    type: 'filter',
    condition: { $and: [{ status: 'active' }, { score: { $gt: 80 } }] }
  }], sampleData);
  assert('and filtered', result.length === 2);
  assert('no Bob/Charlie', !result.find(r => r.name === 'Bob') && !result.find(r => r.name === 'Charlie'));
});

test('filter: $in', () => {
  const { result } = engine.execute([{
    type: 'filter',
    condition: { name: { $in: ['Alice', 'Bob'] } }
  }], sampleData);
  assert('filtered', result.length === 2);
});

test('filter: $contains', () => {
  const { result } = engine.execute([{
    type: 'filter',
    condition: { name: { $contains: 'ob' } }
  }], sampleData);
  assert('filtered', result.length === 1 && result[0].name === 'Bob');
});

test('filter: string expression', () => {
  const { result } = engine.execute([{ type: 'filter', condition: 'score > 90' }], sampleData);
  assert('filtered', result.length === 2);
});

// ─── Flatten / Unflatten ───────────────────────────────────────────────────

test('flatten: nested to dot-notation', () => {
  const { result } = engine.execute([{ type: 'flatten' }], sampleData[0]);
  assert('flattened', result['nested.city'] === 'NYC');
  assert('flattened zip', result['nested.zip'] === '10001');
});

test('unflatten: dot-notation to nested', () => {
  const { result } = engine.execute([{ type: 'unflatten' }], { 'a.b.c': 1, 'a.d': 2 });
  assert('unflattened', result.a.b.c === 1);
  assert('unflattened d', result.a.d === 2);
});

// ─── Coerce ────────────────────────────────────────────────────────────────

test('coerce: string to number', () => {
  const { result } = engine.execute([{ type: 'coerce', fields: { age: 'number' } }], { age: '30' });
  assert('coerced', result.age === 30);
});

test('coerce: to boolean', () => {
  const { result } = engine.execute([{ type: 'coerce', fields: { active: 'boolean' } }], { active: 'true' });
  assert('coerced', result.active === true);
});

// ─── Pick / Omit ───────────────────────────────────────────────────────────

test('pick: select fields', () => {
  const { result } = engine.execute([{ type: 'pick', fields: ['name', 'age'] }], sampleData[0]);
  assert('picked', Object.keys(result).length === 2);
  assert('name present', result.name === 'Alice');
});

test('omit: exclude fields', () => {
  const { result } = engine.execute([{ type: 'omit', fields: ['tags', 'nested'] }], sampleData[0]);
  assert('omitted', !result.tags && !result.nested);
});

// ─── Rename ────────────────────────────────────────────────────────────────

test('rename: field names', () => {
  const { result } = engine.execute([{ type: 'rename', fields: { name: 'full_name', age: 'years' } }], sampleData[0]);
  assert('renamed name', result.full_name === 'Alice');
  assert('renamed age', result.years === 30);
  assert('old removed', result.name === undefined);
});

// ─── Sort ──────────────────────────────────────────────────────────────────

test('sort: ascending', () => {
  const { result } = engine.execute([{ type: 'sort', by: ['age'] }], sampleData);
  assert('sorted', result[0].name === 'Bob' && result[3].name === 'Charlie');
});

test('sort: descending', () => {
  const { result } = engine.execute([{ type: 'sort', by: [{ field: 'score', desc: true }] }], sampleData);
  assert('sorted desc', result[0].name === 'Diana');
});

// ─── Group ─────────────────────────────────────────────────────────────────

test('group: by field', () => {
  const { result } = engine.execute([{ type: 'group', by: 'status', asArray: true }], sampleData);
  assert('grouped', result.length === 2);
  assert('active group', result.find(g => g.key === 'active').items.length === 3);
});

// ─── Unique ────────────────────────────────────────────────────────────────

test('unique: by field', () => {
  const data = [{ city: 'NYC' }, { city: 'LA' }, { city: 'NYC' }];
  const { result } = engine.execute([{ type: 'unique', by: 'city' }], data);
  assert('deduplicated', result.length === 2);
});

// ─── Aggregate ─────────────────────────────────────────────────────────────

test('aggregate: sum, avg, max, count', () => {
  const { result } = engine.execute([{
    type: 'aggregate',
    operations: {
      total: { fn: 'sum', field: 'score' },
      avg: { fn: 'avg', field: 'score' },
      max: { fn: 'max', field: 'score' },
      count: { fn: 'count' },
    }
  }], sampleData);
  assert('total', Math.round(result.total) === 352);
  assert('count', result.count === 4);
  assert('max', result.max === 95.7);
});

// ─── Validate ──────────────────────────────────────────────────────────────

test('validate: required + type + range', () => {
  const { result } = engine.execute([{
    type: 'validate',
    rules: {
      name: { required: true, type: 'string', minLength: 2 },
      age: { required: true, type: 'number', min: 0, max: 150 },
    }
  }], sampleData);
  assert('valid', result.valid);
  assert('no errors', result.errors.length === 0);
});

test('validate: catches errors', () => {
  const { result } = engine.execute([{
    type: 'validate',
    rules: { email: { required: true } }
  }], sampleData);
  assert('invalid', !result.valid);
  assert('4 errors', result.errors.length === 4);
});

// ─── CSV ───────────────────────────────────────────────────────────────────

test('csv_parse: standard CSV', () => {
  const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
  const { result } = engine.execute([{ type: 'csv_parse' }], csv);
  assert('parsed', result.length === 2);
  assert('fields', result[0].name === 'Alice' && result[0].age === '30');
});

test('csv_parse: quoted fields', () => {
  const csv = 'name,desc\nAlice,"She said ""hello"""\nBob,"Has, comma"';
  const { result } = engine.execute([{ type: 'csv_parse' }], csv);
  assert('quoted', result[0].desc === 'She said "hello"');
  assert('comma in quotes', result[1].desc === 'Has, comma');
});

test('csv_stringify: array to CSV', () => {
  const data = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }];
  const { result } = engine.execute([{ type: 'csv_stringify' }], data);
  assert('header', result.startsWith('name,age'));
  assert('rows', result.split('\n').length === 3);
});

// ─── JSONL ─────────────────────────────────────────────────────────────────

test('jsonl_parse: newline JSON', () => {
  const jsonl = '{"a":1}\n{"b":2}\n{"c":3}';
  const { result } = engine.execute([{ type: 'jsonl_parse' }], jsonl);
  assert('parsed', result.length === 3);
  assert('values', result[0].a === 1 && result[2].c === 3);
});

test('jsonl_stringify: array to JSONL', () => {
  const { result } = engine.execute([{ type: 'jsonl_stringify' }], [{ a: 1 }, { b: 2 }]);
  assert('lines', result.split('\n').length === 2);
  assert('json', JSON.parse(result.split('\n')[0]).a === 1);
});

// ─── Template ──────────────────────────────────────────────────────────────

test('template: interpolation', () => {
  const { result } = engine.execute([{
    type: 'template',
    template: '{{name}} is {{age}} years old'
  }], sampleData[0]);
  assert('interpolated', result === 'Alice is 30 years old');
});

test('template: array', () => {
  const { result } = engine.execute([{
    type: 'template',
    template: '{{name}}: {{score}}'
  }], sampleData);
  assert('array', result.length === 4);
  assert('first', result[0] === 'Alice: 85.5');
});

// ─── Add / Delete fields ──────────────────────────────────────────────────

test('add: computed field', () => {
  const { result } = engine.execute([{
    type: 'add',
    fields: { tier: { $const: 'gold' }, greeting: { $expr: 'Hi {{name}}!' } }
  }], sampleData[0]);
  assert('const', result.tier === 'gold');
  assert('expr', result.greeting === 'Hi Alice!');
});

test('delete: remove fields', () => {
  const { result } = engine.execute([{ type: 'delete', fields: ['tags', 'nested'] }], sampleData[0]);
  assert('deleted', !result.tags && !result.nested);
  assert('kept', result.name === 'Alice');
});

// ─── Pivot / Unpivot ──────────────────────────────────────────────────────

test('pivot: long to wide', () => {
  const data = [
    { metric: 'score', alice: 85, bob: 92 },
    { metric: 'age', alice: 30, bob: 25 },
  ];
  const { result } = engine.execute([{
    type: 'pivot',
    key: 'metric',
    value: 'alice',
  }], data);
  assert('pivoted', result.score === 85);
});

test('unpivot: wide to long', () => {
  const { result } = engine.execute([{
    type: 'unpivot',
    key: 'field',
    value: 'val',
  }], { a: 1, b: 2, c: 3 });
  assert('unpivoted', result.length === 3);
  assert('fields', result[0].field === 'a' && result[0].val === 1);
});

// ─── Spread ────────────────────────────────────────────────────────────────

test('spread: nested array', () => {
  const data = [{ id: 1, items: ['a', 'b'] }, { id: 2, items: ['c'] }];
  const { result } = engine.execute([{ type: 'spread', field: 'items', as: 'tag' }], data);
  assert('spread', result.length === 3);
  assert('first', result[0].id === 1 && result[0].tag === 'a');
});

// ─── Chunk ─────────────────────────────────────────────────────────────────

test('chunk: split array', () => {
  const { result } = engine.execute([{ type: 'chunk', size: 2 }], [1, 2, 3, 4, 5]);
  assert('chunked', result.length === 3);
  assert('sizes', result[0].length === 2 && result[2].length === 1);
});

// ─── Sample ────────────────────────────────────────────────────────────────

test('sample: first N', () => {
  const { result } = engine.execute([{ type: 'sample', count: 2 }], sampleData);
  assert('sampled', result.length === 2);
});

// ─── Branch ────────────────────────────────────────────────────────────────

test('branch: conditional execution', () => {
  const { result } = engine.execute([{
    type: 'branch',
    branches: [
      { when: { age: { $gte: 30 } }, then: [{ type: 'map', mapping: { group: { $const: 'senior' } } }] },
      { when: { age: { $lt: 30 } }, then: [{ type: 'map', mapping: { group: { $const: 'junior' } } }] },
    ],
    otherwise: [{ type: 'map', mapping: { group: { $const: 'other' } } }],
  }], sampleData[0]);
  assert('branched', result.group === 'senior');
});

// ─── Pipeline ──────────────────────────────────────────────────────────────

test('pipeline: nested steps', () => {
  const { result } = engine.execute([{
    type: 'pipeline',
    steps: [
      { type: 'filter', condition: { status: 'active' } },
      { type: 'sort', by: [{ field: 'score', desc: true }] },
      { type: 'pick', fields: ['name', 'score'] },
    ]
  }], sampleData);
  assert('piped', result.length === 3);
  assert('sorted', result[0].name === 'Diana');
});

// ─── Named Pipeline ────────────────────────────────────────────────────────

test('definePipeline / runPipeline', () => {
  engine.definePipeline('top-scorers', [
    { type: 'filter', condition: { score: { $gt: 80 } } },
    { type: 'sort', by: [{ field: 'score', desc: true }] },
    { type: 'pick', fields: ['name', 'score'] },
  ]);
  const { result } = engine.runPipeline('top-scorers', sampleData);
  assert('named', result.length === 3);
  assert('top', result[0].name === 'Diana');
});

// ─── Custom Transform ─────────────────────────────────────────────────────

test('registerTransform: custom function', () => {
  engine.registerTransform('double', v => typeof v === 'number' ? v * 2 : v);
  const { result } = engine.execute([{ type: 'transform', fields: { age: 'double' } }], { age: 15 });
  assert('doubled', result.age === 30);
});

// ─── Transform built-ins ──────────────────────────────────────────────────

test('builtins: uppercase/lowercase/trim', () => {
  assert('upper', transforms.uppercase('hello') === 'HELLO');
  assert('lower', transforms.lowercase('HELLO') === 'hello');
  assert('trim', transforms.trim('  hi  ') === 'hi');
});

test('builtins: slug/capitalize/titleCase', () => {
  assert('slug', transforms.slug('Hello World!') === 'hello-world');
  assert('cap', transforms.capitalize('hello') === 'Hello');
  assert('title', transforms.titleCase('hello world') === 'Hello World');
});

test('builtins: camelCase/snakeCase/kebabCase', () => {
  assert('camel', transforms.camelCase('hello-world') === 'helloWorld');
  assert('snake', transforms.snakeCase('helloWorld') === 'hello_world');
  assert('kebab', transforms.kebabCase('helloWorld') === 'hello-world');
});

test('builtins: round/floor/ceil/abs', () => {
  assert('round', transforms.round(3.14159) === 3.14);
  assert('floor', transforms.floor(3.9) === 3);
  assert('ceil', transforms.ceil(3.1) === 4);
  assert('abs', transforms.abs(-5) === 5);
});

test('builtins: first/last/unique', () => {
  assert('first', transforms.first([1, 2, 3]) === 1);
  assert('last', transforms.last([1, 2, 3]) === 3);
  assert('unique', transforms.unique([1, 2, 2, 3]).length === 3);
});

test('builtins: default/length/isEmpty', () => {
  assert('default null', transforms.default(null, { value: 'x' }) === 'x');
  assert('default present', transforms.default('a', { value: 'x' }) === 'a');
  assert('length', transforms.length([1, 2, 3]) === 3);
  assert('isEmpty', transforms.isEmpty([]) === true);
});

test('builtins: pick/omit', () => {
  const obj = { a: 1, b: 2, c: 3 };
  assert('pick', JSON.stringify(transforms.pick(obj, { fields: ['a', 'c'] })) === '{"a":1,"c":3}');
  assert('omit', JSON.stringify(transforms.omit(obj, { fields: ['b'] })) === '{"a":1,"c":3}');
});

// ─── Convenience function ──────────────────────────────────────────────────

test('transform() convenience', () => {
  const { result } = transform(sampleData, [
    { type: 'filter', condition: { status: 'active' } },
    { type: 'pick', fields: ['name'] },
  ]);
  assert('convenience', result.length === 3);
});

// ─── Standalone CSV ────────────────────────────────────────────────────────

test('parseCSV / stringifyCSV standalone', () => {
  const csv = 'a,b\n1,2\n3,4';
  const parsed = parseCSV(csv);
  assert('parse', parsed.length === 2 && parsed[0].a === '1');
  const str = stringifyCSV([{ x: 1 }, { x: 2 }]);
  assert('stringify', str.startsWith('x\n'));
});

// ─── Stats ─────────────────────────────────────────────────────────────────

test('getStats / resetStats', () => {
  const s = engine.getStats();
  assert('has stats', s.totalRuns > 0 && s.avgMs >= 0);
  engine.resetStats();
  const s2 = engine.getStats();
  assert('reset', s2.totalRuns === 0);
});

// ─── Complex Pipeline ──────────────────────────────────────────────────────

test('complex: multi-step pipeline', () => {
  const data = [
    { id: 1, name: '  alice smith  ', email: 'ALICE@X.COM', scores: [85, 90, 88] },
    { id: 2, name: '  bob jones  ', email: 'BOB@X.COM', scores: [72, 68, 75] },
    { id: 3, name: '  charlie  ', email: 'CHARLIE@X.COM', scores: [95, 98, 92] },
  ];
  const { result } = engine.execute([
    { type: 'map', mapping: {
      user_id: { $source: 'id' },
      full_name: { $source: 'name', $transform: ['trim', 'titleCase'] },
      email: { $source: 'email', $transform: ['lowercase'] },
      avg_score: { $source: 'scores' },
    }},
    { type: 'add', fields: { tier: { $expr: 'User {{user_id}}' } } },
    { type: 'sort', by: [{ field: 'user_id' }] },
  ], data);
  assert('pipeline runs', result.length === 3);
  assert('name trimmed+title', result[0].full_name === 'Alice Smith');
  assert('email lowered', result[0].email === 'alice@x.com');
  assert('tier', result[0].tier === 'User 1');
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
