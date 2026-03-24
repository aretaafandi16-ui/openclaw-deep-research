#!/usr/bin/env node
/**
 * agent-clock test suite — 42 tests
 */
import { AgentClock, parseDuration, formatDuration, parseNaturalTime, parseSchedule, nextOccurrence, isBusinessDay, addBusinessDays, businessDaysBetween, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, isWeekend, formatDate } from './index.mjs';

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function assertEq(a, b, name) { assert(JSON.stringify(a) === JSON.stringify(b), `${name} (${JSON.stringify(a)} === ${JSON.stringify(b)})`); }

console.log('🕐 agent-clock tests\n');

// ─── Duration Parsing ─────────────────────────────────────────────

console.log('⏱️ Duration Parsing');
assertEq(parseDuration('3 days'), 259200000, '3 days');
assertEq(parseDuration('2h'), 7200000, '2h');
assertEq(parseDuration('30m'), 1800000, '30m');
assertEq(parseDuration('1 week'), 604800000, '1 week');
assertEq(parseDuration('1000ms'), 1000, '1000ms');
assertEq(parseDuration('1 year'), 31536000000, '1 year');
assertEq(parseDuration('2 hours 30 minutes'), 9000000, '2h 30m combined');

// ─── Duration Formatting ──────────────────────────────────────────

console.log('\n📝 Duration Formatting');
assertEq(formatDuration(259200000), '3d', '3d');
assertEq(formatDuration(9000000), '2h 30m', '2h 30m');
assertEq(formatDuration(1500), '1s 500ms', '1s 500ms');
assertEq(formatDuration(0), '0ms', '0ms');

// ─── Date Utilities ───────────────────────────────────────────────

console.log('\n📅 Date Utilities');
const d1 = new Date('2026-03-24T15:30:00Z');
assertEq(startOfDay(d1).toISOString(), '2026-03-24T00:00:00.000Z', 'startOfDay');
assertEq(endOfDay(d1).toISOString(), '2026-03-24T23:59:59.999Z', 'endOfDay');
assertEq(formatDate(d1), '2026-03-24', 'formatDate');
assert(isWeekend(new Date('2026-03-22')), 'Sunday is weekend');
assert(!isWeekend(new Date('2026-03-24')), 'Tuesday is not weekend');

// ─── Business Days ────────────────────────────────────────────────

console.log('\n💼 Business Days');
const holidays = ['2026-12-25', '2026-07-04'];
assert(isBusinessDay(new Date('2026-03-24'), holidays), 'Tue 2026-03-24 is biz day');
assert(!isBusinessDay(new Date('2026-03-22'), []), 'Sunday is not biz day');
assert(!isBusinessDay(new Date('2026-12-25'), holidays), 'Christmas is not biz day');

const fri = new Date('2026-03-20T12:00:00Z'); // Friday
const mon = addBusinessDays(fri, 1, []);
assertEq(mon.toISOString().split('T')[0], '2026-03-23', 'Fri +1 biz day = Mon');

const bizDays = businessDaysBetween(new Date('2026-03-23'), new Date('2026-03-27'), []);
assertEq(bizDays, 4, 'Mon-Fri = 4 biz days');

// ─── Natural Language Parsing ─────────────────────────────────────

console.log('\n🗣️ Natural Language');
const now = new Date('2026-03-24T12:00:00Z');
assertEq(parseNaturalTime('now').getTime(), Date.now(), 'now');
assertEq(parseNaturalTime('today', now).toISOString(), '2026-03-24T00:00:00.000Z', 'today');
assertEq(parseNaturalTime('tomorrow', now).toISOString(), '2026-03-25T00:00:00.000Z', 'tomorrow');
assertEq(parseNaturalTime('yesterday', now).toISOString(), '2026-03-23T00:00:00.000Z', 'yesterday');

const in3d = parseNaturalTime('in 3 days', now);
assertEq(in3d.toISOString().split('T')[0], '2026-03-27', 'in 3 days');

const in2h = parseNaturalTime('in 2 hours', now);
assertEq(in2h.getTime() - now.getTime(), 7200000, 'in 2 hours');

const ago = parseNaturalTime('30 minutes ago', now);
assertEq(now.getTime() - ago.getTime(), 1800000, '30 minutes ago');

// ─── Schedule Parsing ─────────────────────────────────────────────

console.log('\n📆 Schedule Parsing');
const s1 = parseSchedule('every 5m');
assertEq(s1, { type: 'interval', intervalMs: 300000 }, 'every 5m');

const s2 = parseSchedule('daily at 09:00');
assertEq(s2, { type: 'daily', hour: 9, minute: 0 }, 'daily at 09:00');

const s3 = parseSchedule('weekly on monday at 10:00');
assertEq(s3, { type: 'weekly', dayOfWeek: 1, hour: 10, minute: 0 }, 'weekly on monday at 10:00');

const s4 = parseSchedule('0 9 * * 1-5');
assertEq(s4.minute, '0', 'cron minute');
assertEq(s4.hour, '9', 'cron hour');
assertEq(s4.dayOfWeek, '1-5', 'cron dayOfWeek');

// ─── Next Occurrence ──────────────────────────────────────────────

console.log('\n⏭️ Next Occurrence');
const ref = new Date('2026-03-24T12:00:00Z');
const n1 = nextOccurrence(parseSchedule('every 1h'), ref);
assertEq(n1.getTime() - ref.getTime(), 3600000, 'every 1h from ref');

const n2 = nextOccurrence(parseSchedule('daily at 14:00'), ref);
assertEq(n2.toISOString(), '2026-03-24T14:00:00.000Z', 'daily at 14:00 (same day)');

const n3 = nextOccurrence(parseSchedule('daily at 10:00'), ref);
assertEq(n3.toISOString(), '2026-03-25T10:00:00.000Z', 'daily at 10:00 (next day)');

// ─── AgentClock Instance ──────────────────────────────────────────

console.log('\n🕐 AgentClock Instance');
const clock = new AgentClock({ calendars: ['us'] });

assertEq(clock.getHolidays().length > 0, true, 'US holidays loaded');
assert(clock.isBusinessDay(new Date('2026-03-24')), 'clock.isBusinessDay works');

const bd1 = clock.addBusinessDays(new Date('2026-03-20'), 1);
assertEq(bd1.toISOString().split('T')[0], '2026-03-23', 'clock.addBusinessDays');

const dlId = clock.addDeadline('Test', new Date(Date.now() + 86400000));
assert(dlId.startsWith('dl_'), 'deadline id format');
const dls = clock.listDeadlines();
assertEq(dls.length, 1, 'one deadline listed');
assertEq(dls[0].name, 'Test', 'deadline name');

clock.completeDeadline(dlId);
assertEq(clock.listDeadlines()[0].status, 'completed', 'deadline completed');

const stats = clock.stats();
assertEq(stats.deadlines.completed, 1, 'stats deadlines completed');

// ─── Schedule Management ──────────────────────────────────────────

console.log('\n📋 Schedule Management');
let fireCount = 0;
const schedId = clock.schedule('every 100ms', () => { fireCount++; });
assert(schedId.startsWith('sched_'), 'schedule id format');
assertEq(clock.listSchedules().length, 1, 'one schedule listed');

clock.pauseSchedule(schedId);
assertEq(clock.listSchedules()[0].enabled, false, 'schedule paused');

clock.resumeSchedule(schedId);
assertEq(clock.listSchedules()[0].enabled, true, 'schedule resumed');

clock.unschedule(schedId);
assertEq(clock.listSchedules().length, 0, 'schedule removed');

// ─── Cleanup ──────────────────────────────────────────────────────

clock.destroy();

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
