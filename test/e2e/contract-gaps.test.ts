/**
 * Unit J — gaps found at the seams, recorded rather than repaired.
 *
 * Every test in this file asserts what `docs/api.md` and the frozen types PROMISE, and every
 * one of them currently fails. They are marked `todo`, which means node's runner executes
 * them, reports them as known-failing, and does not turn the suite red. That is deliberate:
 *
 *   - deleting them would let a green suite imply a working wall,
 *   - inverting them to assert today's behaviour would freeze the defect into the contract,
 *   - fixing them from inside the e2e suite would mean editing files this unit does not own,
 *     which is how a cross-unit fix quietly makes a green suite lie.
 *
 * When the owning unit closes one, the test goes green and the `todo` marker comes off.
 *
 * Each of these is invisible to a unit test. Both units on either side of the seam are green
 * against their own contract; it is only the assembled system that renders a grey placeholder.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocalDate } from '../../src/types.ts';
import { snapshot, startWall, wall } from './harness.ts';

const SCHOOL_MORNING = '2026-09-15T13:00:00Z';
const SCHOOL_DAY = '2026-09-15' as LocalDate;

// ---------------------------------------------------------------------------
// GAP 1 — nothing serves an asset.
//
// `docs/api.md` §Assets and its 2026-08-24 amendment specify `GET /assets/:assetId`, with
// the rule that an unvalidated asset is a 404 "never a placeholder". No route matching that
// path exists in `src/http/` (the surface is 8 wall + 8 admin + /api/health), so every
// request falls through the router to `404 not_found`.
//
// `web/src/views/logic/summary.ts:158` builds `/assets/<id>` for EVERY child avatar, which
// `ChildBar` and `AmbientView` render. Unit H's `AssetImage` degrades to a grey "unknown"
// glyph rather than a hole, so the wall is not blank — but all three children get the SAME
// placeholder, and the avatar is one of the channels the pre-reader uses to find her column.
// ---------------------------------------------------------------------------

test(
  'GAP 1a — a validated avatar asset is served by GET /assets/:assetId',
  { todo: 'docs/api.md specifies GET /assets/:assetId; no such route exists in src/http/ — every avatar 404s' },
  async () => {
    const h = await startWall({ clock: SCHOOL_MORNING });
    try {
      const snap = await snapshot(h, SCHOOL_DAY);
      const child = snap.children[0];
      assert.ok(child);
      assert.ok(child.avatarAssetId.length > 0, 'the fixture child has an avatar');

      const res = await fetch(`${h.base}/assets/${encodeURIComponent(child.avatarAssetId)}`, {
        headers: { Authorization: `Device ${h.token}` },
      });
      assert.notEqual(res.status, 404, 'a VALIDATED asset must not 404 — that rule is for unvalidated ones');
      assert.equal(res.status, 200);
      assert.ok((res.headers.get('content-type') ?? '').length > 0);
    } finally {
      await h.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// GAP 2 — `AssetRef.url` points nowhere.
//
// `db/schema.sql` documents `asset.rel_path` as "relative to the served asset root", and
// `resolveAsset` puts that bare path straight into `AssetRef.url` ("icons/dress.svg").
// api.md says `AssetRef.url` "is already resolved through the fallback chain and is safe to
// use directly". Nothing serves an asset root: no route, no static mount, no configuration
// naming one, and no asset files exist in the repo at all.
//
// The result on the assembled wall is that EVERY icon — every routine step, every chore card,
// every countdown — is a broken image, for all three children. For the pre-reader the icon is
// the entire interface, which is the failure H2 gap #1 and the whole fallback chain exist to
// prevent. The chain resolves correctly; the bytes are simply unreachable.
//
// Note the two paths do not even agree on a SHAPE: `avatarRef` emits an absolute
// `/assets/<id>` while `resolveAsset` emits a relative `icons/<file>.svg`. Whoever closes
// this owns reconciling them.
// ---------------------------------------------------------------------------

test(
  'GAP 2 — every AssetRef.url in a snapshot is fetchable from the running server',
  { todo: 'no route or static mount serves `asset.rel_path`; every icon on the wall is a broken image' },
  async () => {
    const h = await startWall({ clock: SCHOOL_MORNING });
    try {
      const snap = await snapshot(h, SCHOOL_DAY);
      const urls = new Set<string>();
      for (const run of snap.routines) {
        urls.add(run.icon.url);
        for (const step of run.steps) urls.add(step.icon.url);
      }
      for (const card of snap.chores) urls.add(card.icon.url);
      for (const c of snap.countdowns) urls.add(c.icon.url);
      assert.ok(urls.size > 0);

      const broken: string[] = [];
      for (const url of urls) {
        assert.ok(url.length > 0, 'the fallback chain guarantees a non-empty url');
        // Resolved the way a browser resolves it: against the page origin.
        const res = await fetch(new URL(url, `${h.base}/`), {
          headers: { Authorization: `Device ${h.token}` },
        });
        if (!res.ok) broken.push(`${url} -> ${res.status}`);
        await res.arrayBuffer();
      }
      assert.deepEqual(broken, [], 'these icons resolve but cannot be loaded');
    } finally {
      await h.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// GAP 3 — the wall surface emits an error code outside the frozen table.
//
// `src/http/protocol.ts` documents `bad_request` as reachable only from the ADMIN surface:
// "Never emitted on the wall surface: there, a missing `childId` is `wrong_child` and a
// malformed row id is `not_claimable`, both of which are in the frozen table and both of
// which fail safe." Two wall paths emit it anyway:
//
//   GET  /api/wall/v1/redemptions?state=<anything but pending>   (routes.wall.ts)
//   any wall POST with a body over 64 KiB                        (router.ts readJsonBody)
//
// `400 bad_request` is not in api.md's error table, so the wall client has no branch for it
// and falls through to its generic handler. Low impact — the kiosk sends neither — but it is
// the frozen table being widened by implementation rather than by amendment, which is the
// thing the freeze exists to prevent.
// ---------------------------------------------------------------------------

test(
  'GAP 3 — the wall surface only ever answers with codes from the frozen error table',
  { todo: 'routes.wall.ts and router.ts emit 400 bad_request on the wall surface; protocol.ts says they never do' },
  async () => {
    const h = await startWall({ clock: SCHOOL_MORNING });
    const FROZEN = new Set([
      'bad_pin',
      'device_revoked',
      'not_claimable',
      'already_claimed',
      'insufficient_points',
      'pending_redemption_exists',
      'stale_client',
      'date_mismatch',
      'wrong_child',
      'unavailable',
      'not_found',
    ]);
    try {
      const offenders: string[] = [];

      const filtered = await wall(h, 'GET', '/api/wall/v1/redemptions?state=approved');
      if (!FROZEN.has(String(filtered.body['error']))) {
        offenders.push(`GET /redemptions?state=approved -> ${String(filtered.body['error'])}`);
      }

      const oversized = await wall(h, 'POST', '/api/wall/v1/chores/1/claim', {
        body: { childId: 'child-a', pad: 'x'.repeat(70_000) },
      });
      if (!FROZEN.has(String(oversized.body['error']))) {
        offenders.push(`POST /chores/1/claim (oversized) -> ${String(oversized.body['error'])}`);
      }

      assert.deepEqual(offenders, []);
    } finally {
      await h.stop();
    }
  },
);

// ---------------------------------------------------------------------------
// What IS true, pinned so the gaps above stay precisely bounded.
//
// The resolution half of the asset contract works end to end. Only the serving half is
// missing, and this test is what keeps a future "fix" from being a regression in the chain.
// ---------------------------------------------------------------------------

test('the fallback chain itself resolves end to end, for every icon on the wall', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const refs = [
      ...snap.routines.map((r) => r.icon),
      ...snap.routines.flatMap((r) => r.steps.map((s) => s.icon)),
      ...snap.chores.map((c) => c.icon),
      ...snap.countdowns.map((c) => c.icon),
    ];
    assert.ok(refs.length > 0);
    for (const ref of refs) {
      assert.ok(ref.url.length > 0, 'a resolved AssetRef is never empty — a hole IS a blank screen');
      assert.ok(ref.assetId.length > 0);
      assert.equal(typeof ref.isFallback, 'boolean', 'authoring gaps stay visible to adults');
    }
  } finally {
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// GAP 4 is not testable over HTTP and is recorded in the unit report instead:
// `CountdownView.childId` — added by the 2026-08-24 amendment precisely so that a birthday
// scoped to one child stops rendering as everyone's — is shipped correctly by the server
// (asserted in acceptance-walk.test.ts) and is read by NO renderer. `CountdownPanel` drops
// the field and is mounted only in `AmbientView`. Asserting that needs the .tsx to render,
// which node's type-stripping cannot do; Unit H's own suite greps source instead.
// ---------------------------------------------------------------------------
