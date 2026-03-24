#!/usr/bin/env node
/**
 * agent-schedule tests
 */

import { AgentSchedule, parseCron, nextCronRun } from './index.mjs';
import { existsSync } from 'node:fs';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// ─── Cron Parser ───

test('parse */5 minute cron', () => {
  const p = parseCron('*/5 * * * *');
  assert(p.minutes.has(0));
  assert(p.minutes.has(5));
  assert(p.minutes.has(55));
  assert(!p.minutes.has(3));
});

test('parse specific hour', () => {
  const p = parseCron('0 9,17 * * *');
  assert(p.minutes.has(0));
  assert(p.hours.has(9));
  assert(p.hours.has(17));
  assert(!p.hours.has(12));
});

test('parse day of week', () => {
  const p = parseCron('* * * * 1-5');
  assert(p.daysOfWeek.has(1)); // Monday
  assert(p.daysOfWeek.has(5)); // Friday
  assert(!p.daysOfWeek.has(0)); // Sunday
  assert(!p.daysOfWeek.has(6)); // Saturday
});

test('parse range with step', () => {
  const p = parseCron('0-30/10 * * * *');
  assert(p.minutes.has(0));
  assert(p.minutes.has(10));
  assert(p.minutes.has(20));
  assert(p.minutes.has(30));
  assert(!p.minutes.has(40));
});

test('parse month field', () => {
  const p = parseCron('* * * 1,6,12 *');
  assert(p.months.has(1));
  assert(p.months.has(6));
  assert(p.months.has(12));
  assert(!p.months.has(3));
});

test('parse every minute is 60 values', () => {
  const p = parseCron('* * * * *');
  assertEq(p.minutes.size, 60);
  assertEq(p.hours.size, 24);
  assertEq(p.daysOfMonth.size, 31);
  assertEq(p.months.size, 12);
  assertEq(p.daysOfWeek.size, 7);
});

test('invalid cron throws', () => {
  let threw = false;
  try { parseCron('* * *'); } catch { threw = true; }
  assert(threw, 'Should throw on 3 fields');
});

// ─── Next Run ───

test('next run for */5 cron is within 5 minutes', () => {
  const p = parseCron('*/5 * * * *');
  const now = new Date('2026-03-24T04:12:00Z');
  const next = nextCronRun(p, now);
  const nextDate = new Date(next);
  assertEq(nextDate.getUTCMinutes(), 15, 'Should be next :15');
  assertEq(nextDate.getUTCHours(), 4);
});

test('next run crosses hour boundary', () => {
  const p = parseCron('*/5 * * * *');
  const now = new Date('2026-03-24T04:58:00Z');
  const next = nextCronRun(p, now);
  const nextDate = new Date(next);
  assertEq(nextDate.getUTCMinutes(), 0);
  assertEq(nextDate.getUTCHours(), 5);
});

test('next run for daily job', () => {
  const p = parseCron('0 9 * * *');
  const now = new Date('2026-03-24T08:00:00Z');
  const next = nextCronRun(p, now);
  const nextDate = new Date(next);
  assertEq(nextDate.getUTCHours(), 9);
  assertEq(nextDate.getUTCMinutes(), 0);
});

test('next run for daily job after time passed', () => {
  const p = parseCron('0 9 * * *');
  const now = new Date('2026-03-24T10:00:00Z');
  const next = nextCronRun(p, now);
  const nextDate = new Date(next);
  assertEq(nextDate.getUTCDate(), 25, 'Should be next day');
  assertEq(nextDate.getUTCHours(), 9);
});

test('next run for weekly job (Monday 9am)', () => {
  const p = parseCron('0 9 * * 1');
  // 2026-03-24 is Tuesday
  const now = new Date('2026-03-24T10:00:00Z');
  const next = nextCronRun(p, now);
  const nextDate = new Date(next);
  assertEq(nextDate.getUTCDay(), 1, 'Should be Monday');
  assertEq(nextDate.getUTCHours(), 9);
});

// ─── Scheduler Core ───

test('schedule and list jobs', () => {
  const sched = new AgentSchedule();
  const job = sched.schedule({ cron: '*/5 * * * *', name: 'test-job' });
  assert(job.id);
  assertEq(job.name, 'test-job');
  assertEq(job.cron, '*/5 * * * *');
  const list = sched.list();
  assertEq(list.length, 1);
  sched.stop();
});

test('enable and disable jobs', () => {
  const sched = new AgentSchedule();
  const job = sched.schedule({ cron: '*/5 * * * *' });
  sched.disable(job.id);
  assert(!sched.get(job.id).enabled);
  sched.enable(job.id);
  assert(sched.get(job.id).enabled);
  sched.stop();
});

test('unschedule removes job', () => {
  const sched = new AgentSchedule();
  const job = sched.schedule({ cron: '*/5 * * * *' });
  assertEq(sched.list().length, 1);
  sched.unschedule(job.id);
  assertEq(sched.list().length, 0);
  sched.stop();
});

test('filter by tag', () => {
  const sched = new AgentSchedule();
  sched.schedule({ cron: '* * * * *', name: 'a', tags: ['x'] });
  sched.schedule({ cron: '* * * * *', name: 'b', tags: ['y'] });
  assertEq(sched.list({ tag: 'x' }).length, 1);
  assertEq(sched.list({ tag: 'y' }).length, 1);
  assertEq(sched.list({ tag: 'z' }).length, 0);
  sched.stop();
});

test('filter by enabled', () => {
  const sched = new AgentSchedule();
  const job1 = sched.schedule({ cron: '* * * * *', name: 'a' });
  sched.schedule({ cron: '* * * * *', name: 'b', enabled: false });
  assertEq(sched.list({ enabled: true }).length, 1);
  assertEq(sched.list({ enabled: false }).length, 1);
  sched.stop();
});

test('trigger executes manually', async () => {
  const sched = new AgentSchedule();
  let called = false;
  sched.onJob('test', async (ctx) => { called = true; return 'ok'; });
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'test' });
  const result = await sched.trigger(job.id);
  assert(called, 'Handler should have been called');
  assert(result.success);
  assertEq(result.result, 'ok');
  sched.stop();
});

test('handler with timeout', async () => {
  const sched = new AgentSchedule();
  sched.onJob('slow', async () => {
    await new Promise(r => setTimeout(r, 5000));
    return 'done';
  });
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'slow', timeout: 100, retry: 0 });
  const result = await sched.trigger(job.id);
  assert(!result.success);
  assert(result.error.includes('Timeout'));
  sched.stop();
});

test('retry on failure', async () => {
  const sched = new AgentSchedule();
  let attempts = 0;
  sched.onJob('flaky', async () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  });
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'flaky', retry: 3 });
  const result = await sched.trigger(job.id);
  assert(result.success);
  assertEq(result.attempts, 3);
  sched.stop();
});

test('event emits on trigger', async () => {
  const sched = new AgentSchedule();
  let startFired = false;
  let successFired = false;
  sched.on('job:start', () => { startFired = true; });
  sched.on('job:success', () => { successFired = true; });
  sched.onJob('evt', async () => 'ok');
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'evt' });
  await sched.trigger(job.id);
  assert(startFired, 'job:start should fire');
  assert(successFired, 'job:success should fire');
  sched.stop();
});

test('stats track correctly', async () => {
  const sched = new AgentSchedule();
  sched.onJob('stat', async () => 'ok');
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'stat' });
  await sched.trigger(job.id);
  await sched.trigger(job.id);
  const j = sched.get(job.id);
  assertEq(j.stats.totalRuns, 2);
  assertEq(j.stats.successes, 2);
  assertEq(j.stats.failures, 0);
  sched.stop();
});

test('history records runs', async () => {
  const sched = new AgentSchedule();
  sched.onJob('hist', async () => 'ok');
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'hist' });
  await sched.trigger(job.id);
  const hist = sched.getHistory({ entryId: job.id });
  assertEq(hist.length, 1);
  assert(hist[0].success);
  sched.stop();
});

test('global stats', async () => {
  const sched = new AgentSchedule();
  sched.onJob('gs', async () => 'ok');
  const j1 = sched.schedule({ cron: '* * * * *', handlerName: 'gs' });
  const j2 = sched.schedule({ cron: '* * * * *', handlerName: 'gs', enabled: false });
  await sched.trigger(j1.id);
  const stats = sched.getStats();
  assertEq(stats.totalJobs, 2);
  assertEq(stats.enabledJobs, 1);
  assertEq(stats.totalRuns, 1);
  assertEq(stats.successes, 1);
  sched.stop();
});

test('overlap prevention', async () => {
  const sched = new AgentSchedule({ tickMs: 50 });
  let running = 0;
  let maxConcurrent = 0;
  sched.onJob('ov', async () => {
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    await new Promise(r => setTimeout(r, 100));
    running--;
  });
  // Schedule with maxOverlap=1
  const job = sched.schedule({ cron: '* * * * *', handlerName: 'ov', maxOverlap: 1 });
  // Trigger twice quickly
  const p1 = sched.trigger(job.id);
  const p2 = sched.trigger(job.id);
  await Promise.all([p1, p2]);
  assertEq(maxConcurrent, 1, 'Should not overlap');
  sched.stop();
});

test('persistence dir is created', () => {
  const dir = '/tmp/agent-schedule-test-' + Date.now();
  const sched = new AgentSchedule({ persistenceDir: dir });
  sched.schedule({ cron: '* * * * *' });
  // dir should exist
  assert(existsSync(dir), 'Persistence dir should be created');
  assert(existsSync(dir + '/schedule.json'), 'schedule.json should exist');
  sched.stop();
});

// ─── Results ───

console.log('\n🧪 agent-schedule tests\n');
results.forEach(r => console.log(r));
console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 Results: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
