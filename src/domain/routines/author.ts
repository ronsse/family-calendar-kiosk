/**
 * Routine steps from a file, additively — `provision.ts --routine-steps <path|->`.
 *
 * Until this path a NEW step could only come from the household SQL, and re-applying that is
 * `--household --force`, which deletes children and with them the ledger. The wall's own
 * screen can assign and reorder a step that exists (`assignStep`, `moveStep`) but cannot make
 * one, so "a Toys-away step at the start of bedtime" had no door at all.
 *
 * Each entry upserts ONE step row by id, then, for every child it names, puts the step in that
 * child's sequence (appended, through `assignStep`) and — when `position` is given — walks it
 * there through `moveStep`. Both reconcile today's run, so a step added at four in the
 * afternoon is on tonight's card, exactly as an assignment from the wall would be.
 *
 * It never deletes and never takes a step away from a child it does not name: leaving a child
 * out of `children` leaves their sequence alone. `"active": false` retires a step's row and
 * keeps it. A whole file is refused if any entry is malformed, so a typo cannot half-apply.
 */
import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { localDate as todayLocal } from '../../time.ts';
import type { LocalDate } from '../../types.ts';
import { assignStep, moveStep } from './assign.ts';

export interface RoutineStepEntry {
  id: string;
  routineId: string;
  labelShort: string;
  labelFull: string;
  icon: string;
  category: string;
  children: string[];
  /** 1-based place in each named child's sequence; null appends. */
  position: number | null;
  active: boolean;
}

export type RoutineStepParse = { ok: true; entries: RoutineStepEntry[] } | { ok: false; errors: string[] };

const STEP_ID_RE = /^st-[a-z0-9][a-z0-9-]{0,62}$/;
const ROUTINE_ID_RE = /^rt-[a-z0-9][a-z0-9-]{0,62}$/;

export function parseRoutineStepFile(raw: unknown): RoutineStepParse {
  if (!Array.isArray(raw)) return { ok: false, errors: ['expected a JSON array of routine steps'] };
  const errors: string[] = [];
  const entries: RoutineStepEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const at = `[${String(i)}]`;
    const q = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const fail = (why: string) => errors.push(`${at} ${why}`);
    const { id, routine, labelShort, labelFull, icon, category, children, position, active } = q;
    if (typeof id !== 'string' || !STEP_ID_RE.test(id)) return fail('id must look like st-something');
    if (seen.has(id)) return fail(`${id} appears twice`);
    seen.add(id);
    if (typeof routine !== 'string' || !ROUTINE_ID_RE.test(routine)) return fail(`${id}: routine must look like rt-something`);
    if (typeof labelShort !== 'string' || labelShort.length < 1 || labelShort.length > 14) {
      return fail(`${id}: labelShort must be 1-14 characters`);
    }
    if (labelFull !== undefined && typeof labelFull !== 'string') return fail(`${id}: labelFull must be text`);
    if (typeof icon !== 'string' || icon.length === 0) return fail(`${id}: icon must be an asset id`);
    if (typeof category !== 'string' || category.length === 0) return fail(`${id}: category must be text`);
    if (!Array.isArray(children) || !children.every((c) => typeof c === 'string')) {
      return fail(`${id}: children must be a list of child ids ([] assigns nobody)`);
    }
    if (new Set(children).size !== children.length) return fail(`${id}: a child is named twice`);
    if (
      position !== undefined &&
      position !== null &&
      !(typeof position === 'number' && Number.isInteger(position) && position >= 1 && position <= 50)
    ) {
      return fail(`${id}: position must be a whole number from 1, or null to append`);
    }
    if (active !== undefined && typeof active !== 'boolean') return fail(`${id}: active must be true or false`);
    entries.push({
      id,
      routineId: routine,
      labelShort,
      labelFull: typeof labelFull === 'string' ? labelFull : labelShort,
      icon,
      category,
      children: children as string[],
      position: typeof position === 'number' ? position : null,
      active: active !== false,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

export interface RoutineStepApply {
  added: number;
  updated: number;
  unchanged: number;
  /** Child sequences that changed (an assignment or a move). */
  sequencesChanged: number;
  errors: string[];
}

/**
 * Upsert by id, in one transaction. A dangling routine, icon or child refuses the whole file,
 * and so does a step id that already belongs to a different routine.
 */
export function applyRoutineSteps(
  db: Db,
  entries: readonly RoutineStepEntry[],
  date: LocalDate = todayLocal(),
): RoutineStepApply {
  const errors: string[] = [];
  const hasRoutine = db.prepare('SELECT 1 FROM routine WHERE id = ?');
  const hasAsset = db.prepare('SELECT 1 FROM asset WHERE id = ?');
  const hasChild = db.prepare('SELECT 1 FROM child WHERE id = ? AND active = 1');
  const ownerOf = db.prepare('SELECT routine_id FROM routine_step WHERE id = ?');
  for (const e of entries) {
    if (!hasRoutine.get(e.routineId)) errors.push(`${e.id}: no routine called ${e.routineId}`);
    if (!hasAsset.get(e.icon)) errors.push(`${e.id}: no asset called ${e.icon}`);
    for (const c of e.children) if (!hasChild.get(c)) errors.push(`${e.id}: no active child called ${c}`);
    const owner = ownerOf.get(e.id) as { routine_id: string } | undefined;
    if (owner !== undefined && owner.routine_id !== e.routineId) {
      errors.push(`${e.id}: already belongs to ${owner.routine_id}; a step cannot change routine`);
    }
  }
  const result: RoutineStepApply = { added: 0, updated: 0, unchanged: 0, sequencesChanged: 0, errors };
  if (errors.length > 0) return result;

  const current = db.prepare(
    `SELECT label_short, label_full, icon_asset_id, category, active FROM routine_step WHERE id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO routine_step (id, routine_id, label_short, label_full, icon_asset_id, category, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label_short = excluded.label_short, label_full = excluded.label_full,
       icon_asset_id = excluded.icon_asset_id, category = excluded.category, active = excluded.active`,
  );
  const sequence = db.prepare(
    `SELECT routine_step_id FROM routine_step_assignment
      WHERE routine_id = ? AND child_id = ? ORDER BY position`,
  );
  const indexOf = (routineId: string, childId: string, stepId: string): number =>
    (sequence.all(routineId, childId) as { routine_step_id: string }[]).findIndex((r) => r.routine_step_id === stepId);

  inTransaction(db, () => {
    for (const e of entries) {
      const next = [e.labelShort, e.labelFull, e.icon, e.category, e.active ? 1 : 0];
      const was = current.get(e.id) as Record<string, unknown> | undefined;
      if (was === undefined) result.added += 1;
      else if (JSON.stringify(Object.values(was)) === JSON.stringify(next)) result.unchanged += 1;
      else result.updated += 1;
      upsert.run(e.id, e.routineId, ...next);

      for (const childId of e.children) {
        const input = { routineId: e.routineId, stepId: e.id, childId };
        let changed = false;
        const a = assignStep(db, { ...input, assigned: true }, date);
        if (a.ok && a.changed) changed = true;
        if (e.position !== null) {
          // A position past the end means "last", which is where assignStep put it.
          for (let at = indexOf(e.routineId, childId, e.id); at > e.position - 1; at -= 1) {
            const m = moveStep(db, { ...input, direction: 'up' }, date);
            if (!m.ok || !m.changed) break;
            changed = true;
          }
          for (let at = indexOf(e.routineId, childId, e.id); at < e.position - 1; at += 1) {
            const m = moveStep(db, { ...input, direction: 'down' }, date);
            if (!m.ok || !m.changed) break;
            changed = true;
          }
        }
        if (changed) result.sequencesChanged += 1;
      }
    }
  });
  return result;
}
