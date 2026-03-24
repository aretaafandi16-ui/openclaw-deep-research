# agent-clock 🕐

Zero-dependency temporal reasoning engine for AI agents.

Business days, natural language parsing, deadline tracking, recurring schedules, timezone-aware operations.

## Install

```bash
# Clone and use
import { AgentClock, parseDuration, parseNaturalTime } from './index.mjs';
```

**Zero dependencies.** Pure JavaScript. Works everywhere Node.js runs.

## Features

| Feature | Description |
|---------|-------------|
| 🗣️ Natural Language | `"tomorrow"`, `"in 3 days"`, `"next monday"`, `"end of month"` |
| 💼 Business Days | Add/subtract business days, holiday calendars, weekday checks |
| ⏱️ Durations | Parse `"3 days"`, `"2h 30m"` — format back to human-readable |
| 📆 Schedules | `"every 5m"`, `"daily at 09:00"`, `"weekly on monday"`, full cron |
| 🎯 Deadlines | Track deadlines, alerts, business-day awareness |
| 🌍 Timezones | Convert and format times in any IANA timezone |
| 🔄 Persistence | JSONL state — survives restarts |

## Quick Start

```javascript
import { AgentClock, parseNaturalTime, parseDuration } from './index.mjs';

const clock = new AgentClock({ calendars: ['us'] });

// Natural language
parseNaturalTime('tomorrow');        // Date for tomorrow
parseNaturalTime('in 3 days');       // Date 3 days from now
parseNaturalTime('next monday');     // Date for next Monday

// Durations
parseDuration('2h 30m');  // 9000000 (ms)
formatDuration(9000000);  // "2h 30m"

// Business days
clock.isBusinessDay(new Date());              // true/false
clock.addBusinessDays(new Date(), 5);         // +5 business days
clock.businessDaysBetween(start, end);        // count biz days

// Schedules
const id = clock.schedule('daily at 09:00', (entry) => {
  console.log('Fired!', entry.runCount);
});

// Deadlines
const dlId = clock.addDeadline('Release v2', '2026-04-01', {
  alertBefore: '2 days',
  businessDaysOnly: true,
});
clock.timeUntilDeadline(dlId);
// { ms: 691200000, formatted: '8d', overdue: false, businessDays: 5 }
```

## Natural Language Expressions

| Expression | Result |
|-----------|--------|
| `now` | Current time |
| `today` | Start of today |
| `tomorrow` | Start of tomorrow |
| `yesterday` | Start of yesterday |
| `end of day` / `eod` | End of today |
| `end of week` / `eow` | End of this week |
| `end of month` / `eom` | End of this month |
| `start of week` / `sow` | Start of this week |
| `start of month` / `som` | Start of this month |
| `in 3 days` | 3 days from reference |
| `in 2h 30m` | 2h30m from reference |
| `30 minutes ago` | 30m before reference |
| `next monday` | Next Monday |
| `last friday` | Last Friday |
| `next business day` | Next non-holiday weekday |
| `last business day` | Previous non-holiday weekday |

## Duration Strings

```
"3 days" / "1 week" / "2 hours" / "30m" / "1000ms"
"2h 30m" — multiple parts, space/comma separated
```

Units: `ms`, `s/sec`, `m/min`, `h/hr`, `d/day`, `w/wk`, `mo/month`, `y/yr`

## Schedule Expressions

```javascript
// Interval-based
parseSchedule('every 5m');
parseSchedule('every 2h 30m');

// Daily
parseSchedule('daily at 09:00');

// Weekly
parseSchedule('weekly on monday at 10:00');

// Standard cron (5-field)
parseSchedule('0 9 * * 1-5');     // 9 AM weekdays
parseSchedule('*/15 * * * *');     // Every 15 minutes
parseSchedule('0 0 1 * *');       // First of month
```

## Calendar Management

```javascript
const clock = new AgentClock({
  calendars: ['us'],          // Built-in US holidays (2025-2026)
  holidays: ['2026-12-31'],   // Custom holidays
});

clock.addCalendar('custom', [
  { date: '2026-03-15', name: 'Company Day' }
]);

clock.addHoliday('2026-06-01', 'Team Offsite');
clock.getHolidays(); // ['2025-01-01', ..., '2026-06-01']
```

Built-in calendars: `us-2025`, `us-2026`, `us` (combined)

## Deadline Tracking

```javascript
// Add deadline
const id = clock.addDeadline('Ship v2.0', '2026-04-01T00:00:00Z', {
  alertBefore: '2 days',        // Alert 2 days before
  businessDaysOnly: true,       // Count business days
  callback: (entry) => console.log('OVERDUE!'),
});

// Check status
clock.timeUntilDeadline(id);
// { id, name, due, ms: 691200000, formatted: '8d', overdue: false, businessDays: 5 }

// List all
clock.listDeadlines();

// Complete
clock.completeDeadline(id);

// Events
clock.on('deadline:alert', (info) => { /* alert fired */ });
clock.on('deadline:overdue', (info) => { /* deadline passed */ });
```

## MCP Server

12 tools for AI agent integration:

```
clock_now          — Current time in any timezone
clock_parse        — Parse natural language time
clock_add          — Add duration to date
clock_subtract     — Subtract duration from date
clock_business_day — Check/add business days
clock_business_days_between — Count business days
clock_schedule     — Parse schedule expression
clock_next_occurrence — Next occurrence of schedule
clock_deadline     — Track a deadline
clock_time_until   — Time until deadline
clock_deadlines    — List all deadlines
clock_stats        — Statistics
```

```bash
node mcp-server.mjs   # JSON-RPC stdio
```

## HTTP Server

Dark-theme dashboard + REST API:

```bash
node cli.mjs serve --port 3134
# → http://localhost:3134
```

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/now` | Current time |
| GET | `/api/parse?expr=` | Parse natural language |
| GET | `/api/parse-duration?expr=` | Parse duration |
| GET | `/api/add?date=&duration=` | Add duration |
| GET | `/api/business-day?date=` | Business day check |
| GET | `/api/business-days-between?start=&end=` | Count biz days |
| GET | `/api/deadlines` | List deadlines |
| POST | `/api/deadlines` | Add deadline |
| POST | `/api/deadlines/:id/complete` | Complete deadline |
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Parse schedule |
| GET | `/api/stats` | Statistics |

## CLI

```bash
node cli.mjs now                          # Current time
node cli.mjs parse "in 3 days"            # Parse expression
node cli.mjs add "2026-03-24" "2 weeks"   # Add duration
node cli.mjs bizday "2026-03-24"          # Check business day
node cli.mjs add-bizdays "2026-03-20" 5   # Add biz days
node cli.mjs bizdays-between "2026-03-23" "2026-03-27"
node cli.mjs schedule "daily at 09:00"    # Parse schedule
node cli.mjs deadline "Release" "2026-04-01" --alert-before "2 days"
node cli.mjs deadlines                    # List deadlines
node cli.mjs holidays --add "2026-12-31"  # Add holiday
node cli.mjs stats                        # Show stats
node cli.mjs serve --port 3134            # HTTP server
node cli.mjs mcp                          # MCP server
node cli.mjs demo                         # Run demo
```

## Events

```javascript
const clock = new AgentClock();

clock.on('deadline:added', ({ id, name, due }) => {});
clock.on('deadline:alert', ({ id, name, remaining }) => {});
clock.on('deadline:overdue', ({ id, name, due }) => {});
clock.on('deadline:completed', ({ id, name }) => {});
clock.on('schedule:created', ({ id, expr, nextRun }) => {});
clock.on('schedule:fired', ({ id, expr, runCount }) => {});
clock.on('calendar:added', ({ name, count }) => {});
clock.on('holiday:added', ({ date, name }) => {});
```

## Tests

```bash
node test.mjs
# 42 tests, all passing ✅
```

## License

MIT
