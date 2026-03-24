/**
 * agent-clock — Zero-dependency temporal reasoning engine for AI agents
 * 
 * Features:
 * - Business day calculations (add/subtract business days)
 * - Holiday calendar management (built-in + custom)
 * - Recurring schedule engine (cron-like with natural language)
 * - Deadline tracking with alerts
 * - Timezone-aware operations
 * - Duration parsing & formatting
 * - Temporal arithmetic (add/subtract any duration)
 * - Natural language time expressions
 * - Event scheduling with callbacks
 * - JSONL persistence
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ─── Built-in Holiday Calendars ───────────────────────────────────

const US_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: "Presidents' Day" },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-10-12', name: 'Columbus Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
  { date: '2026-11-26', name: 'Thanksgiving' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

const US_HOLIDAYS_2025 = [
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-01-20', name: 'Martin Luther King Jr. Day' },
  { date: '2025-02-17', name: "Presidents' Day" },
  { date: '2025-05-26', name: 'Memorial Day' },
  { date: '2025-06-19', name: 'Juneteenth' },
  { date: '2025-07-04', name: 'Independence Day' },
  { date: '2025-09-01', name: 'Labor Day' },
  { date: '2025-10-13', name: 'Columbus Day' },
  { date: '2025-11-11', name: 'Veterans Day' },
  { date: '2025-11-27', name: 'Thanksgiving' },
  { date: '2025-12-25', name: 'Christmas Day' },
];

const BUILTIN_CALENDARS = {
  'us-2025': US_HOLIDAYS_2025,
  'us-2026': US_HOLIDAYS_2026,
  'us': [...US_HOLIDAYS_2025, ...US_HOLIDAYS_2026],
};

// ─── Duration Parsing ─────────────────────────────────────────────

const DURATION_RE = /^(\d+)\s*(ms|millisecond|milliseconds|s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|wk|week|weeks|mo|month|months|y|yr|year|years)$/i;

const DURATION_MULTIPLIERS = {
  ms: 1, millisecond: 1, milliseconds: 1,
  s: 1000, sec: 1000, second: 1000, seconds: 1000,
  m: 60000, min: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hr: 3600000, hour: 3600000, hours: 3600000,
  d: 86400000, day: 86400000, days: 86400000,
  w: 604800000, wk: 604800000, week: 604800000, weeks: 604800000,
  mo: 2592000000, month: 2592000000, months: 2592000000,
  y: 31536000000, yr: 31536000000, year: 31536000000, years: 31536000000,
};

/**
 * Parse a duration string like "3 days", "2h", "30m", "1w"
 * Returns milliseconds
 */
export function parseDuration(str) {
  if (typeof str === 'number') return str;
  if (!str || typeof str !== 'string') throw new Error('Invalid duration');
  
  // Normalize: "2 hours 30 minutes" → "2h 30m" style, or split on delimiters
  const normalized = str.toLowerCase().trim()
    .replace(/(\d+)\s*(milliseconds?|millisecond)\b/g, '$1ms')
    .replace(/(\d+)\s*(seconds?|secs?)\b/g, '$1s')
    .replace(/(\d+)\s*(minutes?|mins?)\b/g, '$1m')
    .replace(/(\d+)\s*(hours?|hrs?)\b/g, '$1h')
    .replace(/(\d+)\s*(days?)\b/g, '$1d')
    .replace(/(\d+)\s*(weeks?|wks?)\b/g, '$1w')
    .replace(/(\d+)\s*(months?)\b/g, '$1mo')
    .replace(/(\d+)\s*(years?|yrs?)\b/g, '$1y');
  
  const parts = normalized.split(/\s*,\s*|\s+and\s+|\s*\+\s+|\s+/);
  let total = 0;
  
  for (const part of parts) {
    const m = part.match(DURATION_RE);
    if (!m) throw new Error(`Cannot parse duration: "${part}" (from "${str}")`);
    const qty = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    total += qty * DURATION_MULTIPLIERS[unit];
  }
  
  return total;
}

/**
 * Format milliseconds to human-readable string
 */
export function formatDuration(ms) {
  if (ms < 0) return '-' + formatDuration(-ms);
  
  const units = [
    { label: 'd', ms: 86400000 },
    { label: 'h', ms: 3600000 },
    { label: 'm', ms: 60000 },
    { label: 's', ms: 1000 },
    { label: 'ms', ms: 1 },
  ];
  
  const parts = [];
  let remaining = ms;
  
  for (const u of units) {
    if (remaining >= u.ms) {
      const qty = Math.floor(remaining / u.ms);
      remaining -= qty * u.ms;
      parts.push(`${qty}${u.label}`);
    }
  }
  
  return parts.length > 0 ? parts.join(' ') : '0ms';
}

/**
 * Parse a natural language time expression
 */
export function parseNaturalTime(expr, refDate = new Date()) {
  const ref = refDate instanceof Date ? refDate : new Date(refDate);
  const lower = expr.toLowerCase().trim();
  
  // Relative expressions
  if (lower === 'now') return new Date();
  if (lower === 'today') return startOfDay(ref);
  if (lower === 'tomorrow') return addDays(startOfDay(ref), 1);
  if (lower === 'yesterday') return addDays(startOfDay(ref), -1);
  if (lower === 'end of day' || lower === 'eod') return endOfDay(ref);
  if (lower === 'end of week' || lower === 'eow') return endOfWeek(ref);
  if (lower === 'end of month' || lower === 'eom') return endOfMonth(ref);
  if (lower === 'start of week' || lower === 'sow') return startOfWeek(ref);
  if (lower === 'start of month' || lower === 'som') return startOfMonth(ref);
  if (lower === 'start of year' || lower === 'soy') return startOfYear(ref);
  if (lower === 'end of year' || lower === 'eoy') return endOfYear(ref);
  
  // "in X" patterns
  const inMatch = lower.match(/^in\s+(.+)$/);
  if (inMatch) {
    const dur = parseDuration(inMatch[1]);
    return new Date(ref.getTime() + dur);
  }
  
  // "X ago" patterns
  const agoMatch = lower.match(/^(.+)\s+ago$/);
  if (agoMatch) {
    const dur = parseDuration(agoMatch[1]);
    return new Date(ref.getTime() - dur);
  }
  
  // "last/next weekday"
  const weekdayMatch = lower.match(/^(last|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (weekdayMatch) {
    const dir = weekdayMatch[1] === 'next' ? 1 : -1;
    const targetDay = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(weekdayMatch[2]);
    return findWeekday(ref, targetDay, dir);
  }
  
  // "last/next business day"
  if (lower === 'next business day') return nextBusinessDay(ref);
  if (lower === 'last business day') return prevBusinessDay(ref);
  
  // Try as ISO date
  const parsed = new Date(expr);
  if (!isNaN(parsed.getTime())) return parsed;
  
  throw new Error(`Cannot parse time expression: "${expr}"`);
}

// ─── Date Utilities ───────────────────────────────────────────────

export function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function startOfWeek(d) {
  const r = startOfDay(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

export function endOfWeek(d) {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  return endOfDay(r);
}

export function startOfMonth(d) {
  const r = new Date(d);
  r.setDate(1);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfMonth(d) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + 1, 0);
  return endOfDay(r);
}

export function startOfYear(d) {
  const r = new Date(d);
  r.setMonth(0, 1);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfYear(d) {
  const r = new Date(d);
  r.setMonth(11, 31);
  return endOfDay(r);
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function findWeekday(d, targetDay, direction = 1) {
  const r = startOfDay(d);
  while (r.getDay() !== targetDay) {
    r.setDate(r.getDate() + direction);
  }
  return r;
}

export function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ─── Business Day Logic ───────────────────────────────────────────

export function isBusinessDay(d, holidays = []) {
  if (isWeekend(d)) return false;
  const dateStr = formatDate(d);
  return !holidays.includes(dateStr);
}

export function nextBusinessDay(d, holidays = []) {
  const r = new Date(d);
  r.setDate(r.getDate() + 1);
  while (!isBusinessDay(r, holidays)) {
    r.setDate(r.getDate() + 1);
  }
  return r;
}

export function prevBusinessDay(d, holidays = []) {
  const r = new Date(d);
  r.setDate(r.getDate() - 1);
  while (!isBusinessDay(r, holidays)) {
    r.setDate(r.getDate() - 1);
  }
  return r;
}

export function addBusinessDays(d, n, holidays = []) {
  let r = new Date(d);
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  
  while (remaining > 0) {
    r.setDate(r.getDate() + step);
    if (isBusinessDay(r, holidays)) remaining--;
  }
  return r;
}

export function businessDaysBetween(a, b, holidays = []) {
  const start = new Date(Math.min(a.getTime(), b.getTime()));
  const end = new Date(Math.max(a.getTime(), b.getTime()));
  let count = 0;
  const current = new Date(start);
  
  while (current < end) {
    if (isBusinessDay(current, holidays)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatISO(d) {
  return d.toISOString();
}

// ─── Recurring Schedule ───────────────────────────────────────────

/**
 * Simple cron-like schedule parser
 * Supports: "every 5m", "every 2h", "daily at 09:00", "weekly on monday at 10:00"
 *          "0 9 * * 1-5" (standard cron)
 */
export function parseSchedule(expr) {
  const lower = expr.toLowerCase().trim();
  
  // "every X" patterns
  const everyMatch = lower.match(/^every\s+(.+)$/);
  if (everyMatch) {
    const dur = parseDuration(everyMatch[1]);
    return { type: 'interval', intervalMs: dur };
  }
  
  // "daily at HH:MM"
  const dailyMatch = lower.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    return {
      type: 'daily',
      hour: parseInt(dailyMatch[1], 10),
      minute: parseInt(dailyMatch[2], 10),
    };
  }
  
  // "weekly on DAY at HH:MM"
  const weeklyMatch = lower.match(/^weekly\s+on\s+(\w+)\s+at\s+(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dayIndex = dayNames.indexOf(weeklyMatch[1].toLowerCase());
    if (dayIndex === -1) throw new Error(`Unknown day: ${weeklyMatch[1]}`);
    return {
      type: 'weekly',
      dayOfWeek: dayIndex,
      hour: parseInt(weeklyMatch[2], 10),
      minute: parseInt(weeklyMatch[3], 10),
    };
  }
  
  // Standard 5-field cron
  const cronParts = expr.trim().split(/\s+/);
  if (cronParts.length === 5) {
    return {
      type: 'cron',
      minute: cronParts[0],
      hour: cronParts[1],
      dayOfMonth: cronParts[2],
      month: cronParts[3],
      dayOfWeek: cronParts[4],
    };
  }
  
  throw new Error(`Cannot parse schedule: "${expr}"`);
}

export function nextOccurrence(schedule, fromDate = new Date()) {
  const ref = new Date(fromDate);
  
  switch (schedule.type) {
    case 'interval':
      return new Date(ref.getTime() + schedule.intervalMs);
      
    case 'daily': {
      const next = new Date(ref);
      next.setHours(schedule.hour, schedule.minute, 0, 0);
      if (next <= ref) next.setDate(next.getDate() + 1);
      return next;
    }
    
    case 'weekly': {
      const next = new Date(ref);
      next.setHours(schedule.hour, schedule.minute, 0, 0);
      const daysUntil = (schedule.dayOfWeek - next.getDay() + 7) % 7;
      if (daysUntil === 0 && next <= ref) {
        next.setDate(next.getDate() + 7);
      } else {
        next.setDate(next.getDate() + daysUntil);
      }
      return next;
    }
    
    case 'cron':
      return nextCronOccurrence(schedule, ref);
    
    default:
      throw new Error(`Unknown schedule type: ${schedule.type}`);
  }
}

function matchesCronField(value, field) {
  if (field === '*') return true;
  
  const str = String(value);
  
  // Handle lists
  for (const part of field.split(',')) {
    // Handle ranges with steps: 1-5/2
    const rangeStepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (rangeStepMatch) {
      const [, start, end, step] = rangeStepMatch.map(Number);
      if (value >= start && value <= end && (value - start) % step === 0) return true;
      continue;
    }
    
    // Handle ranges: 1-5
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const [, start, end] = rangeMatch.map(Number);
      if (value >= start && value <= end) return true;
      continue;
    }
    
    // Handle steps: */2 or 5/3
    const stepMatch = part.match(/^(\*|\d+)\/(\d+)$/);
    if (stepMatch) {
      const base = stepMatch[1] === '*' ? 0 : parseInt(stepMatch[1], 10);
      const step = parseInt(stepMatch[2], 10);
      if (stepMatch[1] === '*') {
        if (value % step === 0) return true;
      } else {
        if (value >= base && (value - base) % step === 0) return true;
      }
      continue;
    }
    
    // Exact match
    if (part === str || part === '*') return true;
    if (parseInt(part, 10) === value) return true;
  }
  
  return false;
}

function nextCronOccurrence(schedule, fromDate) {
  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  
  // Search up to 2 years ahead
  const limit = new Date(fromDate.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
  
  while (next <= limit) {
    if (
      matchesCronField(next.getMonth() + 1, schedule.month) &&
      matchesCronField(next.getDate(), schedule.dayOfMonth) &&
      matchesCronField(next.getDay(), schedule.dayOfWeek) &&
      matchesCronField(next.getHours(), schedule.hour) &&
      matchesCronField(next.getMinutes(), schedule.minute)
    ) {
      return new Date(next);
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  
  throw new Error('Could not find next cron occurrence within 2 years');
}

// ─── Timezone Utilities ───────────────────────────────────────────

export function toTimezone(d, tz) {
  const str = d.toLocaleString('en-US', { timeZone: tz });
  return new Date(str);
}

export function fromTimezone(d, tz) {
  const utcStr = d.toISOString();
  const localStr = d.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  return new Date(utcStr);
}

export function getTimezoneOffset(d, tz) {
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  return (local - utc) / 60000;
}

export function formatInTimezone(d, tz, opts = {}) {
  return d.toLocaleString(opts.locale || 'en-US', {
    timeZone: tz,
    ...opts,
  });
}

// ─── Time Comparison ──────────────────────────────────────────────

export function isBefore(a, b) { return a.getTime() < b.getTime(); }
export function isAfter(a, b) { return a.getTime() > b.getTime(); }
export function isSame(a, b) { return a.getTime() === b.getTime(); }
export function isSameDay(a, b) { return formatDate(a) === formatDate(b); }
export function isBetween(d, start, end) {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function diff(a, b) {
  return a.getTime() - b.getTime();
}

export function diffDays(a, b) {
  return Math.round(diff(a, b) / 86400000);
}

// ─── AgentClock Core ──────────────────────────────────────────────

export class AgentClock extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.timezone = opts.timezone || 'UTC';
    this.calendars = new Map();
    this.holidays = [];
    this.deadlines = new Map();
    this.schedules = new Map();
    this._scheduleTimers = new Map();
    this._deadlineTimers = new Map();
    this._deadlineIdCounter = 0;
    this._scheduleIdCounter = 0;
    this._persistencePath = opts.persistencePath || null;
    this._logPath = opts.logPath || null;
    
    // Load built-in calendars
    if (opts.calendars) {
      for (const name of opts.calendars) {
        if (BUILTIN_CALENDARS[name]) {
          this.addCalendar(name, BUILTIN_CALENDARS[name]);
        }
      }
    }
    
    // Add custom holidays
    if (opts.holidays) {
      for (const h of opts.holidays) {
        this.addHoliday(typeof h === 'string' ? h : h.date, h.name);
      }
    }
    
    // Load persisted state
    if (this._persistencePath && existsSync(this._persistencePath)) {
      this._loadState();
    }
  }
  
  // ── Calendar Management ──────────────────────────────────────
  
  addCalendar(name, holidays) {
    this.calendars.set(name, holidays);
    for (const h of holidays) {
      if (!this.holidays.includes(h.date)) {
        this.holidays.push(h.date);
      }
    }
    this.emit('calendar:added', { name, count: holidays.length });
    return this;
  }
  
  addHoliday(date, name) {
    const dateStr = typeof date === 'string' ? date : formatDate(date);
    if (!this.holidays.includes(dateStr)) {
      this.holidays.push(dateStr);
    }
    this.emit('holiday:added', { date: dateStr, name });
    return this;
  }
  
  removeHoliday(date) {
    const dateStr = typeof date === 'string' ? date : formatDate(date);
    this.holidays = this.holidays.filter(h => h !== dateStr);
    this.emit('holiday:removed', { date: dateStr });
    return this;
  }
  
  getHolidays() { return [...this.holidays]; }
  
  // ── Business Day Operations ──────────────────────────────────
  
  isBusinessDay(date) {
    const d = date instanceof Date ? date : new Date(date);
    return isBusinessDay(d, this.holidays);
  }
  
  nextBusinessDay(date) {
    const d = date instanceof Date ? date : new Date(date);
    return nextBusinessDay(d, this.holidays);
  }
  
  prevBusinessDay(date) {
    const d = date instanceof Date ? date : new Date(date);
    return prevBusinessDay(d, this.holidays);
  }
  
  addBusinessDays(date, n) {
    const d = date instanceof Date ? date : new Date(date);
    return addBusinessDays(d, n, this.holidays);
  }
  
  businessDaysBetween(a, b) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    return businessDaysBetween(da, db, this.holidays);
  }
  
  // ── Duration Operations ──────────────────────────────────────
  
  parseDuration(str) { return parseDuration(str); }
  formatDuration(ms) { return formatDuration(ms); }
  
  add(date, duration) {
    const d = date instanceof Date ? date : new Date(date);
    const ms = parseDuration(duration);
    return new Date(d.getTime() + ms);
  }
  
  subtract(date, duration) {
    const d = date instanceof Date ? date : new Date(date);
    const ms = parseDuration(duration);
    return new Date(d.getTime() - ms);
  }
  
  // ── Natural Language ─────────────────────────────────────────
  
  parse(expr, refDate) {
    return parseNaturalTime(expr, refDate || new Date());
  }
  
  // ── Schedule Management ──────────────────────────────────────
  
  schedule(expr, callback, opts = {}) {
    const id = `sched_${++this._scheduleIdCounter}`;
    const parsed = typeof expr === 'string' ? parseSchedule(expr) : expr;
    
    const entry = {
      id,
      schedule: parsed,
      expr: typeof expr === 'string' ? expr : JSON.stringify(expr),
      callback,
      enabled: true,
      runCount: 0,
      lastRun: null,
      nextRun: nextOccurrence(parsed, new Date()),
      createdAt: new Date(),
      opts,
    };
    
    this.schedules.set(id, entry);
    this._startScheduleTimer(entry);
    this._persistState();
    
    this.emit('schedule:created', { id, expr: entry.expr, nextRun: entry.nextRun });
    return id;
  }
  
  unschedule(id) {
    const entry = this.schedules.get(id);
    if (!entry) return false;
    
    this._clearScheduleTimer(id);
    this.schedules.delete(id);
    this._persistState();
    this.emit('schedule:removed', { id });
    return true;
  }
  
  pauseSchedule(id) {
    const entry = this.schedules.get(id);
    if (!entry) return false;
    entry.enabled = false;
    this._clearScheduleTimer(id);
    this.emit('schedule:paused', { id });
    return true;
  }
  
  resumeSchedule(id) {
    const entry = this.schedules.get(id);
    if (!entry) return false;
    entry.enabled = true;
    entry.nextRun = nextOccurrence(entry.schedule, new Date());
    this._startScheduleTimer(entry);
    this.emit('schedule:resumed', { id, nextRun: entry.nextRun });
    return true;
  }
  
  listSchedules() {
    return [...this.schedules.values()].map(s => ({
      id: s.id,
      expr: s.expr,
      enabled: s.enabled,
      runCount: s.runCount,
      lastRun: s.lastRun,
      nextRun: s.nextRun,
    }));
  }
  
  // ── Deadline Tracking ────────────────────────────────────────
  
  addDeadline(name, dueDate, opts = {}) {
    const id = `dl_${++this._deadlineIdCounter}`;
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    
    const entry = {
      id,
      name,
      due,
      businessDaysOnly: opts.businessDaysOnly || false,
      alertBefore: opts.alertBefore ? parseDuration(opts.alertBefore) : null,
      callback: opts.callback || null,
      status: 'pending',
      createdAt: new Date(),
      alerts: [],
    };
    
    this.deadlines.set(id, entry);
    this._setupDeadlineTimers(entry);
    this._persistState();
    
    this.emit('deadline:added', { id, name, due });
    return id;
  }
  
  removeDeadline(id) {
    this._clearDeadlineTimers(id);
    this.deadlines.delete(id);
    this._persistState();
    this.emit('deadline:removed', { id });
    return true;
  }
  
  completeDeadline(id) {
    const entry = this.deadlines.get(id);
    if (!entry) return false;
    entry.status = 'completed';
    this._clearDeadlineTimers(id);
    this._persistState();
    this.emit('deadline:completed', { id, name: entry.name });
    return true;
  }
  
  timeUntilDeadline(id) {
    const entry = this.deadlines.get(id);
    if (!entry) throw new Error(`Deadline not found: ${id}`);
    
    const now = new Date();
    const ms = entry.due.getTime() - now.getTime();
    
    let businessDays = null;
    if (entry.businessDaysOnly) {
      businessDays = ms > 0 ? businessDaysBetween(now, entry.due, this.holidays) : -businessDaysBetween(entry.due, now, this.holidays);
    }
    
    return {
      id,
      name: entry.name,
      due: entry.due,
      ms,
      formatted: formatDuration(Math.abs(ms)),
      overdue: ms < 0,
      status: entry.status,
      businessDays,
    };
  }
  
  listDeadlines() {
    return [...this.deadlines.values()].map(d => {
      const now = new Date();
      const ms = d.due.getTime() - now.getTime();
      return {
        id: d.id,
        name: d.name,
        due: d.due,
        ms,
        formatted: formatDuration(Math.abs(ms)),
        overdue: ms < 0,
        status: d.status,
        businessDaysOnly: d.businessDaysOnly,
      };
    });
  }
  
  // ── Timezone ─────────────────────────────────────────────────
  
  setDefaultTimezone(tz) {
    this.timezone = tz;
    this.emit('timezone:changed', { tz });
    return this;
  }
  
  now() { return new Date(); }
  nowIn(tz) { return formatInTimezone(new Date(), tz || this.timezone); }
  
  // ── Stats ────────────────────────────────────────────────────
  
  stats() {
    const activeDeadlines = [...this.deadlines.values()].filter(d => d.status === 'pending');
    const overdueDeadlines = activeDeadlines.filter(d => d.due < new Date());
    const activeSchedules = [...this.schedules.values()].filter(s => s.enabled);
    
    return {
      holidays: this.holidays.length,
      calendars: this.calendars.size,
      deadlines: {
        total: this.deadlines.size,
        pending: activeDeadlines.length,
        overdue: overdueDeadlines.length,
        completed: [...this.deadlines.values()].filter(d => d.status === 'completed').length,
      },
      schedules: {
        total: this.schedules.size,
        active: activeSchedules.length,
        paused: this.schedules.size - activeSchedules.length,
        totalRuns: [...this.schedules.values()].reduce((s, e) => s + e.runCount, 0),
      },
    };
  }
  
  // ── Internal ─────────────────────────────────────────────────
  
  _startScheduleTimer(entry) {
    if (!entry.enabled) return;
    
    const delay = Math.max(0, entry.nextRun.getTime() - Date.now());
    const timer = setTimeout(() => this._runSchedule(entry), delay);
    this._scheduleTimers.set(entry.id, timer);
  }
  
  _clearScheduleTimer(id) {
    const timer = this._scheduleTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._scheduleTimers.delete(id);
    }
  }
  
  async _runSchedule(entry) {
    this._clearScheduleTimer(entry.id);
    
    entry.runCount++;
    entry.lastRun = new Date();
    
    this.emit('schedule:fired', { id: entry.id, expr: entry.expr, runCount: entry.runCount });
    this._log({ type: 'schedule:fired', id: entry.id, expr: entry.expr, at: entry.lastRun });
    
    try {
      if (entry.callback) {
        await entry.callback(entry);
      }
    } catch (err) {
      this.emit('schedule:error', { id: entry.id, error: err.message });
    }
    
    // Schedule next run
    if (entry.enabled) {
      entry.nextRun = nextOccurrence(entry.schedule, new Date());
      this._startScheduleTimer(entry);
    }
    
    this._persistState();
  }
  
  _setupDeadlineTimers(entry) {
    const now = Date.now();
    const dueMs = entry.due.getTime();
    
    // Alert timer
    if (entry.alertBefore) {
      const alertAt = dueMs - entry.alertBefore;
      if (alertAt > now) {
        const timer = setTimeout(() => {
          entry.alerts.push({ type: 'warning', at: new Date() });
          this.emit('deadline:alert', {
            id: entry.id,
            name: entry.name,
            due: entry.due,
            remaining: formatDuration(dueMs - Date.now()),
          });
          this._log({ type: 'deadline:alert', id: entry.id, name: entry.name });
        }, alertAt - now);
        
        this._deadlineTimers.set(`${entry.id}:alert`, timer);
      }
    }
    
    // Due timer
    if (dueMs > now) {
      const timer = setTimeout(() => {
        entry.status = 'overdue';
        this.emit('deadline:overdue', { id: entry.id, name: entry.name, due: entry.due });
        this._log({ type: 'deadline:overdue', id: entry.id, name: entry.name });
        this._persistState();
        
        if (entry.callback) {
          try { entry.callback(entry); } catch (err) {
            this.emit('deadline:error', { id: entry.id, error: err.message });
          }
        }
      }, dueMs - now);
      
      this._deadlineTimers.set(`${entry.id}:due`, timer);
    }
  }
  
  _clearDeadlineTimers(id) {
    for (const [key, timer] of this._deadlineTimers) {
      if (key.startsWith(id + ':')) {
        clearTimeout(timer);
        this._deadlineTimers.delete(key);
      }
    }
  }
  
  _persistState() {
    if (!this._persistencePath) return;
    
    const dir = this._persistencePath.substring(0, this._persistencePath.lastIndexOf('/'));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    
    const state = {
      holidays: this.holidays,
      timezone: this.timezone,
      deadlines: [...this.deadlines.values()].map(d => ({
        id: d.id, name: d.name, due: d.due.toISOString(),
        businessDaysOnly: d.businessDaysOnly,
        alertBefore: d.alertBefore,
        status: d.status, createdAt: d.createdAt.toISOString(),
        alerts: d.alerts,
      })),
      schedules: [...this.schedules.values()].map(s => ({
        id: s.id, expr: s.expr, schedule: s.schedule,
        enabled: s.enabled, runCount: s.runCount,
        lastRun: s.lastRun?.toISOString() || null,
        nextRun: s.nextRun?.toISOString() || null,
        createdAt: s.createdAt.toISOString(),
      })),
    };
    
    writeFileSync(this._persistencePath, JSON.stringify(state, null, 2));
  }
  
  _loadState() {
    try {
      const raw = readFileSync(this._persistencePath, 'utf8');
      const state = JSON.parse(raw);
      
      if (state.holidays) this.holidays = state.holidays;
      if (state.timezone) this.timezone = state.timezone;
      
      if (state.deadlines) {
        for (const d of state.deadlines) {
          const entry = {
            ...d,
            due: new Date(d.due),
            createdAt: new Date(d.createdAt),
            callback: null,
          };
          this.deadlines.set(d.id, entry);
          if (entry.status === 'pending') {
            this._setupDeadlineTimers(entry);
          }
          const num = parseInt(d.id.replace('dl_', ''), 10);
          if (num > this._deadlineIdCounter) this._deadlineIdCounter = num;
        }
      }
      
      if (state.schedules) {
        for (const s of state.schedules) {
          const entry = {
            ...s,
            lastRun: s.lastRun ? new Date(s.lastRun) : null,
            nextRun: s.nextRun ? new Date(s.nextRun) : nextOccurrence(s.schedule, new Date()),
            createdAt: new Date(s.createdAt),
            callback: null,
          };
          this.schedules.set(s.id, entry);
          if (entry.enabled) {
            entry.nextRun = nextOccurrence(entry.schedule, new Date());
            this._startScheduleTimer(entry);
          }
          const num = parseInt(s.id.replace('sched_', ''), 10);
          if (num > this._scheduleIdCounter) this._scheduleIdCounter = num;
        }
      }
    } catch (err) {
      // Ignore load errors
    }
  }
  
  _log(entry) {
    if (!this._logPath) return;
    const dir = this._logPath.substring(0, this._logPath.lastIndexOf('/'));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(this._logPath, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n');
  }
  
  destroy() {
    for (const timer of this._scheduleTimers.values()) clearTimeout(timer);
    for (const timer of this._deadlineTimers.values()) clearTimeout(timer);
    this._scheduleTimers.clear();
    this._deadlineTimers.clear();
    this.removeAllListeners();
  }
}

export default AgentClock;
