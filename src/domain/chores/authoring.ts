/**
 * Chore AUTHORING — the one writer of chore definitions, shared by the CLI and the wall.
 *
 * Lived in `stacks/wall/entry/provision.ts` (`--chores FILE`) until 2026-09-14, when the wall
 * grew a "New chore" sheet. Two writers with two validators would drift the way the two scene
 * scripts drifted, so the rules moved HERE and both doors call the same functions: the CLI
 * parses a file into `ChoreAuthoring`, the admin route builds one entry from a request body,
 * and from there the path is identical — `validateChoreAuthoring`, then `applyChores` inside
 * one transaction guarded by `historyFingerprint`.
 *
 * ## Why it is this careful
 *
 * Chore definitions sit upstream of `chore_day`, `chore_assignment` and `ledger_entry` rows
 * that record work a child actually did and was paid for. This path therefore never deletes
 * anything — retiring is `active = 0` — and every field is checked before a transaction is
 * opened. That matters more than style consistency because a MIGRATED database has no CHECK
 * constraint on `kind` or `due_by_local` at all (SQLite cannot `ALTER TABLE ADD COLUMN` with
 * a CHECK, see `migrate.ts`), so on the household's real database the writer *is* the
 * constraint.
 *
 * The file format, and the three verbs (`chores` upserts, `retire`, `restore`), are documented
 * on `provision.ts`, which is where a person editing the file is pointed.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { localDate } from '../../time.ts';
import type { AssignmentModel, ChoreKind } from '../../types.ts';
import { evaluateRrule } from './recurrence.ts';

export interface ChoreSpec {
  id: string;
  labelShort: string;
  labelFull: string;
  iconAssetId: string;
  category: string;
  assignmentModel: AssignmentModel;
  basePoints: number;
  kind: ChoreKind;
  rrule: string;
  /** "HH:MM" local, or null for a chore with no window. */
  dueByLocal: string | null;
  /** Rotation order / roster. `null` means "leave whatever is already there alone". */
  rotation: string[] | null;
  /**
   * Whether finishing this duty counts toward a full day (ADR-0006 §4). Omitted means `true`
   * for a duty, and that is not "leave it alone": like every other field, the file wins on
   * re-apply. An extra never counts, so it is always `false` and `true` on one is refused
   * rather than stored as a promise nothing keeps.
   */
  countsTowardDay: boolean;
}

export interface ChoreAuthoring {
  chores: ChoreSpec[];
  retire: string[];
  restore: string[];
}

export type ChoreAction =
  | 'added'
  | 'updated'
  | 'unchanged'
  | 'retired'
  | 'already retired'
  | 'restored'
  | 'already active';

export interface ChoreChange {
  id: string;
  action: ChoreAction;
}

export type ChoreParseResult =
  | { ok: true; authoring: ChoreAuthoring }
  | { ok: false; errors: string[] };

const TOP_KEYS = new Set(['chores', 'retire', 'restore']);
const CHORE_KEYS = new Set([
  'id',
  'labelShort',
  'labelFull',
  'iconAssetId',
  'category',
  'assignmentModel',
  'basePoints',
  'kind',
  'rrule',
  'dueByLocal',
  'rotation',
  'countsTowardDay',
]);
const MODELS: ReadonlySet<string> = new Set([
  'individual',
  'shared',
  'first_complete',
  'rotation',
]);
const KINDS: ReadonlySet<string> = new Set(['duty', 'extra']);

// Stricter than the schema's `GLOB '[0-2][0-9]:[0-5][0-9]'`, which accepts "29:00". A strict
// SUBSET can never reject a value the table would have taken, so the two cannot disagree.
const DUE_BY_LOCAL = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Code points, not UTF-16 units — that is what SQLite's `length()` counts. */
function chars(s: string): number {
  return [...s].length;
}

function textField(
  o: Record<string, unknown>,
  key: string,
  where: string,
  errors: string[],
): string | null {
  const v = o[key];
  if (typeof v !== 'string') {
    errors.push(`${where}: ${key} is required and must be a string`);
    return null;
  }
  if (v.trim() !== v) {
    errors.push(`${where}: ${key} has leading or trailing whitespace`);
    return null;
  }
  if (v.length === 0) {
    errors.push(`${where}: ${key} must not be empty`);
    return null;
  }
  return v;
}

function enumField<T extends string>(
  o: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
  where: string,
  errors: string[],
): T | null {
  const v = o[key];
  if (typeof v !== 'string' || !allowed.has(v)) {
    errors.push(`${where}: ${key} must be one of ${[...allowed].join(', ')}`);
    return null;
  }
  return v as T;
}

function idListField(v: unknown, key: string, errors: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    errors.push(`"${key}" must be an array of chore ids`);
    return [];
  }
  const out: string[] = [];
  for (const [i, entry] of v.entries()) {
    if (typeof entry !== 'string' || entry.trim() !== entry || entry.length === 0) {
      errors.push(`${key}[${String(i)}]: must be a non-empty chore id`);
      continue;
    }
    if (out.includes(entry)) {
      errors.push(`${key}: "${entry}" is listed twice`);
      continue;
    }
    out.push(entry);
  }
  return out;
}

/**
 * A key that is a note for whoever is editing the file, not a field.
 *
 * `db/chores.example.json` is the template a household edits, and the guidance that belongs
 * with it — which `kind` puts a tile where, that `basePoints: 0` is what makes a duty unpaid —
 * belongs where the person is looking rather than in a docstring they will not open. Same
 * convention as `assets/manifest.json`.
 */
function isNote(key: string): boolean {
  return key.startsWith('_');
}

function parseSpec(entry: unknown, where: string, errors: string[]): ChoreSpec | null {
  if (!isObject(entry)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  const before = errors.length;

  // An unknown key is almost always a misremembered field name, and silently ignoring it is
  // the worst outcome: `"points": 9` looks applied and leaves the old price in place.
  // A leading underscore is the exception: an explicit note to the human editing the file,
  // the same convention `assets/manifest.json` already uses. It cannot mask a typo, because
  // `basepoints` still has no underscore and still fails.
  for (const key of Object.keys(entry)) {
    if (!isNote(key) && !CHORE_KEYS.has(key)) errors.push(`${where}: unknown key "${key}"`);
  }

  const id = textField(entry, 'id', where, errors);
  const labelShort = textField(entry, 'labelShort', where, errors);
  const labelFull = textField(entry, 'labelFull', where, errors);
  const iconAssetId = textField(entry, 'iconAssetId', where, errors);
  const category = textField(entry, 'category', where, errors);
  const assignmentModel = enumField<AssignmentModel>(
    entry,
    'assignmentModel',
    MODELS,
    where,
    errors,
  );
  const kind = enumField<ChoreKind>(entry, 'kind', KINDS, where, errors);
  const rrule = textField(entry, 'rrule', where, errors);

  // Labels are mandatory for BOTH bands and the length bound is real: a `label_short` of 15
  // characters is a CHECK failure at write time, and the reason the column is bounded at all
  // is that an overflowing card is unreadable to the child it was written for.
  if (labelShort !== null && chars(labelShort) > 14) {
    errors.push(
      `${where}: labelShort is ${String(chars(labelShort))} characters; the schema allows 1..14`,
    );
  }

  const basePoints = entry['basePoints'];
  if (typeof basePoints !== 'number' || !Number.isInteger(basePoints) || basePoints < 0) {
    errors.push(`${where}: basePoints must be an integer >= 0 (a duty is simply 0)`);
  }

  // An rrule the expander cannot read is the quietest possible failure: the chore is authored,
  // stored, active, and never appears on any board. Catch it here, where a human is looking.
  if (rrule !== null) {
    const evaluation = evaluateRrule(rrule, localDate());
    if (!evaluation.supported) {
      errors.push(
        `${where}: rrule "${rrule}" is not supported (${evaluation.reason}) — the chore would ` +
          'never reach the board',
      );
    }
  }

  let dueByLocal: string | null = null;
  const due = entry['dueByLocal'];
  if (due !== undefined && due !== null) {
    if (typeof due !== 'string' || !DUE_BY_LOCAL.test(due)) {
      errors.push(`${where}: dueByLocal must be local "HH:MM" between 00:00 and 23:59, or null`);
    } else {
      dueByLocal = due;
    }
  }

  /*
   * THREE STATES, and the middle one did not exist until 2026-09-23.
   *
   *   omitted / null  — leave the stored membership exactly as it is.
   *   []              — CLEAR it: the chore belongs to every active child.
   *   ["a", "b"]      — exactly these, in this order.
   *
   * `[]` used to be a validation error ("name at least one child, or omit it entirely"), which
   * meant the file format had no way to say "everyone" at all. That is not a cosmetic gap: the
   * household asked for the dog's chores to be open to all three children, the file was edited
   * to `"rotation": null`, `provision.ts` reported `updated`, and the stored roster of two
   * children was left untouched — so the youngest still could not walk the dog and nothing
   * anywhere said so. `null` meaning "no change" is right; it just is not the same request.
   */
  let rotation: string[] | null = null;
  const rot = entry['rotation'];
  if (rot !== undefined && rot !== null) {
    if (!Array.isArray(rot) || rot.some((v) => typeof v !== 'string' || v.length === 0)) {
      errors.push(`${where}: rotation must be an array of child ids`);
    } else if (new Set(rot).size !== rot.length) {
      errors.push(`${where}: rotation names the same child twice`);
    } else {
      rotation = rot as string[];
    }
  }

  // An extra never counts, so it is stored as not counting and may only say so.
  let countsTowardDay = kind !== 'extra';
  const counts = entry['countsTowardDay'];
  if (counts !== undefined) {
    if (typeof counts !== 'boolean') {
      errors.push(`${where}: countsTowardDay must be true or false`);
    } else if (kind === 'extra' && counts) {
      errors.push(`${where}: an extra never counts toward a full day; countsTowardDay is for duties`);
    } else {
      countsTowardDay = counts;
    }
  }

  if (errors.length !== before) return null;
  if (
    id === null ||
    labelShort === null ||
    labelFull === null ||
    iconAssetId === null ||
    category === null ||
    assignmentModel === null ||
    kind === null ||
    rrule === null ||
    typeof basePoints !== 'number'
  ) {
    return null;
  }
  return {
    id,
    labelShort,
    labelFull,
    iconAssetId,
    category,
    assignmentModel,
    basePoints,
    kind,
    rrule,
    dueByLocal,
    rotation,
    countsTowardDay,
  };
}

/**
 * Shape and field validation. Pure — it never touches the database, and it collects EVERY
 * error rather than stopping at the first, because a hand-edited file usually has more than
 * one problem and a caller who fixes them one round-trip at a time gives up.
 */
export function parseChoreFile(text: string): ChoreParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!isObject(raw)) {
    return {
      ok: false,
      errors: ['top level must be a JSON object with "chores", "retire" and/or "restore"'],
    };
  }

  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!isNote(key) && !TOP_KEYS.has(key)) {
      errors.push(`unknown top-level key "${key}" (expected ${[...TOP_KEYS].join(', ')})`);
    }
  }

  const chores: ChoreSpec[] = [];
  const rawChores = raw['chores'];
  if (rawChores !== undefined) {
    if (!Array.isArray(rawChores)) {
      errors.push('"chores" must be an array');
    } else {
      for (const [i, entry] of rawChores.entries()) {
        const spec = parseSpec(entry, `chores[${String(i)}]`, errors);
        if (spec === null) continue;
        if (chores.some((c) => c.id === spec.id)) {
          errors.push(`chores: "${spec.id}" is defined twice`);
          continue;
        }
        chores.push(spec);
      }
    }
  }

  const retire = idListField(raw['retire'], 'retire', errors);
  const restore = idListField(raw['restore'], 'restore', errors);

  for (const id of retire) {
    if (chores.some((c) => c.id === id)) {
      errors.push(`"${id}" is both defined in "chores" and listed in "retire"`);
    }
    if (restore.includes(id)) errors.push(`"${id}" is in both "retire" and "restore"`);
  }

  // Only when nothing ELSE is wrong. `chores` is also empty when every entry in it was
  // rejected, and reporting "the file names no chores" underneath nine parse errors tells the
  // reader the opposite of what happened — the file named one, and it was bad. An empty file is
  // a distinct situation and only deserves the message when it is the actual one.
  if (errors.length === 0 && chores.length + retire.length + restore.length === 0) {
    errors.push('nothing to do: the file names no chores, no retirements and no restorations');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, authoring: { chores, retire, restore } };
}

/**
 * Referential validation, read-only. Still before any write, and still collecting everything.
 *
 * `REFERENCES asset(id)` and `REFERENCES child(id)` would catch most of this as a foreign key
 * error mid-transaction, but the message would name a constraint rather than the line of the
 * file that is wrong, and it would arrive after some of the run had already been applied.
 */
export function validateChoreAuthoring(db: Db, authoring: ChoreAuthoring): string[] {
  const errors: string[] = [];
  const asset = db.prepare('SELECT id FROM asset WHERE id = ?');
  const child = db.prepare('SELECT id FROM child WHERE id = ?');
  const chore = db.prepare('SELECT id FROM chore WHERE id = ?');

  for (const c of authoring.chores) {
    if (asset.get(c.iconAssetId) === undefined) {
      errors.push(
        `chore ${c.id}: no asset "${c.iconAssetId}" — icons are registered at boot from ` +
          'assets/manifest.json',
      );
    }
    for (const childId of c.rotation ?? []) {
      if (child.get(childId) === undefined) errors.push(`chore ${c.id}: no child "${childId}"`);
    }
    // An empty rotation materializes a `chore_day` with no assignments at all: the day exists,
    // no child is asked, and every later read cheerfully retries the repair. Nothing is broken
    // and nothing happens, which is the hardest kind of authoring mistake to notice.
    const isNew = chore.get(c.id) === undefined;
    if (isNew && c.assignmentModel === 'rotation' && c.rotation === null) {
      errors.push(`chore ${c.id}: a new rotation chore needs "rotation": [...]`);
    }
    // `[]` means everyone, which every other model can express as an implicit roster — but a
    // rotation deals ONE turn to ONE child and has no such reading. It would materialize a day
    // with no assignee, silently, forever.
    if (c.assignmentModel === 'rotation' && c.rotation !== null && c.rotation.length === 0) {
      errors.push(`chore ${c.id}: a rotation needs a named order; "rotation": [] means everyone`);
    }
  }
  for (const id of authoring.retire) {
    if (chore.get(id) === undefined) errors.push(`retire: no chore "${id}"`);
  }
  for (const id of authoring.restore) {
    if (chore.get(id) === undefined) errors.push(`restore: no chore "${id}"`);
  }
  return errors;
}

/** Things worth saying out loud that are nonetheless not reasons to refuse the run. */
export function choreAuthoringWarnings(db: Db, authoring: ChoreAuthoring): string[] {
  const warnings: string[] = [];
  const inactiveChild = db.prepare('SELECT id FROM child WHERE id = ? AND active = 0');
  const unvalidatedAsset = db.prepare(
    'SELECT id FROM asset WHERE id = ? AND validated_at_utc IS NULL',
  );
  const claimed = db.prepare(
    `SELECT COUNT(*) AS n FROM chore_assignment a
       JOIN chore_day d ON d.id = a.chore_day_id
      WHERE d.chore_id = ? AND a.state = 'claimed'`,
  );

  for (const c of authoring.chores) {
    if (unvalidatedAsset.get(c.iconAssetId) !== undefined) {
      warnings.push(
        `chore ${c.id}: asset "${c.iconAssetId}" has never been validated, so the card will ` +
          'render the fallback icon',
      );
    }
    for (const childId of c.rotation ?? []) {
      if (inactiveChild.get(childId) !== undefined) {
        warnings.push(`chore ${c.id}: child "${childId}" is inactive and will be skipped`);
      }
    }
  }
  for (const id of authoring.retire) {
    const n = (claimed.get(id) as { n: number }).n;
    if (n > 0) {
      warnings.push(
        `retire ${id}: ${String(n)} claim(s) are still awaiting approval. The wall's read ` +
          'filters on active = 1, so those cards vanish unapproved — approve them first.',
      );
    }
  }
  return warnings;
}

/**
 * Counts and sums over everything this path must never move.
 *
 * Compared either side of the write inside the SAME transaction, so "authoring cannot touch
 * the ledger" is enforced by a rollback rather than asserted in a comment. `chore_day` is in
 * here for the same reason: `points_each` is a per-day SNAPSHOT, and a reprice that reached
 * into an already-materialized day would change what today pays after a child had already
 * been shown the price.
 */
export function historyFingerprint(db: Db): string {
  const ledger = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(delta), 0) AS s FROM ledger_entry')
    .get() as { n: number; s: number };
  const days = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(points_each), 0) AS s FROM chore_day')
    .get() as { n: number; s: number };
  const assignments = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(state = 'approved'), 0) AS s FROM chore_assignment`,
    )
    .get() as { n: number; s: number };
  return (
    `ledger ${String(ledger.n)}/${String(ledger.s)}  ` +
    `days ${String(days.n)}/${String(days.s)}  ` +
    `assignments ${String(assignments.n)}/${String(assignments.s)}`
  );
}

interface ChoreRow {
  label_short: string;
  label_full: string;
  icon_asset_id: string;
  category: string;
  assignment_model: string;
  base_points: number;
  kind: string;
  due_by_local: string | null;
  rrule: string;
  counts_toward_day: number;
}

/** Rewrites membership only when it actually differs. Returns whether it wrote. */
function setRotation(db: Db, choreId: string, members: string[]): boolean {
  const current = (
    db
      .prepare('SELECT child_id FROM chore_rotation_member WHERE chore_id = ? ORDER BY position')
      .all(choreId) as { child_id: string }[]
  ).map((r) => r.child_id);
  if (current.length === members.length && current.every((id, i) => id === members[i])) {
    return false;
  }
  // Membership is not history: the day's assignee is frozen into `chore_assignment` at
  // materialization, and nothing references these rows. Rewriting them changes who is asked
  // TOMORROW and cannot reassign anything already on a board.
  db.prepare('DELETE FROM chore_rotation_member WHERE chore_id = ?').run(choreId);
  const insert = db.prepare(
    'INSERT INTO chore_rotation_member (chore_id, child_id, position) VALUES (?, ?, ?)',
  );
  members.forEach((childId, i) => insert.run(choreId, childId, i + 1));
  return true;
}

function upsertChore(db: Db, c: ChoreSpec): ChoreAction {
  const existing = db
    .prepare(
      `SELECT label_short, label_full, icon_asset_id, category, assignment_model,
              base_points, kind, due_by_local, rrule, counts_toward_day
         FROM chore WHERE id = ?`,
    )
    .get(c.id) as ChoreRow | undefined;

  let action: ChoreAction;
  if (existing === undefined) {
    // `active` is set here and nowhere else in this function: a new chore is born active, and
    // an existing one keeps whatever it has. Only `retire` and `restore` move it.
    db.prepare(
      `INSERT INTO chore (id, label_short, label_full, icon_asset_id, category,
                          assignment_model, base_points, kind, due_by_local, rrule, active,
                          counts_toward_day)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      c.id,
      c.labelShort,
      c.labelFull,
      c.iconAssetId,
      c.category,
      c.assignmentModel,
      c.basePoints,
      c.kind,
      c.dueByLocal,
      c.rrule,
      c.countsTowardDay ? 1 : 0,
    );
    action = 'added';
  } else {
    const same =
      existing.label_short === c.labelShort &&
      existing.label_full === c.labelFull &&
      existing.icon_asset_id === c.iconAssetId &&
      existing.category === c.category &&
      existing.assignment_model === c.assignmentModel &&
      existing.base_points === c.basePoints &&
      existing.kind === c.kind &&
      existing.due_by_local === c.dueByLocal &&
      existing.rrule === c.rrule &&
      existing.counts_toward_day === (c.countsTowardDay ? 1 : 0);
    if (same) {
      action = 'unchanged';
    } else {
      db.prepare(
        `UPDATE chore SET label_short = ?, label_full = ?, icon_asset_id = ?, category = ?,
                          assignment_model = ?, base_points = ?, kind = ?, due_by_local = ?,
                          rrule = ?, counts_toward_day = ?
          WHERE id = ?`,
      ).run(
        c.labelShort,
        c.labelFull,
        c.iconAssetId,
        c.category,
        c.assignmentModel,
        c.basePoints,
        c.kind,
        c.dueByLocal,
        c.rrule,
        c.countsTowardDay ? 1 : 0,
        c.id,
      );
      action = 'updated';
    }
  }

  // After the chore row exists — `chore_rotation_member.chore_id` references it.
  // `!== null`, NOT truthiness or a length check: `[]` is a real instruction (clear it), and
  // the version of this line that skipped empty arrays is exactly how a roster survived a file
  // that meant to remove it.
  const rotationChanged = c.rotation !== null && setRotation(db, c.id, c.rotation);
  if (rotationChanged && action === 'unchanged') action = 'updated';
  return action;
}

/**
 * Applies an authoring file. ONE transaction for the whole run — a half-applied chore list is
 * a board that is wrong in a way nobody can see, which is worse than a run that refused.
 *
 * Idempotent by construction: every write is an upsert keyed on the primary key or a
 * conditional `UPDATE ... WHERE active = ?`, so re-running the same file reports `unchanged`
 * and writes nothing. That is what makes it safe to keep the file and re-apply it on every
 * deploy, the same way `migrate()` is safe to call on every boot.
 *
 * Callers MUST have run `parseChoreFile` and `validateChoreAuthoring` first. This function
 * validates nothing; it is the writer.
 */
export function applyChores(db: Db, authoring: ChoreAuthoring): ChoreChange[] {
  return inTransaction(db, () => {
    const before = historyFingerprint(db);
    const changes: ChoreChange[] = [];

    for (const c of authoring.chores) changes.push({ id: c.id, action: upsertChore(db, c) });

    // NEVER a DELETE. A deleted chore orphans the `chore_day`, `chore_assignment` and
    // `ledger_entry` rows that record work a child actually did and was paid for; `active = 0`
    // takes it off the board and leaves every one of them exactly where it is.
    for (const id of authoring.retire) {
      const moved = db.prepare('UPDATE chore SET active = 0 WHERE id = ? AND active = 1').run(id);
      changes.push({ id, action: moved.changes === 1 ? 'retired' : 'already retired' });
    }
    for (const id of authoring.restore) {
      const moved = db.prepare('UPDATE chore SET active = 1 WHERE id = ? AND active = 0').run(id);
      changes.push({ id, action: moved.changes === 1 ? 'restored' : 'already active' });
    }

    const after = historyFingerprint(db);
    if (after !== before) {
      throw new Error(
        `authoring moved recorded history and was rolled back:\n  before  ${before}\n  after   ${after}`,
      );
    }
    return changes;
  });
}

// ---------------------------------------------------------------------------
// The wall's door: one chore, from a request body
// ---------------------------------------------------------------------------

export type CreateChoreResult =
  | { ok: true; choreId: string; changes: ChoreChange[] }
  | { ok: false; errors: string[] };

/**
 * `label_short` is bounded 1..14 by the schema because an overflowing card is unreadable to
 * the child it was written for. The file asks the author for it; the wall does not — a parent
 * at the panel is typing one name on a three-row keyboard, and asking for a second is how a
 * sheet gets abandoned. So it is DERIVED: the whole name when it fits, else as many leading
 * words as fit, else the first fourteen characters of the first word. Counted in code points,
 * which is what SQLite's `length()` counts.
 */
export function shortLabelFor(labelFull: string): string {
  const full = [...labelFull];
  if (full.length <= 14) return labelFull;
  let out = '';
  for (const word of labelFull.split(' ')) {
    const next = out.length === 0 ? word : `${out} ${word}`;
    if ([...next].length > 14) break;
    out = next;
  }
  return out.length > 0 ? out : full.slice(0, 14).join('');
}

/**
 * `ch-` plus the name in lowercase ascii, and a counter when that id is taken. A retired chore
 * keeps its id forever (its ledger rows point at it), so "Feed the pet" made twice is
 * `ch-feed-the-pet` and `ch-feed-the-pet-2` — never a reuse.
 */
export function choreIdFor(db: Db, labelFull: string): string {
  const slug =
    labelFull
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/g, '') || 'chore';
  const taken = db.prepare('SELECT 1 FROM chore WHERE id = ?');
  const base = `ch-${slug}`;
  if (taken.get(base) === undefined) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${String(n)}`;
    if (taken.get(candidate) === undefined) return candidate;
  }
}

/**
 * Creates one chore from what the wall's sheet sends, through EXACTLY the file path: the body
 * becomes a `ChoreSpec` entry, `parseSpec` checks its fields, `validateChoreAuthoring` checks
 * its references, `applyChores` writes it under the history guard. Nothing here is a second
 * opinion on what a valid chore is.
 *
 * Two things the file does not do for its author are done here for the panel's: the name is
 * trimmed and its inner runs of spaces collapsed (a space bar on a touch keyboard gets tapped
 * twice), and `labelShort`, `id` and `category` are derived — category from the icon chosen,
 * because that is what category is for (the fallback chain in `resolveAsset`).
 *
 * `roster` is required and non-empty: a chore nobody is on is "everyone" to `roster()`, and a
 * sheet opened from one child's list starts the chore with that child.
 */
export function createChore(db: Db, body: unknown): CreateChoreResult {
  if (!isObject(body)) return { ok: false, errors: ['chore: must be an object'] };
  const o = body;
  const rawName = o['labelFull'];
  const labelFull = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : rawName;
  const iconAssetId = o['iconAssetId'];
  const category =
    typeof iconAssetId === 'string'
      ? ((db.prepare('SELECT category FROM asset WHERE id = ?').get(iconAssetId) as
          | { category: string }
          | undefined)?.category ?? 'chore')
      : 'chore';

  const entry: Record<string, unknown> = {
    id: typeof labelFull === 'string' ? choreIdFor(db, labelFull) : 'ch-new',
    labelShort: typeof labelFull === 'string' ? shortLabelFor(labelFull) : labelFull,
    labelFull,
    iconAssetId,
    category,
    assignmentModel: o['assignmentModel'],
    basePoints: o['basePoints'],
    kind: o['kind'],
    rrule: o['rrule'],
    dueByLocal: o['dueByLocal'] ?? null,
    rotation: o['roster'],
  };

  const errors: string[] = [];
  const spec = parseSpec(entry, 'chore', errors);
  /*
   * THE WALL AND THE FILE ARE DIFFERENT DOORS AND THEY DO NOT SHARE THIS RULE.
   *
   * From the file, `"rotation": []` means EVERYONE and is a deliberate authoring act (see
   * `parseSpec`). From the wall it is a mis-tap: `setChoreMember` already refuses
   * `roster_empty` for exactly this, because "take the last child off" reads as removing a
   * chore and would silently hand it to all three. A new chore with nobody on it is the same
   * mistake made a different way.
   *
   * So BOTH the absent case and the empty case are refused here, with the sheet's own words,
   * and only here — the parser stays permissive because the file needs the third state.
   */
  const rosterGiven = entry['rotation'];
  if (
    rosterGiven === undefined ||
    rosterGiven === null ||
    (Array.isArray(rosterGiven) && rosterGiven.length === 0)
  ) {
    errors.push('chore: a chore needs at least one child');
  }
  if (spec === null || errors.length > 0) return { ok: false, errors };
  const authoring: ChoreAuthoring = { chores: [spec], retire: [], restore: [] };
  const invalid = validateChoreAuthoring(db, authoring);
  if (invalid.length > 0) return { ok: false, errors: invalid };
  const changes = applyChores(db, authoring);
  return { ok: true, choreId: spec.id, changes };
}

// ---------------------------------------------------------------------------
// The wall's other doors: change what a chore is called, wears and when it comes; retire it
// ---------------------------------------------------------------------------

/** What the Edit sheet may change. Worth, sharing and roster each have their own route already. */
const EDITABLE_KEYS = new Set(['labelFull', 'iconAssetId', 'rrule']);

export type ChoreEditOutcome =
  | { ok: true; choreId: string; changed: boolean }
  | { ok: false; missing: true }
  | { ok: false; missing: false; errors: string[] };

interface ExistingChore extends ChoreRow {
  active: number;
}

function existingChore(db: Db, choreId: string): ExistingChore | undefined {
  return db
    .prepare(
      `SELECT label_short, label_full, icon_asset_id, category, assignment_model,
              base_points, kind, due_by_local, rrule, active
         FROM chore WHERE id = ?`,
    )
    .get(choreId) as ExistingChore | undefined;
}

/**
 * Changes a chore's NAME, PICTURE or DAYS from the wall, through the same parser, checks and
 * writer as `createChore` — the body is folded over the chore as it stands, so a field not sent
 * is a field not touched, and the roster is never part of it (`rotation: null`).
 *
 * Three derivations follow the create path, and only for what changed: a new name derives a new
 * `labelShort` (an unchanged name keeps the file's hand-written one), a new picture derives the
 * category, and the id never moves — ledger rows point at it.
 *
 * WHEN EACH REACHES THE BOARD is the materializer's rule, not this function's: a name and a
 * picture are read live off `chore`, so they show today; the days are read when a day is BUILT,
 * so today's already-built day stands and the new days start tomorrow — the same as a model.
 *
 * A retired chore is not editable here: it is on nobody's board, and the wall's list does not
 * show one to edit.
 */
export function editChore(db: Db, choreId: string, body: unknown): ChoreEditOutcome {
  const existing = existingChore(db, choreId);
  if (existing === undefined || existing.active !== 1) return { ok: false, missing: true };
  if (!isObject(body)) return { ok: false, missing: false, errors: ['chore: must be an object'] };
  const errors: string[] = [];
  const keys = Object.keys(body);
  for (const key of keys) {
    if (!EDITABLE_KEYS.has(key)) errors.push(`chore: "${key}" cannot be changed here`);
  }
  if (keys.length === 0) errors.push('chore: nothing to change');
  if (errors.length > 0) return { ok: false, missing: false, errors };

  const rawName = body['labelFull'];
  const labelFull =
    rawName === undefined
      ? existing.label_full
      : typeof rawName === 'string'
        ? rawName.trim().replace(/\s+/g, ' ')
        : rawName;
  const renamed = labelFull !== existing.label_full;
  const iconAssetId = body['iconAssetId'] ?? existing.icon_asset_id;
  const repictured = iconAssetId !== existing.icon_asset_id;
  const category =
    repictured && typeof iconAssetId === 'string'
      ? ((db.prepare('SELECT category FROM asset WHERE id = ?').get(iconAssetId) as
          | { category: string }
          | undefined)?.category ?? existing.category)
      : existing.category;

  const entry: Record<string, unknown> = {
    id: choreId,
    labelShort: renamed && typeof labelFull === 'string' ? shortLabelFor(labelFull) : existing.label_short,
    labelFull,
    iconAssetId,
    category,
    assignmentModel: existing.assignment_model,
    basePoints: existing.base_points,
    kind: existing.kind,
    rrule: body['rrule'] ?? existing.rrule,
    dueByLocal: existing.due_by_local,
    rotation: null,
  };
  const spec = parseSpec(entry, 'chore', errors);
  if (spec === null || errors.length > 0) return { ok: false, missing: false, errors };
  const authoring: ChoreAuthoring = { chores: [spec], retire: [], restore: [] };
  const invalid = validateChoreAuthoring(db, authoring);
  if (invalid.length > 0) return { ok: false, missing: false, errors: invalid };
  const [change] = applyChores(db, authoring);
  return { ok: true, choreId, changed: change?.action !== 'unchanged' };
}

export type ChoreRetireOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'unknown_chore' }
  | { ok: false; reason: 'claims_waiting'; waiting: number };

/** Claims on this chore no grown-up has looked at yet, on any day. */
function waitingClaims(db: Db, choreId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM chore_assignment a
           JOIN chore_day d ON d.id = a.chore_day_id
          WHERE d.chore_id = ? AND a.state = 'claimed'`,
      )
      .get(choreId) as { n: number }
  ).n;
}

/**
 * Takes a chore off every board, softly: `active = 0` through `applyChores`'s retire, which is
 * never a DELETE and runs under the history guard. Every day, claim and ledger row it ever made
 * stays where it is, and `restoreChore` puts it back.
 *
 * REFUSED while a claim on it is still waiting. The file path only WARNS about that
 * (`choreAuthoringWarnings`), because a person running it reads the warning; on the wall the
 * claim would simply vanish from the board unapproved, and a child's done work would go unpaid
 * with nothing on any screen to say so. Approve or send it back first — the refusal says how many.
 */
export function retireChore(db: Db, choreId: string): ChoreRetireOutcome {
  const existing = existingChore(db, choreId);
  if (existing === undefined) return { ok: false, reason: 'unknown_chore' };
  if (existing.active === 0) return { ok: true, changed: false };
  const waiting = waitingClaims(db, choreId);
  if (waiting > 0) return { ok: false, reason: 'claims_waiting', waiting };
  const [change] = applyChores(db, { chores: [], retire: [choreId], restore: [] });
  return { ok: true, changed: change?.action === 'retired' };
}

/** Puts a retired chore back on the boards from the next day built. Idempotent. */
export function restoreChore(db: Db, choreId: string): ChoreRetireOutcome {
  if (existingChore(db, choreId) === undefined) return { ok: false, reason: 'unknown_chore' };
  const [change] = applyChores(db, { chores: [], retire: [], restore: [choreId] });
  return { ok: true, changed: change?.action === 'restored' };
}
