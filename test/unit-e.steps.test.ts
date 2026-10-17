/**
 * Unit E — step transitions, and the second half of the acceptance criterion: "a partially
 * completed run resumes correctly".
 *
 * What is being defended:
 *   - a tap 1cm off lands on a sibling's card and must change nothing, silently;
 *   - a three-year-old's undo must work without an adult, and must not destroy history;
 *   - the process restarting mid-routine must not cost a child the steps she already did.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import {
  completeStep,
  progressOf,
  progressForRun,
  revokeStep,
  todaysRoutines,
} from '../src/domain/routines/index.ts';
import type { Database as Db } from 'better-sqlite3';
import type { LocalDate, RoutineRunView } from '../src/types.ts';

const TUESDAY = '2026-09-01' as LocalDate;

function fresh(path = ':memory:') {
  const db = openDatabase({ path });
  migrate(db);
  seedDev(db);
  return db;
}

/** child-a's morning is 4 steps in the fixture; the resume case needs 5. */
function addFifthStep(db: Db): void {
  db.prepare(
    `INSERT INTO routine_step VALUES ('st-lunch','rt-morning','Lunch','Pack your lunch','ico-bag','school',1)`,
  ).run();
  db.prepare(`INSERT INTO routine_step_assignment VALUES ('rt-morning','child-a','st-lunch',5)`).run();
}

function morningFor(db: Db, childId: string, date: LocalDate = TUESDAY): RoutineRunView {
  const hit = todaysRoutines(db, date).find(
    (v) => v.routineId === 'rt-morning' && v.childId === childId,
  );
  assert.ok(hit, `expected a morning routine for ${childId}`);
  return hit;
}

function liveCompletions(db: Db, runStepId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM routine_step_completion
        WHERE run_step_id = ? AND revoked_at_utc IS NULL`,
    )
    .get(runStepId) as { n: number };
  return row.n;
}

test('completing a step is idempotent and does not rewrite when the child did it', () => {
  const db = fresh();
  const step = morningFor(db, 'child-c').steps[0];
  assert.ok(step);

  const first = completeStep(db, { runStepId: step.runStepId, childId: 'child-c' });
  if (!first.ok) assert.fail(`refused: ${first.reason}`);
  assert.equal(first.unchanged, false);
  assert.deepEqual(first.progress, { runId: first.progress.runId, childId: 'child-c', done: 1, total: 2, complete: false });

  const second = completeStep(db, { runStepId: step.runStepId, childId: 'child-c' });
  if (!second.ok) assert.fail(`refused: ${second.reason}`);
  assert.equal(second.unchanged, true, 'a double tap is a success, not an error');
  assert.equal(
    second.completedAtUtc,
    first.completedAtUtc,
    'and it returns the ORIGINAL timestamp',
  );
  assert.equal(liveCompletions(db, step.runStepId), 1);
  db.close();
});

test('a mismatched childId is a silent no-op on both complete and revoke', () => {
  const db = fresh();
  const sibling = morningFor(db, 'child-a').steps[0];
  assert.ok(sibling);

  // The pre-reader taps a centimetre off and hits her sister's card.
  const misTap = completeStep(db, { runStepId: sibling.runStepId, childId: 'child-c' });
  assert.equal(misTap.ok, false);
  assert.equal(misTap.ok === false ? misTap.reason : null, 'wrong_child');
  assert.equal(liveCompletions(db, sibling.runStepId), 0, 'nothing was written');

  // Now the owner completes it, and the mis-tap tries to undo it.
  const owned = completeStep(db, { runStepId: sibling.runStepId, childId: 'child-a' });
  assert.equal(owned.ok, true);
  const misRevoke = revokeStep(db, { runStepId: sibling.runStepId, childId: 'child-c' });
  assert.equal(misRevoke.ok, false);
  assert.equal(misRevoke.ok === false ? misRevoke.reason : null, 'wrong_child');
  assert.equal(liveCompletions(db, sibling.runStepId), 1, "a sibling cannot un-do your step");

  // The view still shows it done for its owner and untouched for everyone else.
  const after = morningFor(db, 'child-a');
  assert.ok(after.steps[0]?.completedAtUtc);
  assert.equal(morningFor(db, 'child-c').steps.every((s) => s.completedAtUtc === null), true);
  db.close();
});

test('an unknown run step is refused, not thrown', () => {
  const db = fresh();
  todaysRoutines(db, TUESDAY);
  const missing = completeStep(db, { runStepId: 999_999, childId: 'child-a' });
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false ? missing.reason : null, 'unknown_step');
  const missingRevoke = revokeStep(db, { runStepId: 999_999, childId: 'child-a' });
  assert.equal(missingRevoke.ok === false ? missingRevoke.reason : null, 'unknown_step');
  db.close();
});

test('revoke is child-accessible, soft, and re-completable — history keeps both rows', () => {
  const db = fresh();
  const step = morningFor(db, 'child-c').steps[1];
  assert.ok(step);

  const done = completeStep(db, { runStepId: step.runStepId, childId: 'child-c' });
  if (!done.ok) assert.fail(`refused: ${done.reason}`);

  // No PIN, no adult: the child undoes it herself.
  const undone = revokeStep(db, { runStepId: step.runStepId, childId: 'child-c' });
  if (!undone.ok) assert.fail(`refused: ${undone.reason}`);
  assert.equal(undone.unchanged, false);
  assert.ok(undone.revokedAtUtc);
  assert.equal(undone.progress.done, 0);
  assert.equal(liveCompletions(db, step.runStepId), 0);
  assert.equal(morningFor(db, 'child-c').steps[1]?.completedAtUtc, null);

  // The partial unique index permits the re-completion.
  const again = completeStep(db, { runStepId: step.runStepId, childId: 'child-c' });
  if (!again.ok) assert.fail(`refused: ${again.reason}`);
  assert.equal(again.unchanged, false);
  assert.equal(liveCompletions(db, step.runStepId), 1);

  const history = db
    .prepare(
      `SELECT id, revoked_at_utc FROM routine_step_completion
        WHERE run_step_id = ? ORDER BY id`,
    )
    .all(step.runStepId) as { id: number; revoked_at_utc: string | null }[];
  assert.equal(history.length, 2, 'un-completion is a revoke, never a DELETE');
  assert.ok(history[0]?.revoked_at_utc, 'the first attempt is stamped, not erased');
  assert.equal(history[1]?.revoked_at_utc, null, 'and exactly one row is live');
  db.close();
});

test('revoking a step that was never completed is a no-op success', () => {
  const db = fresh();
  const step = morningFor(db, 'child-b').steps[2];
  assert.ok(step);

  const undone = revokeStep(db, { runStepId: step.runStepId, childId: 'child-b' });
  if (!undone.ok) assert.fail(`refused: ${undone.reason}`);
  assert.equal(undone.unchanged, true);
  assert.equal(undone.revokedAtUtc, null);
  assert.equal(undone.progress.done, 0);

  // A second undo tap must not throw an error onto a wall with no adult in front of it.
  const twice = revokeStep(db, { runStepId: step.runStepId, childId: 'child-b' });
  assert.equal(twice.ok, true);
  db.close();
});

test('progress counts live completions only, per child per run', () => {
  const db = fresh();
  const fluent = morningFor(db, 'child-a');
  assert.equal(progressOf(fluent).total, 4);

  for (const s of fluent.steps.slice(0, 3)) {
    const r = completeStep(db, { runStepId: s.runStepId, childId: 'child-a' });
    assert.equal(r.ok, true);
  }
  assert.deepEqual(progressOf(morningFor(db, 'child-a')), {
    runId: fluent.runId,
    childId: 'child-a',
    done: 3,
    total: 4,
    complete: false,
  });

  // A sibling on the SAME run is unaffected.
  assert.deepEqual(progressForRun(db, fluent.runId, 'child-c'), {
    runId: fluent.runId,
    childId: 'child-c',
    done: 0,
    total: 2,
    complete: false,
  });

  const last = fluent.steps[3];
  assert.ok(last);
  const final = completeStep(db, { runStepId: last.runStepId, childId: 'child-a' });
  if (!final.ok) assert.fail(`refused: ${final.reason}`);
  assert.equal(final.progress.complete, true);

  // A revoke takes it straight back out of "complete".
  const undo = revokeStep(db, { runStepId: last.runStepId, childId: 'child-a' });
  if (!undo.ok) assert.fail(`refused: ${undo.reason}`);
  assert.equal(undo.progress.complete, false);
  assert.equal(undo.progress.done, 3);
  db.close();
});

test('the pre-reader can drive her routine to completion with no adult and no text', () => {
  const db = fresh();
  const her = morningFor(db, 'child-c');
  assert.equal(her.steps.length, 2);
  assert.ok(her.steps.every((s) => s.icon.url.length > 0), 'every step is a picture');

  for (const s of her.steps) {
    const r = completeStep(db, { runStepId: s.runStepId, childId: 'child-c' });
    assert.equal(r.ok, true);
  }
  assert.equal(progressOf(morningFor(db, 'child-c')).complete, true);
  db.close();
});

test('a partially completed run resumes across a process restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-unit-e-resume-'));
  const path = join(dir, 'wall.db');
  try {
    // --- process 1: the child gets three of five steps done, out of order ---
    const first = fresh(path);
    addFifthStep(first);
    const before = morningFor(first, 'child-a');
    assert.equal(before.steps.length, 5);

    const chosen = [0, 1, 3].map((i) => {
      const s = before.steps[i];
      assert.ok(s);
      return s;
    });
    for (const s of chosen) {
      const r = completeStep(first, { runStepId: s.runStepId, childId: 'child-a' });
      assert.equal(r.ok, true);
    }
    const doneLabels = chosen.map((s) => s.labelShort);
    const runIdBefore = before.runId;
    const progressBefore = progressOf(morningFor(first, 'child-a'));
    assert.deepEqual(
      { done: progressBefore.done, total: progressBefore.total },
      { done: 3, total: 5 },
    );
    first.close(); // the app is restarted, the container is redeployed, the Pi reboots

    // --- process 2: a brand new connection to the same file ---
    const second = openDatabase({ path });
    const after = morningFor(second, 'child-a');

    assert.equal(after.runId, runIdBefore, 'the same run, not a fresh one');
    const runCount = second
      .prepare(`SELECT COUNT(*) AS n FROM routine_run WHERE routine_id='rt-morning'`)
      .get() as { n: number };
    assert.equal(runCount.n, 1, 'the re-read materialized nothing new');
    assert.deepEqual(
      after.steps.filter((s) => s.completedAtUtc !== null).map((s) => s.labelShort),
      doneLabels,
      'exactly the three she did — not the first three, and not a count',
    );
    assert.deepEqual(
      after.steps.map((s) => s.position),
      [1, 2, 3, 4, 5],
      'and the rest of the sequence is intact and in order',
    );
    assert.deepEqual(progressOf(after), {
      runId: runIdBefore,
      childId: 'child-a',
      done: 3,
      total: 5,
      complete: false,
    });

    // She finishes it after the restart.
    for (const s of after.steps.filter((x) => x.completedAtUtc === null)) {
      const r = completeStep(second, { runStepId: s.runStepId, childId: 'child-a' });
      assert.equal(r.ok, true);
    }
    assert.equal(progressOf(morningFor(second, 'child-a')).complete, true);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
