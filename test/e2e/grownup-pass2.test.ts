/**
 * The grown-up screens' second pass, over the wire: a chore edited, retired and restored, and
 * the PIN changed. Every one is driven through the real server with the real PIN guard, because
 * the failure this project keeps shipping is a door that answers 200 and does nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocalDate } from '../../src/types.ts';
import {
  admin,
  adminWithoutPin,
  CHILD_FLUENT,
  choreCard,
  PARENT_PIN,
  snapshot,
  startWall,
  wall,
} from './harness.ts';

const SCHOOL_MORNING = '2026-09-15T13:00:00Z';
const SCHOOL_DAY = '2026-09-15' as LocalDate;

interface CatalogChore {
  id: string;
  labelFull: string;
  rrule: string;
  active: boolean;
}
const chores = (body: Record<string, unknown>) => body['chores'] as CatalogChore[];

test('edit: the name shows on today’s card, the days answer in the catalog, the worth door is separate', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    await snapshot(h, SCHOOL_DAY); // builds today (a Tuesday) before the edit, as the wall would have
    const res = await admin(h, 'POST', '/api/admin/v1/chores/ch-pet/edit', PARENT_PIN, {
      body: { labelFull: 'Feed the dog', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
    });
    assert.equal(res.status, 200, res.text);
    const pet = chores(res.body).find((c) => c.id === 'ch-pet');
    assert.equal(pet?.labelFull, 'Feed the dog');
    assert.equal(pet?.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE,FR');
    // Today was already built, so the new days (no Tuesday) leave its card standing — and the
    // name is read live, so the card says it now.
    const snap = await snapshot(h, SCHOOL_DAY);
    assert.equal(choreCard(snap, CHILD_FLUENT, 'ch-pet').labelFull, 'Feed the dog');

    const worth = await admin(h, 'POST', '/api/admin/v1/chores/ch-pet/edit', PARENT_PIN, {
      body: { basePoints: 50 },
    });
    assert.equal(worth.status, 400);
    assert.equal(worth.body['error'], 'bad_request');

    const missing = await admin(h, 'POST', '/api/admin/v1/chores/ch-nope/edit', PARENT_PIN, {
      body: { labelFull: 'x' },
    });
    assert.equal(missing.status, 404);

    const noPin = await adminWithoutPin(h, 'POST', '/api/admin/v1/chores/ch-pet/edit', {
      body: { labelFull: 'Sneaky' },
    });
    assert.equal(noPin.status, 401);
  } finally {
    await h.stop();
  }
});

test('retire: refused while a claim waits, soft when it goes, and restore brings it back', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = choreCard(snap, CHILD_FLUENT, 'ch-pet');
    const claim = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(claim.status, 200, claim.text);

    const refused = await admin(h, 'POST', '/api/admin/v1/chores/ch-pet/retire', PARENT_PIN);
    assert.equal(refused.status, 409);
    assert.equal(refused.body['error'], 'not_claimable');

    const approved = await admin(h, 'POST', `/api/admin/v1/chores/${card.assignmentId}/approve`, PARENT_PIN);
    assert.equal(approved.status, 200, approved.text);

    const rows = (sql: string) => (h.db.prepare(sql).get() as { n: number }).n;
    const ledgerBefore = rows('SELECT COUNT(*) AS n FROM ledger_entry');
    const daysBefore = rows('SELECT COUNT(*) AS n FROM chore_day');

    const retired = await admin(h, 'POST', '/api/admin/v1/chores/ch-pet/retire', PARENT_PIN);
    assert.equal(retired.status, 200, retired.text);
    assert.equal(chores(retired.body).find((c) => c.id === 'ch-pet')?.active, false);
    assert.equal(rows('SELECT COUNT(*) AS n FROM ledger_entry'), ledgerBefore, 'history stays');
    assert.equal(rows('SELECT COUNT(*) AS n FROM chore_day'), daysBefore, 'history stays');
    const gone = await snapshot(h, SCHOOL_DAY);
    assert.equal(gone.chores.some((c) => c.choreId === 'ch-pet'), false, 'off today’s board');

    const restored = await admin(h, 'POST', '/api/admin/v1/chores/ch-pet/restore', PARENT_PIN);
    assert.equal(restored.status, 200, restored.text);
    assert.equal(chores(restored.body).find((c) => c.id === 'ch-pet')?.active, true);

    assert.equal((await admin(h, 'POST', '/api/admin/v1/chores/ch-nope/retire', PARENT_PIN)).status, 404);
    assert.equal((await admin(h, 'POST', '/api/admin/v1/chores/ch-nope/restore', PARENT_PIN)).status, 404);
  } finally {
    await h.stop();
  }
});

test('PIN change: authorised by the CURRENT PIN, and after it only the new one opens anything', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const wrong = await admin(h, 'POST', '/api/admin/v1/settings/pin', '0000', {
      body: { newPin: '2468' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body['error'], 'bad_pin');

    for (const newPin of ['12', '12ab', '1234567890123', 1234]) {
      const bad = await admin(h, 'POST', '/api/admin/v1/settings/pin', PARENT_PIN, { body: { newPin } });
      assert.equal(bad.status, 400, `accepted ${String(newPin)}`);
    }
    // Still the old PIN: nothing above wrote.
    assert.equal((await admin(h, 'GET', '/api/admin/v1/settings', PARENT_PIN)).status, 200);

    const changed = await admin(h, 'POST', '/api/admin/v1/settings/pin', PARENT_PIN, {
      body: { newPin: '2468' },
    });
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.text.includes('2468'), false, 'the answer never echoes the PIN');
    assert.equal((await admin(h, 'GET', '/api/admin/v1/settings', PARENT_PIN)).status, 401);
    assert.equal((await admin(h, 'GET', '/api/admin/v1/settings', '2468')).status, 200);
    const stored = h.db
      .prepare(`SELECT value_text FROM household_config WHERE key = 'parent_pin_scrypt'`)
      .get() as { value_text: string };
    assert.match(stored.value_text, /^scrypt\$/);
    assert.equal(stored.value_text.includes('2468'), false);
  } finally {
    await h.stop();
  }
});
