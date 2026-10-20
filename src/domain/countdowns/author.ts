/**
 * Countdowns from a file, additively — `provision.ts --countdowns <path|->`.
 *
 * Countdowns used to come only from the household SQL, and re-applying that file is
 * `--household --force`, which deletes children and with them the ledger. A grown-up's
 * birthday is not worth a child's earned money, so this path does one thing: upsert the rows
 * it names, by id. It never deletes; `"active": false` takes one off the wall and keeps it.
 *
 * A whole file is refused if any entry is malformed, so a typo cannot half-apply.
 */
import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';

export interface CountdownEntry {
  id: string;
  labelShort: string;
  labelFull: string;
  emoji: string | null;
  icon: string;
  targetDate: string | null;
  annualMd: string | null;
  childId: string | null;
  horizonDays: number | null;
  active: boolean;
}

export type CountdownParse = { ok: true; entries: CountdownEntry[] } | { ok: false; errors: string[] };

const ID_RE = /^cd-[a-z0-9][a-z0-9-]{0,62}$/;
const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** The icon every countdown in this house already points at; the emoji is what is drawn. */
const DEFAULT_ICON = 'ico-cake';

export function parseCountdownFile(raw: unknown): CountdownParse {
  if (!Array.isArray(raw)) return { ok: false, errors: ['expected a JSON array of countdowns'] };
  const errors: string[] = [];
  const entries: CountdownEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const at = `[${String(i)}]`;
    const q = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const fail = (why: string) => errors.push(`${at} ${why}`);
    const { id, labelShort, labelFull, emoji, icon, date, annual, childId, horizonDays, active } = q;
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail('id must look like cd-something');
    if (seen.has(id)) return fail(`${id} appears twice`);
    seen.add(id);
    if (typeof labelShort !== 'string' || labelShort.length < 1 || labelShort.length > 14) {
      return fail(`${id}: labelShort must be 1-14 characters`);
    }
    if (labelFull !== undefined && typeof labelFull !== 'string') return fail(`${id}: labelFull must be text`);
    if (emoji !== undefined && emoji !== null && typeof emoji !== 'string') return fail(`${id}: emoji must be text`);
    if (icon !== undefined && typeof icon !== 'string') return fail(`${id}: icon must be an asset id`);
    const hasDate = date !== undefined && date !== null;
    const hasAnnual = annual !== undefined && annual !== null;
    if (hasDate === hasAnnual) return fail(`${id}: give exactly one of date (YYYY-MM-DD) or annual (MM-DD)`);
    if (hasDate && (typeof date !== 'string' || !DATE_RE.test(date))) return fail(`${id}: date must be YYYY-MM-DD`);
    if (hasAnnual && (typeof annual !== 'string' || !MD_RE.test(annual))) return fail(`${id}: annual must be MM-DD`);
    if (childId !== undefined && childId !== null && typeof childId !== 'string') return fail(`${id}: childId must be text or null`);
    if (
      horizonDays !== undefined &&
      horizonDays !== null &&
      !(typeof horizonDays === 'number' && Number.isInteger(horizonDays) && horizonDays >= 0 && horizonDays <= 366)
    ) {
      return fail(`${id}: horizonDays must be a whole number of days, 0-366, or null for the default`);
    }
    if (active !== undefined && typeof active !== 'boolean') return fail(`${id}: active must be true or false`);
    entries.push({
      id,
      labelShort,
      labelFull: typeof labelFull === 'string' ? labelFull : labelShort,
      emoji: typeof emoji === 'string' ? emoji : null,
      icon: typeof icon === 'string' ? icon : DEFAULT_ICON,
      targetDate: hasDate ? (date as string) : null,
      annualMd: hasAnnual ? (annual as string) : null,
      childId: typeof childId === 'string' ? childId : null,
      horizonDays: typeof horizonDays === 'number' ? horizonDays : null,
      active: active !== false,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

export interface CountdownApply {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/** Upsert by id, in one transaction. A dangling icon or child refuses the whole file. */
export function applyCountdowns(db: Db, entries: readonly CountdownEntry[]): CountdownApply {
  const errors: string[] = [];
  const hasAsset = db.prepare('SELECT 1 FROM asset WHERE id = ?');
  const hasChild = db.prepare('SELECT 1 FROM child WHERE id = ?');
  for (const e of entries) {
    if (!hasAsset.get(e.icon)) errors.push(`${e.id}: no asset called ${e.icon}`);
    if (e.childId !== null && !hasChild.get(e.childId)) errors.push(`${e.id}: no child called ${e.childId}`);
  }
  const result: CountdownApply = { added: 0, updated: 0, unchanged: 0, errors };
  if (errors.length > 0) return result;

  const current = db.prepare(
    `SELECT label_short, label_full, icon_asset_id, emoji, target_date, annual_md, child_id, active, horizon_days
       FROM countdown WHERE id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO countdown (id, label_short, label_full, icon_asset_id, emoji, target_date, annual_md, child_id, active, horizon_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label_short = excluded.label_short, label_full = excluded.label_full,
       icon_asset_id = excluded.icon_asset_id, emoji = excluded.emoji,
       target_date = excluded.target_date, annual_md = excluded.annual_md,
       child_id = excluded.child_id, active = excluded.active, horizon_days = excluded.horizon_days`,
  );
  inTransaction(db, () => {
    for (const e of entries) {
      const next = [e.labelShort, e.labelFull, e.icon, e.emoji, e.targetDate, e.annualMd, e.childId, e.active ? 1 : 0, e.horizonDays];
      const was = current.get(e.id) as Record<string, unknown> | undefined;
      if (was === undefined) result.added += 1;
      else if (JSON.stringify(Object.values(was)) === JSON.stringify(next)) result.unchanged += 1;
      else result.updated += 1;
      upsert.run(e.id, ...next);
    }
  });
  return result;
}
