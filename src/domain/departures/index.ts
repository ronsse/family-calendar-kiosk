/**
 * The leave-by rules: stored, read back with defaults, and edited from the wall.
 *
 * Asked for after the school-calendar cleanup: *"there's things like get ready for dance, get
 * dressed for gymnastics … and incorporating an alarm component before those events because
 * we got to get ready before we go. School is 10 minutes away, we try to leave between 7:30
 * and 7:40. Gymnastics, 10 minutes away. Dance, 10 minutes away. Think about a way to have an
 * alarm or an alert that we can turn on and off. I don't know if we always want it."*
 *
 * ## What is a rule and what is a judgement
 *
 * This module holds the RULES — how long "get ready" is, how far the drive is, when the school
 * run leaves, which kinds of event count — as one JSON value under `household_config`. It
 * never decides whether it is time to get ready: that judgement needs the wall's clock and
 * today's events, both of which the client already has, and it is made there
 * (`web/src/views/logic/departures.ts`) from local state like every other time-of-day call on
 * this wall. The server stores; the wall reads.
 *
 * ## Defaults are the household's answer, not a placeholder
 *
 * A missing row yields the rules exactly as the household described them, so the feature is
 * ON the day it ships — "we can try it out and see if it's valuable" — and a household that
 * turns it off keeps every other number. Every field is validated on the way in and on the
 * way out: a hand-edited row with one bad field falls back to the default for THAT field, not
 * to a wall with no alerts and no explanation.
 *
 * ## Bounds
 *
 * Sanity rails for a stepper on a touchscreen, as in `domain/settings`: a stuck finger must
 * not walk "get ready" to nine hours. Five-minute steps for the school time, because a wall
 * with no keyboard edits a clock by tapping, and 7:35 is a real answer where 7:33 is noise.
 */

import type { Database as Db } from 'better-sqlite3';
import { DAY_CODES, type DayCode, type DepartureRules, type LocalTime } from '../../types.ts';
import { EVENT_CATEGORIES, isEventCategory, type EventCategory } from '../../calendar/classify.ts';
import { isLocalTime } from '../../time.ts';

export const DEPARTURES_KEY = 'departures';

export const MIN_LEAD_MINUTES = 0;
export const MAX_LEAD_MINUTES = 120;
/** The school time moves in these steps from the wall. */
export const SCHOOL_TIME_STEP_MINUTES = 5;

export const DEFAULT_DEPARTURE_RULES: DepartureRules = {
  enabled: true,
  readyMinutes: 20,
  travelMinutes: 10,
  school: {
    leaveAt: '07:35' as LocalTime,
    days: ['MO', 'TU', 'WE', 'TH', 'FR'],
    label: 'School',
  },
  eventCategories: ['dance', 'sport'],
};

function isDayCode(v: unknown): v is DayCode {
  return typeof v === 'string' && (DAY_CODES as readonly string[]).includes(v);
}

function leadMinutes(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_LEAD_MINUTES && v <= MAX_LEAD_MINUTES
    ? v
    : fallback;
}

/**
 * The rules as stored, with every field that fails validation replaced by its default.
 * A row that is not JSON, or not an object, reads as the defaults entire.
 */
export function parseDepartureRules(text: string | null | undefined): DepartureRules {
  const d = DEFAULT_DEPARTURE_RULES;
  if (typeof text !== 'string') return d;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const school =
    typeof r['school'] === 'object' && r['school'] !== null && !Array.isArray(r['school'])
      ? (r['school'] as Record<string, unknown>)
      : {};
  const days = Array.isArray(school['days']) ? school['days'].filter(isDayCode) : d.school.days;
  const categories = Array.isArray(r['eventCategories'])
    ? r['eventCategories'].filter(isEventCategory)
    : d.eventCategories;
  return {
    enabled: typeof r['enabled'] === 'boolean' ? r['enabled'] : d.enabled,
    readyMinutes: leadMinutes(r['readyMinutes'], d.readyMinutes),
    travelMinutes: leadMinutes(r['travelMinutes'], d.travelMinutes),
    school: {
      leaveAt:
        typeof school['leaveAt'] === 'string' && isLocalTime(school['leaveAt'])
          ? school['leaveAt']
          : d.school.leaveAt,
      days: [...new Set(days)],
      label:
        typeof school['label'] === 'string' && school['label'].trim().length > 0
          ? school['label'].trim()
          : d.school.label,
    },
    eventCategories: [...new Set(categories)],
  };
}

export function readDepartureRules(db: Db): DepartureRules {
  const row = db
    .prepare(`SELECT value_text FROM household_config WHERE key = ?`)
    .get(DEPARTURES_KEY) as { value_text: string } | undefined;
  return parseDepartureRules(row?.value_text);
}

function writeDepartureRules(db: Db, rules: DepartureRules): void {
  db.prepare(
    `INSERT INTO household_config (key, value_text) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text`,
  ).run(DEPARTURES_KEY, JSON.stringify(rules));
}

/** What the wall may change. The days, the label and the categories are file-authored. */
export interface DepartureRulesPatch {
  readonly enabled?: boolean;
  readonly readyMinutes?: number;
  readonly travelMinutes?: number;
  readonly schoolLeaveAt?: string;
}

export type DepartureRulesFailure = 'out_of_range' | 'bad_value';

/**
 * Apply a patch. Every present field is checked before anything is written, so a request with
 * one bad field changes nothing — the wall re-renders from the response either way.
 */
export function updateDepartureRules(
  db: Db,
  patch: DepartureRulesPatch,
): { ok: true; rules: DepartureRules } | { ok: false; reason: DepartureRulesFailure } {
  const current = readDepartureRules(db);
  const next: DepartureRules = {
    ...current,
    school: { ...current.school },
    eventCategories: [...current.eventCategories],
  };
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') return { ok: false, reason: 'bad_value' };
    next.enabled = patch.enabled;
  }
  for (const key of ['readyMinutes', 'travelMinutes'] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: 'bad_value' };
    if (v < MIN_LEAD_MINUTES || v > MAX_LEAD_MINUTES) return { ok: false, reason: 'out_of_range' };
    next[key] = v;
  }
  if (patch.schoolLeaveAt !== undefined) {
    if (typeof patch.schoolLeaveAt !== 'string' || !isLocalTime(patch.schoolLeaveAt)) {
      return { ok: false, reason: 'bad_value' };
    }
    next.school.leaveAt = patch.schoolLeaveAt;
  }
  writeDepartureRules(db, next);
  return { ok: true, rules: next };
}

/** Every category the rules could name, for anyone listing them. */
export const DEPARTURE_CATEGORIES: readonly EventCategory[] = EVENT_CATEGORIES;
