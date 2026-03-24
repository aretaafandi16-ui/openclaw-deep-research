// agent-forms/test.mjs — 40+ tests for agent-forms
import { FormEngine, Form, FormField, FormResponse, validators } from './index.mjs';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log('agent-forms tests\n');

// ─── FormField ──────────────────────────────────────────────────────────────
test('FormField creation', () => {
  const f = new FormField({ name: 'email', type: 'email', label: 'Email', validation: { required: true } });
  assert(f.name === 'email');
  assert(f.type === 'email');
  assert(f.validation.required === true);
});

test('FormField validation - required', () => {
  const f = new FormField({ name: 'x', validation: { required: true } });
  assert(f.validate(undefined, {}).length > 0);
  assert(f.validate('hello', {}).length === 0);
});

test('FormField validation - min/max', () => {
  const f = new FormField({ name: 'age', type: 'number', validation: { min: 18, max: 100 } });
  assert(f.validate(10, {}).length > 0);
  assert(f.validate(25, {}).length === 0);
  assert(f.validate(200, {}).length > 0);
});

test('FormField validation - email', () => {
  const f = new FormField({ name: 'email', type: 'email' });
  assert(f.validate('bad', {}).length > 0);
  assert(f.validate('a@b.com', {}).length === 0);
});

test('FormField validation - pattern', () => {
  const f = new FormField({ name: 'code', validation: { pattern: '^[A-Z]{3}$' } });
  assert(f.validate('abc', {}).length > 0);
  assert(f.validate('ABC', {}).length === 0);
});

test('FormField validation - enum', () => {
  const f = new FormField({ name: 'color', validation: { enum: ['red', 'blue', 'green'] } });
  assert(f.validate('yellow', {}).length > 0);
  assert(f.validate('blue', {}).length === 0);
});

test('FormField conditional - eq', () => {
  const f = new FormField({ name: 'state', conditional: { field: 'country', op: 'eq', value: 'US' } });
  assert(f.isVisible({ country: 'US' }) === true);
  assert(f.isVisible({ country: 'UK' }) === false);
});

test('FormField conditional - and/or', () => {
  const f = new FormField({ name: 'x', conditional: {
    and: [
      { field: 'a', op: 'eq', value: 1 },
      { or: [{ field: 'b', op: 'gt', value: 5 }, { field: 'c', op: 'exists' }] },
    ]
  }});
  assert(f.isVisible({ a: 1, b: 10 }) === true);
  assert(f.isVisible({ a: 1, b: 2 }) === false);
  assert(f.isVisible({ a: 1, b: 2, c: 'yes' }) === true);
  assert(f.isVisible({ a: 0, b: 10 }) === false);
});

test('FormField conditional - in/nin', () => {
  const f = new FormField({ name: 'x', conditional: { field: 'role', op: 'in', value: ['admin', 'owner'] } });
  assert(f.isVisible({ role: 'admin' }) === true);
  assert(f.isVisible({ role: 'user' }) === false);
});

test('FormField conditional - empty/exists', () => {
  const f = new FormField({ name: 'x', conditional: { field: 'y', op: 'empty' } });
  assert(f.isVisible({ y: undefined }) === true);
  assert(f.isVisible({ y: '' }) === true);
  assert(f.isVisible({ y: 'hi' }) === false);
});

test('FormField transform', () => {
  const f = new FormField({ name: 'x', transform: 'trim' });
  assert(f.transformValue('  hello  ') === 'hello');
  const f2 = new FormField({ name: 'x', transform: 'uppercase' });
  assert(f2.transformValue('hello') === 'HELLO');
  const f3 = new FormField({ name: 'x', transform: 'number' });
  assert(f3.transformValue('42') === 42);
});

test('FormField computed', () => {
  const f = new FormField({ name: 'full', type: 'computed', computed: (ctx) => `${ctx.first} ${ctx.last}` });
  assert(f.computeValue({ first: 'John', last: 'Doe' }) === 'John Doe');
});

// ─── Form ───────────────────────────────────────────────────────────────────
test('Form creation and getVisibleFields', () => {
  const form = new Form({
    name: 'Test',
    fields: [
      { name: 'name', type: 'text', validation: { required: true }, order: 0 },
      { name: 'age', type: 'number', order: 1 },
      { name: 'hidden_field', type: 'text', hidden: true, order: 2 },
    ]
  });
  assert(form.name === 'Test');
  assert(form.getVisibleFields({}).length === 2);
  assert(form.getField('name').name === 'name');
});

test('Form multi-step wizard', () => {
  const form = new Form({
    name: 'Wizard',
    fields: [
      { name: 'a', type: 'text', validation: { required: true } },
      { name: 'b', type: 'text', validation: { required: true } },
      { name: 'c', type: 'text' },
    ],
    steps: [
      { name: 'Step 1', fields: ['a'] },
      { name: 'Step 2', fields: ['b', 'c'] },
    ]
  });
  assert(form.getStepCount() === 2);
  assert(form.getStepFields(0).length === 1);
  assert(form.getStepFields(1).length === 2);
});

// ─── FormEngine CRUD ────────────────────────────────────────────────────────
test('FormEngine create/list/get/delete', () => {
  const engine = new FormEngine();
  const form = engine.createForm({ name: 'Test', fields: [{ name: 'x', type: 'text' }] });
  assert(engine.listForms().length === 1);
  assert(engine.getForm(form.id).name === 'Test');
  engine.deleteForm(form.id);
  assert(engine.listForms().length === 0);
});

test('FormEngine addField/removeField', () => {
  const engine = new FormEngine();
  const form = engine.createForm({ name: 'Test', fields: [{ name: 'a', type: 'text' }] });
  engine.addField(form.id, { name: 'b', type: 'number' });
  assert(engine.getForm(form.id).fields.length === 2);
  engine.removeField(form.id, 'a');
  assert(engine.getForm(form.id).fields.length === 1);
});

test('FormEngine updateForm', () => {
  const engine = new FormEngine();
  const form = engine.createForm({ name: 'Old' });
  engine.updateForm(form.id, { name: 'New', tags: ['test'] });
  assert(engine.getForm(form.id).name === 'New');
  assert(engine.getForm(form.id).tags.includes('test'));
});

// ─── Responses ──────────────────────────────────────────────────────────────
test('Response start/fill/validate/submit', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [
      { name: 'name', type: 'text', validation: { required: true } },
      { name: 'email', type: 'email', validation: { required: true } },
    ]
  });
  const resp = engine.startResponse(form.id);
  assert(resp.status === 'draft');

  engine.fillField(form.id, resp.id, 'name', 'Alice');
  assert(engine.getResponse(form.id, resp.id).data.name === 'Alice');

  const v1 = engine.validateResponse(form.id, resp.id);
  assert(v1.valid === false); // email missing

  engine.fillField(form.id, resp.id, 'email', 'alice@test.com');
  const v2 = engine.validateResponse(form.id, resp.id);
  assert(v2.valid === true);

  const sub = engine.submitResponse(form.id, resp.id);
  assert(sub.success === true);
  assert(sub.response.status === 'submitted');
});

test('Response fill with transform', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'name', type: 'text', transform: 'uppercase' }]
  });
  const resp = engine.startResponse(form.id);
  engine.fillField(form.id, resp.id, 'name', 'alice');
  assert(engine.getResponse(form.id, resp.id).data.name === 'ALICE');
});

test('Response fill with computed fields', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [
      { name: 'first', type: 'text' },
      { name: 'last', type: 'text' },
      { name: 'full', type: 'computed', computed: (ctx) => `${ctx.first} ${ctx.last}` },
    ]
  });
  const resp = engine.startResponse(form.id);
  engine.fillField(form.id, resp.id, 'first', 'John');
  engine.fillField(form.id, resp.id, 'last', 'Doe');
  assert(engine.getResponse(form.id, resp.id).data.full === 'John Doe');
});

test('Response with conditional fields', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [
      { name: 'country', type: 'select', options: ['US', 'UK'], validation: { required: true } },
      { name: 'state', type: 'text', validation: { required: true }, conditional: { field: 'country', op: 'eq', value: 'US' } },
    ]
  });
  const resp = engine.startResponse(form.id);
  engine.fillField(form.id, resp.id, 'country', 'UK');
  // state is not visible, so validation should pass
  const v = engine.validateResponse(form.id, resp.id);
  assert(v.valid === true);
});

test('Response defaults', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'role', type: 'text', defaultValue: 'user' }]
  });
  const resp = engine.startResponse(form.id);
  assert(resp.data.role === 'user');
});

test('fillFields batch', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'a', type: 'text' }, { name: 'b', type: 'number' }]
  });
  const resp = engine.startResponse(form.id);
  engine.fillFields(form.id, resp.id, { a: 'hello', b: 42 });
  const r = engine.getResponse(form.id, resp.id);
  assert(r.data.a === 'hello');
  assert(r.data.b === 42);
});

// ─── Multi-step wizard ──────────────────────────────────────────────────────
test('validateStep', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Wizard',
    fields: [
      { name: 'a', type: 'text', validation: { required: true } },
      { name: 'b', type: 'text', validation: { required: true } },
    ],
    steps: [{ name: 'S1', fields: ['a'] }, { name: 'S2', fields: ['b'] }]
  });
  const resp = engine.startResponse(form.id);
  const v1 = engine.validateStep(form.id, resp.id, 0);
  assert(v1.valid === false);
  engine.fillField(form.id, resp.id, 'a', 'ok');
  const v2 = engine.validateStep(form.id, resp.id, 0);
  assert(v2.valid === true);
});

test('getCurrentStep', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Wizard',
    fields: [
      { name: 'a', type: 'text', validation: { required: true } },
      { name: 'b', type: 'text', validation: { required: true } },
    ],
    steps: [{ name: 'S1', fields: ['a'] }, { name: 'S2', fields: ['b'] }]
  });
  const resp = engine.startResponse(form.id);
  let cur = engine.getCurrentStep(form.id, resp.id);
  assert(cur.step === 0);
  engine.fillField(form.id, resp.id, 'a', 'ok');
  cur = engine.getCurrentStep(form.id, resp.id);
  assert(cur.step === 1);
  engine.fillField(form.id, resp.id, 'b', 'ok');
  cur = engine.getCurrentStep(form.id, resp.id);
  assert(cur.complete === true);
});

// ─── Natural Language Bridge ────────────────────────────────────────────────
test('getNextField returns first unfilled required field', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [
      { name: 'name', type: 'text', label: 'Your Name', validation: { required: true } },
      { name: 'email', type: 'email', label: 'Email', validation: { required: true } },
      { name: 'bio', type: 'textarea', label: 'Bio' },
    ]
  });
  const resp = engine.startResponse(form.id);
  const next = engine.getNextField(form.id, resp.id);
  assert(next.field.name === 'name');
  assert(next.prompt.includes('Your Name'));
  assert(next.total === 3);
});

test('getNextField returns null when all required filled', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'x', type: 'text', validation: { required: true } }]
  });
  const resp = engine.startResponse(form.id);
  engine.fillField(form.id, resp.id, 'x', 'hello');
  assert(engine.getNextField(form.id, resp.id) === null);
});

test('getProgress', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [
      { name: 'a', type: 'text' },
      { name: 'b', type: 'text' },
      { name: 'c', type: 'text' },
    ]
  });
  const resp = engine.startResponse(form.id);
  let p = engine.getProgress(form.id, resp.id);
  assert(p.filled === 0 && p.total === 3 && p.percent === 0);
  engine.fillField(form.id, resp.id, 'a', 'x');
  engine.fillField(form.id, resp.id, 'b', 'y');
  p = engine.getProgress(form.id, resp.id);
  assert(p.filled === 2 && p.percent === 67);
});

// ─── Aggregate ──────────────────────────────────────────────────────────────
test('aggregate numeric', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'score', type: 'number' }]
  });
  for (const val of [10, 20, 30, 40, 50]) {
    const r = engine.startResponse(form.id);
    engine.fillField(form.id, r.id, 'score', val);
    engine.submitResponse(form.id, r.id);
  }
  const agg = engine.aggregate(form.id, 'score');
  assert(agg.type === 'numeric');
  assert(agg.mean === 30);
  assert(agg.min === 10);
  assert(agg.max === 50);
});

test('aggregate categorical', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'color', type: 'select', options: ['red', 'blue'] }]
  });
  for (const val of ['red', 'red', 'blue']) {
    const r = engine.startResponse(form.id);
    engine.fillField(form.id, r.id, 'color', val);
    engine.submitResponse(form.id, r.id);
  }
  const agg = engine.aggregate(form.id, 'color');
  assert(agg.type === 'categorical');
  assert(agg.distribution.red === 2);
  assert(agg.distribution.blue === 1);
});

// ─── Export ──────────────────────────────────────────────────────────────────
test('exportCSV', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'name', type: 'text' }, { name: 'age', type: 'number' }]
  });
  const r = engine.startResponse(form.id);
  engine.fillFields(form.id, r.id, { name: 'Alice', age: 30 });
  engine.submitResponse(form.id, r.id);
  const csv = engine.exportCSV(form.id);
  assert(csv.includes('name,age'));
  assert(csv.includes('Alice,30'));
});

test('exportJSON', () => {
  const engine = new FormEngine();
  const form = engine.createForm({ name: 'Test', fields: [{ name: 'x', type: 'text' }] });
  const r = engine.startResponse(form.id);
  engine.fillField(form.id, r.id, 'x', 'val');
  const json = engine.exportJSON(form.id);
  assert(json.form.name === 'Test');
  assert(json.responses.length === 1);
  assert(json.stats.total === 1);
});

// ─── Stats ──────────────────────────────────────────────────────────────────
test('engine stats', () => {
  const engine = new FormEngine();
  engine.createForm({ name: 'A', fields: [{ name: 'x', type: 'text' }] });
  engine.createForm({ name: 'B', fields: [{ name: 'y', type: 'text' }] });
  const s = engine.stats();
  assert(s.forms === 2);
  assert(s.totalResponses === 0);
});

test('getResponseStats', () => {
  const engine = new FormEngine();
  const form = engine.createForm({ name: 'Test', fields: [{ name: 'x', type: 'text', validation: { required: true } }] });
  const r1 = engine.startResponse(form.id);
  engine.fillField(form.id, r1.id, 'x', 'a');
  engine.submitResponse(form.id, r1.id);
  const r2 = engine.startResponse(form.id);
  const stats = engine.getResponseStats(form.id);
  assert(stats.total === 2);
  assert(stats.byStatus.submitted === 1);
  assert(stats.byStatus.draft === 1);
  assert(stats.completionRate === '50.0%');
});

// ─── Quick Form Builder ─────────────────────────────────────────────────────
test('FormEngine.quickForm', () => {
  const form = FormEngine.quickForm('Contact', [
    'name',
    { name: 'email', type: 'email' },
    { name: 'age', type: 'number', validation: { min: 0 } },
  ]);
  assert(form.name === 'Contact');
  assert(form.fields.length === 3);
  assert(form.fields[1].type === 'email');
});

// ─── Events ─────────────────────────────────────────────────────────────────
test('FormEngine events fire', () => {
  const engine = new FormEngine();
  let createFired = false, fillFired = false;
  engine.on('form:create', () => { createFired = true; });
  engine.on('response:fill', () => { fillFired = true; });
  const form = engine.createForm({ name: 'E', fields: [{ name: 'x', type: 'text' }] });
  const r = engine.startResponse(form.id);
  engine.fillField(form.id, r.id, 'x', 'val');
  assert(createFired && fillFired);
});

// ─── Validators ─────────────────────────────────────────────────────────────
test('validators.email', () => {
  assert(validators.email('bad', null, { name: 'e' }) !== null);
  assert(validators.email('a@b.com', null, { name: 'e' }) === null);
});

test('validators.phone', () => {
  assert(validators.phone('123', null, { name: 'p' }) !== null);
  assert(validators.phone('+1-555-1234', null, { name: 'p' }) === null);
});

test('validators.url', () => {
  assert(validators.url('not url', null, { name: 'u' }) !== null);
  assert(validators.url('https://example.com', null, { name: 'u' }) === null);
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────
test('empty form engine', () => {
  const engine = new FormEngine();
  assert(engine.listForms().length === 0);
  assert(engine.stats().forms === 0);
});

test('submit with errors returns them', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'email', type: 'email', validation: { required: true } }]
  });
  const r = engine.startResponse(form.id);
  engine.fillField(form.id, r.id, 'email', 'invalid');
  const sub = engine.submitResponse(form.id, r.id);
  assert(sub.success === false);
  assert(sub.errors.email.length > 0);
});

test('response with rating field', () => {
  const engine = new FormEngine();
  const form = engine.createForm({
    name: 'Test',
    fields: [{ name: 'rating', type: 'rating', validation: { min: 1, max: 5 } }]
  });
  const r = engine.startResponse(form.id);
  engine.fillField(form.id, r.id, 'rating', 4);
  assert(engine.getResponse(form.id, r.id).data.rating === 4);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
