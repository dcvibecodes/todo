'use strict';

// Shared repeat-rule + timezone math for recurring reminders.
//
// A repeat rule is stored as the string 'none', or as JSON:
//   { type: 'daily'|'weekly'|'monthly'|'yearly'|'custom',
//     interval: N,                 // default 1; custom requires >= 1
//     unit: 'days'|'weeks'|'months', // custom only
//     anchorDay: 1-31,             // monthly/yearly/custom-months: day-of-month to aim for
//     anchorMonth: 1-12,           // yearly only
//     anchorHour: 0-23,            // zone series: intended wall-clock time
//     anchorMinute: 0-59 }         // zone series: intended wall-clock time
//
// MONTH-EDGE POLICY (acceptance requirement): a monthly series anchored on the
// 31st clamps to the last day of short months (Feb 28/29, Apr 30, ...) and then
// returns to the anchor day (31st) the next month. The anchor is stored in the
// rule, so late completion never drifts the series. Yearly Feb 29 clamps to
// Feb 28 in non-leap years for the same reason.
//
// Time models: 'fixed' (absolute UTC instant), 'floating' ("6pm wherever I
// am", computed in the last-synced device zone), 'anchored' ("6pm in a fixed
// zone"). Pass zone=null for fixed (UTC calendar math); otherwise an IANA zone
// name for wall-clock math. Existing reminders keep model 'fixed'.

const REPEAT_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
const CUSTOM_UNITS = ['days', 'weeks', 'months'];

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

// ---------- timezones ----------

function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Wall-clock fields of an instant in a zone: { y, mo (1-12), d, h, mi }.
function instantToWall(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    y: Number(get('year')),
    mo: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')) % 24,
    mi: Number(get('minute')),
  };
}

// Offset (ms) of a zone at a given instant, via the classic format-roundtrip.
function zoneOffsetMs(zone, ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type).value;
  const asUTC = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')) % 24, Number(get('minute')), Number(get('second'))
  );
  return asUTC - Math.floor(ms / 1000) * 1000;
}

// Calendar-date fields for `k` days after (y, mo, d), normalized (day 32 is
// the 1st of the next month) with the resulting weekday (0=Sunday).
function wallDayOffset(y, mo, d, k) {
  const t = new Date(Date.UTC(y, mo - 1, d + k));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

// Resolve wall-clock fields in a zone back to an instant. Overflowing fields
// (day 32, month 13) are normalized FIRST so a plain month boundary is never
// mistaken for a DST anomaly. Handles DST gaps by rolling forward (2:30am on
// spring-forward day lands in the first valid time after the gap) and
// ambiguous times by settling on the earlier offset.
function wallToInstant(zone, w) {
  const pre = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const preDate = new Date(pre);
  const wall = {
    y: preDate.getUTCFullYear(),
    mo: preDate.getUTCMonth() + 1,
    d: preDate.getUTCDate(),
    h: preDate.getUTCHours(),
    mi: preDate.getUTCMinutes(),
  };
  let t = pre - zoneOffsetMs(zone, pre);
  for (let i = 0; i < 4; i += 1) {
    const off = zoneOffsetMs(zone, t);
    const next = pre - off;
    if (next === t) break;
    t = next;
  }
  const wallMatch = (c) => c.y === wall.y && c.mo === wall.mo && c.d === wall.d && c.h === wall.h && c.mi === wall.mi;
  const check = instantToWall(t, zone);
  if (!wallMatch(check)) {
    // The wall time does not exist (DST gap): 2:30am resolves to 3:30am or
    // whatever instant the offset math already converged to, provided no
    // existing later wall time matches. Step in 15-minute increments looking
    // for one; if none appears, keep the converged roll-forward instant
    // instead of blindly adding extra hours.
    let found = null;
    for (let i = 0; i < 12; i += 1) {
      const probe = t + (i + 1) * 15 * 60 * 1000;
      if (wallMatch(instantToWall(probe, zone))) { found = probe; break; }
    }
    if (found !== null) t = found;
  }
  return new Date(t).toISOString();
}

function daysInMonth(y, mo1) {
  return new Date(Date.UTC(y, mo1, 0)).getUTCDate();
}

// ---------- repeat rules ----------

function parseRepeatRule(value) {
  if (value === undefined || value === null || value === '' || value === 'none') {
    return { type: 'none' };
  }
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase();
    if (['daily', 'weekly', 'monthly', 'yearly'].includes(word)) {
      return { type: word, interval: 1 };
    }
    try {
      return parseRepeatRule(JSON.parse(value));
    } catch {
      return bad('Invalid repeat rule');
    }
  }
  if (typeof value !== 'object') return bad('Invalid repeat rule');
  const type = String(value.type || 'none').toLowerCase();
  if (type === 'none') return { type: 'none' };
  if (!REPEAT_TYPES.includes(type)) return bad('Invalid repeat rule');
  const interval = value.interval === undefined ? 1 : Number(value.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) {
    return bad('Repeat interval must be a whole number from 1 to 366');
  }
  const rule = { type, interval };
  if (type === 'custom') {
    const unit = String(value.unit || 'days').toLowerCase();
    if (!CUSTOM_UNITS.includes(unit)) return bad('Custom repeat unit must be days, weeks, or months');
    rule.unit = unit;
  }
  if (type === 'weekly' && value.weekdays !== undefined) {
    const weekdays = Array.isArray(value.weekdays) ? value.weekdays : null;
    if (!weekdays || !weekdays.length || weekdays.length > 7
      || !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      || new Set(weekdays).size !== weekdays.length) {
      return bad('Invalid repeat weekdays');
    }
    rule.weekdays = [...weekdays].sort((a, b) => a - b);
  }
  if (value.anchorDay !== undefined) {
    const anchorDay = Number(value.anchorDay);
    if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) return bad('Invalid repeat anchor day');
    rule.anchorDay = anchorDay;
  }
  if (value.anchorMonth !== undefined) {
    const anchorMonth = Number(value.anchorMonth);
    if (!Number.isInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12) return bad('Invalid repeat anchor month');
    rule.anchorMonth = anchorMonth;
  }
  if (value.anchorHour !== undefined) {
    const anchorHour = Number(value.anchorHour);
    if (!Number.isInteger(anchorHour) || anchorHour < 0 || anchorHour > 23) return bad('Invalid repeat anchor hour');
    rule.anchorHour = anchorHour;
  }
  if (value.anchorMinute !== undefined) {
    const anchorMinute = Number(value.anchorMinute);
    if (!Number.isInteger(anchorMinute) || anchorMinute < 0 || anchorMinute > 59) return bad('Invalid repeat anchor minute');
    rule.anchorMinute = anchorMinute;
  }
  return rule;
}

function encodeRepeatRule(rule) {
  if (!rule || rule.type === 'none') return 'none';
  return JSON.stringify(rule);
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ruleLabel(rule) {
  if (!rule || rule.type === 'none') return 'Does not repeat';
  const n = rule.interval || 1;
  switch (rule.type) {
    case 'daily': return n === 1 ? 'Daily' : `Every ${n} days`;
    case 'weekly': {
      const base = n === 1 ? 'Weekly' : `Every ${n} weeks`;
      if (n === 1 && Array.isArray(rule.weekdays) && rule.weekdays.length === 1) {
        return `${base} on ${WEEKDAY_LABELS[rule.weekdays[0]]}`;
      }
      return base;
    }
    case 'monthly': return n === 1 ? 'Monthly' : `Every ${n} months`;
    case 'yearly': return n === 1 ? 'Yearly' : `Every ${n} years`;
    case 'custom': {
      const unit = rule.unit === 'weeks' ? 'week' : rule.unit === 'months' ? 'month' : 'day';
      return n === 1 ? `Daily-equivalent (${unit})` : `Every ${n} ${unit}s`;
    }
    default: return 'Repeats';
  }
}

function isRecurringRule(rule) {
  return Boolean(rule && rule.type && rule.type !== 'none');
}

// Fill anchorDay/anchorMonth/anchorHour/anchorMinute from the series start
// date, in the effective zone. anchorHour/anchorMinute pin the wall-clock time
// so a DST gap on one occurrence (2:30am does not exist on spring-forward day)
// is rolled forward for that day only instead of shifting the whole series.
function anchorRule(rule, dueISO, zone) {
  const out = { ...rule };
  const dueMs = new Date(dueISO).getTime();
  const wall = zone ? instantToWall(dueMs, zone) : null;
  const d = new Date(dueMs);
  const needsDay = rule.type === 'monthly' || rule.type === 'yearly'
    || (rule.type === 'custom' && rule.unit === 'months');
  if (needsDay && out.anchorDay === undefined) {
    out.anchorDay = wall ? wall.d : d.getUTCDate();
  }
  if (rule.type === 'yearly' && out.anchorMonth === undefined) {
    out.anchorMonth = wall ? wall.mo : d.getUTCMonth() + 1;
  }
  if (out.anchorHour === undefined) out.anchorHour = wall ? wall.h : d.getUTCHours();
  if (out.anchorMinute === undefined) out.anchorMinute = wall ? wall.mi : d.getUTCMinutes();
  return out;
}

// One step forward from a scheduled occurrence. The anchor in the rule keeps
// monthly/yearly series on their original day-of-month (clamped in short
// months), so late completion never drifts the schedule.
function advanceOccurrence(rule, fromISO, zone) {
  const from = new Date(fromISO).getTime();
  if (Number.isNaN(from)) bad('Invalid date');
  const interval = rule.interval || 1;

  if (!zone) {
    const d = new Date(from);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const h = d.getUTCHours();
    const mi = d.getUTCMinutes();
    const at = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd, h, mi)).toISOString();
    if (rule.type === 'daily' || (rule.type === 'custom' && rule.unit === 'days')) {
      return at(y, mo, day + interval);
    }
    if (rule.type === 'weekly') {
      // Weekday-targeted series ("every mon"): the next calendar day whose
      // weekday is in the rule, not from+7*interval (which would pin the
      // rhythm to whatever weekday the series started on).
      if (interval === 1 && Array.isArray(rule.weekdays) && rule.weekdays.length) {
        for (let k = 1; k <= 7; k += 1) {
          const probe = new Date(Date.UTC(y, mo - 1, day + k));
          if (rule.weekdays.includes(probe.getUTCDay())) return at(y, mo, day + k);
        }
      }
      return at(y, mo, day + 7 * interval);
    }
    if (rule.type === 'custom' && rule.unit === 'weeks') {
      return at(y, mo, day + 7 * interval);
    }
    if (rule.type === 'monthly' || (rule.type === 'custom' && rule.unit === 'months')) {
      const total = (y * 12 + (mo - 1)) + interval;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      return at(ny, nm, Math.min(rule.anchorDay ?? day, daysInMonth(ny, nm)));
    }
    if (rule.type === 'yearly') {
      const ny = y + interval;
      const nm = rule.anchorMonth ?? mo;
      return at(ny, nm, Math.min(rule.anchorDay ?? day, daysInMonth(ny, nm)));
    }
    return bad('Invalid repeat rule');
  }

  const w = instantToWall(from, zone);
  // Use the series' intended clock time, not whatever the previous occurrence
  // happened to resolve to. On spring-forward day 2:30 rolls forward to 3:30;
  // without the anchor, every later occurrence would inherit 3:30 forever.
  const h = Number.isInteger(rule.anchorHour) ? rule.anchorHour : w.h;
  const mi = Number.isInteger(rule.anchorMinute) ? rule.anchorMinute : w.mi;
  const at = (parts) => wallToInstant(zone, { ...parts, h, mi });
  if (rule.type === 'daily' || (rule.type === 'custom' && rule.unit === 'days')) {
    return at({ y: w.y, mo: w.mo, d: w.d + interval });
  }
  if (rule.type === 'weekly') {
    if (interval === 1 && Array.isArray(rule.weekdays) && rule.weekdays.length) {
      for (let k = 1; k <= 7; k += 1) {
        const day = wallDayOffset(w.y, w.mo, w.d, k);
        if (rule.weekdays.includes(day.dow)) return at({ y: day.y, mo: day.mo, d: day.d });
      }
    }
    return at({ y: w.y, mo: w.mo, d: w.d + 7 * interval });
  }
  if (rule.type === 'custom' && rule.unit === 'weeks') {
    return at({ y: w.y, mo: w.mo, d: w.d + 7 * interval });
  }
  if (rule.type === 'monthly' || (rule.type === 'custom' && rule.unit === 'months')) {
    const total = (w.y * 12 + (w.mo - 1)) + interval;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return at({ y: ny, mo: nm, d: Math.min(rule.anchorDay ?? w.d, daysInMonth(ny, nm)) });
  }
  if (rule.type === 'yearly') {
    const ny = w.y + interval;
    const nm = rule.anchorMonth ?? w.mo;
    return at({ y: ny, mo: nm, d: Math.min(rule.anchorDay ?? w.d, daysInMonth(ny, nm)) });
  }
  return bad('Invalid repeat rule');
}

// First scheduled occurrence strictly after `now`, advancing from the
// SCHEDULED time (never from the completion time), so late completion keeps
// the original rhythm with no drift. Already-past occurrences are skipped.
function firstFutureOccurrence(rule, fromISO, zone, nowISO) {
  if (!isRecurringRule(rule)) return null;
  const now = new Date(nowISO || new Date().toISOString()).getTime();
  let candidate = advanceOccurrence(rule, fromISO, zone);
  let guard = 0;
  while (new Date(candidate).getTime() <= now) {
    candidate = advanceOccurrence(rule, candidate, zone);
    guard += 1;
    if (guard > 10000) bad('Repeat rule did not reach a future date');
  }
  return candidate;
}

// Keep a wall-clock time but move it into a new zone ("6pm wherever I am").
// Used when the device reports a new timezone for floating reminders.
function recomputeInZone(dueISO, fromZone, toZone) {
  const w = instantToWall(new Date(dueISO).getTime(), fromZone);
  return wallToInstant(toZone, w);
}

// ---------- natural-language repeat detection ----------
// PWA reality check: chrono gives us the date; recurrence keywords are matched
// here with plain regexes so the rule model stays dependency-free.

const WEEKDAY_TOKENS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const REPEAT_PATTERNS = [
  { re: /\bevery\s+(\d{1,3})\s+(days?|weeks?|months?)\b/i, custom: true },
  { re: /\bevery\s+other\s+weeks?\b/i, rule: () => ({ type: 'weekly', interval: 2 }) },
  { re: /\b(?:every|each)\s+(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i, weekday: true },
  { re: /\b(daily|every\s+day|each\s+day)\b/i, type: 'daily' },
  { re: /\b(weekly|every\s+week|each\s+week)\b/i, type: 'weekly' },
  { re: /\b(monthly|every\s+month|each\s+month)\b/i, type: 'monthly' },
  { re: /\b(yearly|every\s+year|each\s+year)\b/i, type: 'yearly' },
];

function detectRepeat(text) {
  const input = String(text || '');
  for (const pattern of REPEAT_PATTERNS) {
    const match = input.match(pattern.re);
    if (!match) continue;
    let rule;
    if (pattern.custom) {
      const interval = Number(match[1]);
      const word = match[2].toLowerCase();
      const unit = word.startsWith('day') ? 'days' : word.startsWith('week') ? 'weeks' : 'months';
      if (!Number.isInteger(interval) || interval < 1 || interval > 366) continue;
      rule = { type: 'custom', interval, unit };
    } else if (pattern.weekday) {
      rule = { type: 'weekly', interval: 1, weekdays: [WEEKDAY_TOKENS[match[1].toLowerCase()]] };
    } else if (pattern.rule) {
      rule = pattern.rule();
    } else {
      rule = { type: pattern.type, interval: 1 };
    }
    const cleaned = input.replace(match[0], ' ').replace(/\s{2,}/g, ' ').replace(/[\s,;]+$/, '').trim();
    return { rule, cleaned };
  }
  return { rule: { type: 'none' }, cleaned: input.trim() };
}

// Ordinal-position idioms mean rank, not a date ("3rd place", "1st annual").
const MONTHDAY_STOPWORDS = new Set([
  'place', 'annual', 'anniversary', 'amendment', 'century', 'edition', 'seed',
  'inning', 'innings', 'grade', 'round', 'quarter', 'trimester', 'attempt',
  'volume', 'episode', 'chapter',
]);

// Bare day-of-month phrases chrono won't touch ("on the 31st", "the 10th").
// Returns the day plus the text with the phrase removed, or null.
function detectMonthDay(text) {
  const input = String(text || '');
  const match = input.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i);
  if (!match) return null;
  const day = Number(match[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  // "the 3rd place win" / "the 22nd amendment": the next word marks an
  // ordinal rank, not a day of month.
  const after = input.slice(match.index + match[0].length);
  const nextWord = (after.match(/^\s*([a-z]+)/i) || [])[1];
  if (nextWord && MONTHDAY_STOPWORDS.has(nextWord.toLowerCase())) return null;
  const cleaned = input.replace(match[0], ' ').replace(/\s{2,}/g, ' ').replace(/[\s,;]+$/, '').trim();
  return { day, cleaned };
}

// Resolve a day-of-month to the upcoming calendar date in a zone.
function upcomingMonthDay(day, zone, nowMs) {
  const w = instantToWall(nowMs, zone);
  let y = w.y;
  let mo = w.mo;
  if (day < w.d || day > daysInMonth(y, mo)) {
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  const d = Math.min(day, daysInMonth(y, mo));
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

module.exports = {
  REPEAT_TYPES,
  parseRepeatRule,
  encodeRepeatRule,
  ruleLabel,
  isRecurringRule,
  anchorRule,
  advanceOccurrence,
  firstFutureOccurrence,
  recomputeInZone,
  detectRepeat,
  detectMonthDay,
  upcomingMonthDay,
  isValidTimeZone,
  instantToWall,
  wallToInstant,
};