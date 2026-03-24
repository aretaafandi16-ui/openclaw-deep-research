/**
 * agent-guard tests
 */

import { AgentGuard, validateSchema, detectPII, redactPII, detectProfanity, sanitizeText } from './index.mjs';
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { existsSync, rmSync } from 'node:fs';

const TEST_DIR = '/tmp/agent-guard-test-' + Date.now();

function freshGuard() {
  const g = new AgentGuard({ dataDir: TEST_DIR, strict: true });
  return g;
}

describe('Schema Validation', () => {
  test('validates basic types', () => {
    assert.deepEqual(validateSchema('hello', { type: 'string' }), []);
    assert.deepEqual(validateSchema(42, { type: 'number' }), []);
    assert.deepEqual(validateSchema(true, { type: 'boolean' }), []);
    assert(validateSchema('hello', { type: 'number' }).length > 0, 'string should fail number type');
  });

  test('validates string constraints', () => {
    assert.deepEqual(validateSchema('ab', { type: 'string', minLength: 1, maxLength: 10 }), []);
    assert(validateSchema('', { type: 'string', minLength: 1 }).length > 0, 'empty should fail minLength');
    assert(validateSchema('abcdefghijk', { type: 'string', maxLength: 5 }).length > 0, 'long string should fail maxLength');
  });

  test('validates string patterns', () => {
    assert.deepEqual(validateSchema('abc123', { type: 'string', pattern: '^[a-z0-9]+$' }), []);
    assert(validateSchema('ABC!', { type: 'string', pattern: '^[a-z0-9]+$' }).length > 0);
  });

  test('validates string format (email)', () => {
    assert.deepEqual(validateSchema('user@example.com', { type: 'string', format: 'email' }), []);
    assert(validateSchema('not-an-email', { type: 'string', format: 'email' }).length > 0);
  });

  test('validates number constraints', () => {
    assert.deepEqual(validateSchema(50, { type: 'number', minimum: 0, maximum: 100 }), []);
    assert(validateSchema(-1, { type: 'number', minimum: 0 }).length > 0);
    assert(validateSchema(101, { type: 'number', maximum: 100 }).length > 0);
  });

  test('validates enum', () => {
    assert.deepEqual(validateSchema('a', { type: 'string', enum: ['a', 'b', 'c'] }), []);
    assert(validateSchema('d', { type: 'string', enum: ['a', 'b', 'c'] }).length > 0);
  });

  test('validates required fields', () => {
    const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    assert.deepEqual(validateSchema({ name: 'test' }, schema), []);
    assert(validateSchema({}, schema).length > 0, 'missing required should fail');
  });

  test('validates nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string', required: true },
            email: { type: 'string', format: 'email' },
          },
        },
      },
    };
    assert.deepEqual(validateSchema({ user: { name: 'Alice', email: 'a@b.com' } }, schema), []);
    const errs = validateSchema({ user: { name: 'Alice', email: 'bad' } }, schema);
    assert(errs.length > 0);
  });

  test('validates arrays', () => {
    assert.deepEqual(validateSchema([1, 2, 3], { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 5 }), []);
    assert(validateSchema([1, 'a'], { type: 'array', items: { type: 'number' } }).length > 0);
    assert(validateSchema([], { type: 'array', minItems: 1 }).length > 0);
  });

  test('additionalProperties check', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    };
    assert.deepEqual(validateSchema({ name: 'test' }, schema), []);
    assert(validateSchema({ name: 'test', extra: true }, schema).length > 0);
  });

  test('custom validator', () => {
    const schema = {
      type: 'string',
      validate: (v) => v.startsWith('prefix_') || 'must start with prefix_',
    };
    assert.deepEqual(validateSchema('prefix_hello', schema), []);
    assert(validateSchema('nope', schema).length > 0);
  });
});

describe('PII Detection', () => {
  test('detects email', () => {
    const pii = detectPII('Contact me at test@example.com');
    assert(pii.some((p) => p.type === 'email'));
  });

  test('detects phone', () => {
    const pii = detectPII('Call me at 555-123-4567');
    assert(pii.some((p) => p.type === 'phone'));
  });

  test('detects SSN', () => {
    const pii = detectPII('SSN: 123-45-6789');
    assert(pii.some((p) => p.type === 'ssn'));
  });

  test('detects credit card', () => {
    const pii = detectPII('Card: 4111-1111-1111-1111');
    assert(pii.some((p) => p.type === 'creditCard'));
  });

  test('detects JWT', () => {
    const pii = detectPII('Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc');
    assert(pii.some((p) => p.type === 'jwt'));
  });

  test('returns empty for clean text', () => {
    assert.deepEqual(detectPII('Hello world'), []);
  });

  test('redacts PII', () => {
    const redacted = redactPII('Email: test@example.com, SSN: 123-45-6789');
    assert(!redacted.includes('test@example.com'));
    assert(!redacted.includes('123-45-6789'));
    assert(redacted.includes('[REDACTED_EMAIL]'));
    assert(redacted.includes('[REDACTED_SSN]'));
  });

  test('custom redaction replacement', () => {
    const redacted = redactPII('Email: test@example.com', { email: '***' });
    assert(redacted.includes('***'));
  });
});

describe('Profanity Detection', () => {
  test('detects profane words', () => {
    const found = detectProfanity('what the hell is this');
    assert(found.includes('hell'));
  });

  test('returns empty for clean text', () => {
    assert.deepEqual(detectProfanity('Hello beautiful world'), []);
  });
});

describe('Text Sanitization', () => {
  test('strips HTML', () => {
    assert.equal(sanitizeText('<b>bold</b>', { stripHTML: true }), 'bold');
  });

  test('strips markdown', () => {
    assert.equal(sanitizeText('**bold** _italic_', { stripMarkdown: true }), 'bold italic');
  });

  test('truncates to maxLength', () => {
    assert.equal(sanitizeText('hello world', { maxLength: 5 }), 'hello');
  });

  test('lowercases', () => {
    assert.equal(sanitizeText('HELLO', { lowercase: true }), 'hello');
  });

  test('trims', () => {
    assert.equal(sanitizeText('  hello  ', { trim: true }), 'hello');
  });

  test('redacts PII', () => {
    const s = sanitizeText('Email: test@test.com', { redactPII: true });
    assert(!s.includes('test@test.com'));
  });
});

describe('AgentGuard Core', () => {
  test('schema management', () => {
    const g = freshGuard();
    g.addSchema('test', { type: 'string' });
    assert.deepEqual(g.listSchemas(), ['test']);
    assert.deepEqual(g.getSchema('test'), { type: 'string' });
    g.removeSchema('test');
    assert.deepEqual(g.listSchemas(), []);
  });

  test('validate method', () => {
    const g = freshGuard();
    g.addSchema('str', { type: 'string' });
    assert(g.validate('hello', 'str').valid);
    assert(!g.validate(42, 'str').valid);
  });

  test('guard allows valid input', () => {
    const g = freshGuard();
    g.addSchema('user', {
      type: 'object',
      properties: { name: { type: 'string' } },
    });
    const r = g.guardInput({ name: 'Alice' }, { schema: 'user', operation: 'test' });
    assert(r.allowed);
  });

  test('guard blocks invalid input (strict)', () => {
    const g = freshGuard();
    g.addSchema('user', { type: 'object', properties: { name: { type: 'string' } } });
    const r = g.guardInput({ name: 123 }, { schema: 'user', operation: 'test' });
    assert(!r.allowed);
    assert(r.errors.length > 0);
  });

  test('guard warns in non-strict mode', () => {
    const g = new AgentGuard({ dataDir: TEST_DIR, strict: false });
    g.addSchema('user', { type: 'object', properties: { name: { type: 'string' } } });
    const r = g.guardInput({ name: 123 }, { schema: 'user', operation: 'test' });
    assert(r.allowed, 'should be allowed in non-strict');
    assert(r.warnings.length > 0, 'should have warnings');
  });

  test('custom rules', () => {
    const g = freshGuard();
    g.addRule('no-admin', {
      check: (data) => {
        if (data.role === 'admin') return { pass: false, message: 'admin not allowed' };
        return { pass: true };
      },
      severity: 'error',
    });
    assert(!g.guardInput({ role: 'admin' }, { rules: ['no-admin'], operation: 'test' }).allowed);
    assert(g.guardInput({ role: 'user' }, { rules: ['no-admin'], operation: 'test' }).allowed);
  });

  test('profiles', () => {
    const g = freshGuard();
    g.addSchema('str', { type: 'string' });
    g.addProfile('my-profile', {
      description: 'Test profile',
      schema: 'str',
      rules: [],
      contentGuard: { maxBytes: 100 },
    });
    assert(g.getProfile('my-profile'));
    const profiles = g.listProfiles();
    assert(profiles.some((p) => p.name === 'my-profile'));
  });

  test('PII blocking in guard', () => {
    const g = freshGuard();
    const r = g.guardInput('my email is test@test.com', {
      contentGuard: { blockPII: true },
      operation: 'test',
    });
    assert(!r.allowed);
    assert(r.errors.some((e) => e.error.includes('PII')));
  });

  test('PII auto-redact', () => {
    const g = new AgentGuard({ dataDir: TEST_DIR, autoRedact: true });
    const r = g.guardInput('email me at test@test.com', {
      contentGuard: { blockPII: true },
      operation: 'test',
    });
    assert(!r.sanitized.includes('test@test.com'));
  });

  test('rate limiting', () => {
    const g = freshGuard();
    g.rateLimiter.configure('test:api', 2, 60000);
    const r1 = g.guardInput('a', { operation: 'api', rateLimit: { limit: 2, windowMs: 60000 } });
    assert(r1.allowed);
    const r2 = g.guardInput('b', { operation: 'api', rateLimit: { limit: 2, windowMs: 60000 } });
    assert(r2.allowed);
    const r3 = g.guardInput('c', { operation: 'api', rateLimit: { limit: 2, windowMs: 60000 } });
    assert(!r3.allowed);
  });

  test('audit logging', () => {
    const g = freshGuard();
    g.guardInput('test', { operation: 'audit-test' });
    const entries = g.audit.read({ operation: 'audit-test' });
    assert(entries.length > 0);
    assert.equal(entries[0].operation, 'audit-test');
  });

  test('events emitted', () => {
    const g = freshGuard();
    let passEvent = null;
    let blockEvent = null;
    g.on('pass', (e) => { passEvent = e; });
    g.on('block', (e) => { blockEvent = e; });

    g.guardInput('hello', { operation: 'evt' });
    assert(passEvent);

    g.addSchema('num', { type: 'number' });
    g.guardInput('not-num', { schema: 'num', operation: 'evt2' });
    assert(blockEvent);
  });

  test('presets', () => {
    const g = freshGuard();
    g.loadAllPresets();
    const rules = g.listRules();
    assert(rules.length >= 6);
    assert(rules.some((r) => r.name === 'no-pii'));
    assert(rules.some((r) => r.name === 'no-sql-injection'));
  });

  test('contentGuard maxBytes', () => {
    const g = freshGuard();
    const r = g.guardInput('x'.repeat(200), { contentGuard: { maxBytes: 100 }, operation: 'test' });
    assert(!r.allowed);
  });

  test('nested content check on objects', () => {
    const g = freshGuard();
    const r = g.guardInput({ message: 'email me at test@test.com' }, {
      contentGuard: { blockPII: true, textFields: ['message'] },
      operation: 'test',
    });
    assert(!r.allowed);
  });
});

describe('Cleanup', () => {
  test('remove test dir', () => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });
});

console.log('\n🐋 agent-guard tests complete');
