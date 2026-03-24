#!/usr/bin/env node
/**
 * agent-clock CLI — Temporal reasoning for AI agents
 * 
 * Usage:
 *   node cli.mjs now [--tz UTC]
 *   node cli.mjs parse "in 3 days"
 *   node cli.mjs add "2026-03-24" "2 weeks"
 *   node cli.mjs subtract "2026-04-01" "1 month"
 *   node cli.mjs bizday "2026-03-24"
 *   node cli.mjs bizdays-between "2026-03-24" "2026-04-01"
 *   node cli.mjs add-bizdays "2026-03-24" 5
 *   node cli.mjs schedule "daily at 09:00"
 *   node cli.mjs deadline "Release" "2026-04-01T00:00:00Z" --alert-before "2 days"
 *   node cli.mjs deadlines
 *   node cli.mjs holidays [--add 2026-12-31]
 *   node cli.mjs stats
 *   node cli.mjs serve [--port 3134]
 *   node cli.mjs mcp
 *   node cli.mjs demo
 */

import { AgentClock, parseDuration, formatDuration, parseNaturalTime, parseSchedule, nextOccurrence } from './index.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const clock = new AgentClock({
  calendars: ['us'],
  persistencePath: flag('persist') || '.agent-clock-state.json',
  logPath: flag('log') || '.agent-clock-log.jsonl',
});

switch (cmd) {
  case 'now': {
    const tz = flag('tz') || 'UTC';
    console.log(JSON.stringify({ utc: new Date().toISOString(), local: clock.nowIn(tz), timezone: tz }, null, 2));
    break;
  }
  
  case 'parse': {
    const expr = args[1];
    if (!expr) { console.error('Usage: parse "<expression>"'); process.exit(1); }
    const d = parseNaturalTime(expr);
    console.log(JSON.stringify({ expression: expr, parsed: d.toISOString(), formatted: d.toString() }, null, 2));
    break;
  }
  
  case 'add': {
    const date = args[1];
    const dur = args[2];
    if (!date || !dur) { console.error('Usage: add <date> <duration>'); process.exit(1); }
    const result = clock.add(date, dur);
    console.log(JSON.stringify({ date, duration: dur, result: result.toISOString() }, null, 2));
    break;
  }
  
  case 'subtract': {
    const date = args[1];
    const dur = args[2];
    if (!date || !dur) { console.error('Usage: subtract <date> <duration>'); process.exit(1); }
    const result = clock.subtract(date, dur);
    console.log(JSON.stringify({ date, duration: dur, result: result.toISOString() }, null, 2));
    break;
  }
  
  case 'bizday': {
    const date = args[1] ? new Date(args[1]) : new Date();
    const isBD = clock.isBusinessDay(date);
    const next = clock.nextBusinessDay(date);
    const prev = clock.prevBusinessDay(date);
    console.log(JSON.stringify({
      date: date.toISOString(),
      is_business_day: isBD,
      next_business_day: next.toISOString(),
      prev_business_day: prev.toISOString(),
    }, null, 2));
    break;
  }
  
  case 'bizdays-between': {
    const a = new Date(args[1]);
    const b = new Date(args[2]);
    if (!args[1] || !args[2]) { console.error('Usage: bizdays-between <start> <end>'); process.exit(1); }
    console.log(JSON.stringify({ start: a.toISOString(), end: b.toISOString(), business_days: clock.businessDaysBetween(a, b) }, null, 2));
    break;
  }
  
  case 'add-bizdays': {
    const date = new Date(args[1]);
    const n = parseInt(args[2], 10);
    if (!args[1] || isNaN(n)) { console.error('Usage: add-bizdays <date> <n>'); process.exit(1); }
    const result = clock.addBusinessDays(date, n);
    console.log(JSON.stringify({ date: date.toISOString(), business_days: n, result: result.toISOString() }, null, 2));
    break;
  }
  
  case 'schedule': {
    const expr = args[1];
    if (!expr) { console.error('Usage: schedule "<expression>"'); process.exit(1); }
    const parsed = parseSchedule(expr);
    const next = nextOccurrence(parsed, new Date());
    console.log(JSON.stringify({ expression: expr, schedule: parsed, next_run: next.toISOString() }, null, 2));
    break;
  }
  
  case 'deadline': {
    const name = args[1];
    const due = args[2];
    if (!name || !due) { console.error('Usage: deadline <name> <due_date> [--alert-before <duration>]'); process.exit(1); }
    const id = clock.addDeadline(name, due, { alertBefore: flag('alert-before'), businessDaysOnly: flag('bizdays') === 'true' });
    const info = clock.timeUntilDeadline(id);
    console.log(JSON.stringify(info, null, 2));
    break;
  }
  
  case 'deadlines': {
    console.log(JSON.stringify({ deadlines: clock.listDeadlines() }, null, 2));
    break;
  }
  
  case 'holidays': {
    const addDate = flag('add');
    if (addDate) {
      clock.addHoliday(addDate);
      console.log(`Added holiday: ${addDate}`);
    }
    console.log(JSON.stringify({ holidays: clock.getHolidays() }, null, 2));
    break;
  }
  
  case 'stats': {
    console.log(JSON.stringify(clock.stats(), null, 2));
    break;
  }
  
  case 'serve': {
    const { startServer } = await import('./server.mjs');
    startServer(parseInt(flag('port') || '3134', 10));
    break;
  }
  
  case 'mcp': {
    await import('./mcp-server.mjs');
    break;
  }
  
  case 'demo': {
    console.log('🕐 agent-clock Demo\n');
    
    console.log('📅 Current Time:');
    console.log(`  UTC: ${new Date().toISOString()}`);
    console.log(`  WIB: ${clock.nowIn('Asia/Jakarta')}`);
    console.log(`  EST: ${clock.nowIn('America/New_York')}`);
    
    console.log('\n📝 Natural Language Parsing:');
    for (const expr of ['now', 'tomorrow', 'in 3 days', 'in 2 weeks', 'next monday', 'end of month', '3 hours ago']) {
      console.log(`  "${expr}" → ${parseNaturalTime(expr).toISOString()}`);
    }
    
    console.log('\n💼 Business Days:');
    const today = new Date();
    console.log(`  Today is business day: ${clock.isBusinessDay(today)}`);
    console.log(`  Next business day: ${clock.nextBusinessDay(today).toISOString().split('T')[0]}`);
    console.log(`  +5 business days: ${clock.addBusinessDays(today, 5).toISOString().split('T')[0]}`);
    
    console.log('\n⏱️ Duration Parsing:');
    for (const d of ['3 days', '2h 30m', '1 week', '30m', '1 year']) {
      console.log(`  "${d}" → ${parseDuration(d)}ms (${formatDuration(parseDuration(d))})`);
    }
    
    console.log('\n📆 Schedule Resolution:');
    for (const s of ['every 5m', 'daily at 09:00', 'weekly on monday at 10:00', '0 9 * * 1-5']) {
      const parsed = parseSchedule(s);
      const next = nextOccurrence(parsed, new Date());
      console.log(`  "${s}" → next: ${next.toISOString()}`);
    }
    
    console.log('\n🎯 Deadline Tracking:');
    const dlId = clock.addDeadline('Release v2.0', new Date(Date.now() + 7 * 86400000), { alertBefore: '2 days' });
    console.log(`  Created: ${JSON.stringify(clock.timeUntilDeadline(dlId), null, 4)}`);
    
    console.log('\n📊 Stats:');
    console.log(JSON.stringify(clock.stats(), null, 2));
    
    clock.destroy();
    break;
  }
  
  default:
    console.log(`agent-clock — Temporal reasoning engine for AI agents

Commands:
  now                         Current time (use --tz for timezone)
  parse "<expr>"              Parse natural language time
  add <date> <duration>       Add duration to date
  subtract <date> <duration>  Subtract duration from date
  bizday <date>               Check business day status
  bizdays-between <a> <b>     Business days between dates
  add-bizdays <date> <n>      Add N business days
  schedule "<expr>"           Parse schedule expression
  deadline <name> <due>       Track a deadline
  deadlines                   List all deadlines
  holidays                    List/add holidays
  stats                       Show statistics
  serve                       Start HTTP server (--port 3134)
  mcp                         Start MCP server
  demo                        Run demo

Natural language: "now", "tomorrow", "in 3 days", "next monday", "end of month"
Durations: "3 days", "2h 30m", "1 week", "30m"  
Schedules: "every 5m", "daily at 09:00", "weekly on monday at 10:00", "0 9 * * 1-5"`);
}
