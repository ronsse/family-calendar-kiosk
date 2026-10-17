/**
 * Unit F — HTTP. The two credentials, and why they are two.
 *
 * `/api/wall/*` proves it is THE WALL with a per-device token issued at provisioning and
 * stored hashed. Never an IP allowlist (PRD §4, H3 finding #3): a renewed DHCP lease 403s
 * every read while the kiosk's screenshot fallback makes the wall look fine, and the
 * released address is handed to a guest phone, which is then trusted.
 *
 * `/api/admin/*` additionally requires a PIN ON EVERY REQUEST, never a session. Children and
 * guests touch this screen; a session cookie is an approval button left unlocked for whoever
 * walks past next.
 *
 * `401 bad_pin` and `403 device_revoked` are kept distinct so the wall can render "ask a
 * grown-up" for the first and the offline card — never a login form — for the second.
 */

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Database as Db } from 'better-sqlite3';
import { nowUtc } from '../time.ts';
import { ApiError } from './protocol.ts';

// ---------------------------------------------------------------------------
// Device tokens
// ---------------------------------------------------------------------------

export interface DeviceIdentity {
  id: string;
  label: string;
}

export interface IssuedDevice {
  id: string;
  label: string;
  /** The ONLY time the plaintext token exists. It is not recoverable afterwards. */
  token: string;
}

/**
 * SHA-256, not a KDF, and deliberately so.
 *
 * A device token is 256 bits of `randomBytes`, not a human secret — there is no dictionary
 * to attack and no rate at which guessing helps, so the work factor a KDF buys protects
 * nothing. What matters is that the plaintext is never at rest, and that lookup is a single
 * indexed equality on the digest rather than a scan of candidates.
 */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Provisioning. Returns the plaintext ONCE; only the hash is stored.
 *
 * Exported as a function rather than reachable only through `POST /api/admin/v1/devices`
 * because that route needs a device token to call, and the first device has none. The kiosk
 * setup script calls this out of band; the route exists for every device after it.
 */
export function issueDeviceToken(db: Db, label: string): IssuedDevice {
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new ApiError('bad_request', 'a device needs a label');
  }
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO device_token (id, label, token_hash, issued_at_utc) VALUES (?, ?, ?, ?)`,
  ).run(id, label.trim(), hashDeviceToken(token), nowUtc());
  return { id, label: label.trim(), token };
}

/** Revocation is a stamp, never a DELETE: an audit of what was ever trusted must survive. */
export function revokeDevice(db: Db, id: string): boolean {
  const info = db
    .prepare(
      `UPDATE device_token SET revoked_at_utc = ? WHERE id = ? AND revoked_at_utc IS NULL`,
    )
    .run(nowUtc(), id);
  return info.changes === 1;
}

export function listDevices(db: Db): { id: string; label: string; revoked: boolean }[] {
  const rows = db
    .prepare(`SELECT id, label, revoked_at_utc FROM device_token ORDER BY issued_at_utc`)
    .all() as { id: string; label: string; revoked_at_utc: string | null }[];
  return rows.map((r) => ({ id: r.id, label: r.label, revoked: r.revoked_at_utc !== null }));
}

const AUTH_SCHEME = /^Device\s+(\S+)$/i;

/**
 * Authenticates the wall.
 *
 * A missing header, a malformed one, an unknown token and a revoked token all produce the
 * SAME refusal: `403 device_revoked`. The frozen table has no separate "unauthenticated"
 * code, and merging them is also the behaviour the wall wants — every one of these cases
 * means "this panel is not currently trusted", which renders as the offline card. A login
 * form on a wall nobody is standing at would be the wrong answer to all four.
 */
export function authenticateDevice(db: Db, header: string | undefined): DeviceIdentity {
  const match = typeof header === 'string' ? AUTH_SCHEME.exec(header.trim()) : null;
  const token = match?.[1];
  if (!token) throw new ApiError('device_revoked', 'this device is not registered');

  const row = db
    .prepare(
      `SELECT id, label, revoked_at_utc, last_seen_utc FROM device_token WHERE token_hash = ?`,
    )
    .get(hashDeviceToken(token)) as
    | { id: string; label: string; revoked_at_utc: string | null; last_seen_utc: string | null }
    | undefined;

  if (!row || row.revoked_at_utc !== null) {
    throw new ApiError('device_revoked', 'this device is not registered');
  }

  touch(db, row.id, row.last_seen_utc);
  return { id: row.id, label: row.label };
}

const TOUCH_INTERVAL_MS = 60_000;

/**
 * Best-effort `last_seen_utc`, throttled and swallowed.
 *
 * Swallowed because this is a WRITE on the path of every READ. On a full disk or a
 * filesystem remounted read-only the wall can still render an already-materialized day —
 * that is the read-only fast path Units A and C were restructured around — and failing the
 * whole request to record telemetry would blank a wall that had everything it needed.
 * Throttled because a three-year-old taps a lot and none of those taps need an fsync.
 */
function touch(db: Db, id: string, lastSeen: string | null): void {
  try {
    if (lastSeen !== null) {
      const age = Date.now() - Date.parse(lastSeen);
      if (Number.isFinite(age) && age < TOUCH_INTERVAL_MS) return;
    }
    db.prepare(`UPDATE device_token SET last_seen_utc = ? WHERE id = ?`).run(nowUtc(), id);
  } catch {
    /* telemetry is never allowed to fail a render */
  }
}

// ---------------------------------------------------------------------------
// The parent PIN
// ---------------------------------------------------------------------------

/** `household_config` key holding the encoded PIN verifier. */
export const PIN_CONFIG_KEY = 'parent_pin_scrypt';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1 } as const;

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  // Async on purpose. better-sqlite3 already blocks the event loop on every query; a
  // synchronous 60ms KDF on top of that would add a second stall to a process that also
  // has to answer SSE heartbeats. `scrypt` runs on the threadpool, so this one does not.
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, SCRYPT_KEYLEN, { ...SCRYPT_PARAMS }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Sets (or replaces) the household PIN. Provisioning calls this, and so does
 * `POST /api/admin/v1/settings/pin` — behind the CURRENT PIN, like every admin write.
 *
 * scrypt rather than a bare digest even though a 4-digit PIN has only 10^4 preimages: the
 * work factor is not the defence (nothing defends a 4-digit secret against an offline
 * attacker with the verifier), but it costs nothing here and it means a leaked database
 * file does not hand over the PIN by inspection.
 */
export async function setParentPin(db: Db, pin: string): Promise<void> {
  if (typeof pin !== 'string' || pin.length < 4) {
    throw new ApiError('bad_request', 'a PIN must be at least 4 characters');
  }
  const salt = randomBytes(16);
  const key = await derive(pin, salt);
  db.prepare(
    `INSERT INTO household_config (key, value_text) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text`,
  ).run(PIN_CONFIG_KEY, `scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
}

export function parentPinIsSet(db: Db): boolean {
  const row = db
    .prepare(`SELECT 1 AS present FROM household_config WHERE key = ?`)
    .get(PIN_CONFIG_KEY) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * Verifies a PIN. FAILS CLOSED when no PIN has been provisioned.
 *
 * An unset PIN meaning "no check" would leave every approval route open on a panel three
 * children can reach — a child approving her own chore is a permanent, append-only ledger
 * fact. So an unconfigured household cannot approve anything until an adult provisions a
 * PIN, which is a loud failure at setup rather than a silent one at the wall.
 *
 * There is deliberately NO lockout after repeated failures. A child mashing the pad would
 * otherwise lock the parent out of approvals, converting a nuisance into an outage; the
 * scrypt cost is the throttle, and this surface is LAN-only behind a device token already.
 */
export async function verifyParentPin(db: Db, pin: string | undefined): Promise<boolean> {
  const row = db
    .prepare(`SELECT value_text FROM household_config WHERE key = ?`)
    .get(PIN_CONFIG_KEY) as { value_text: string } | undefined;
  if (!row || typeof pin !== 'string' || pin.length === 0) return false;

  const parts = row.value_text.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, keyHex] = parts as [string, string, string];

  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, 'hex');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const actual = await derive(pin, Buffer.from(saltHex, 'hex'));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Throws `401 bad_pin` unless the header carries the household PIN. */
export async function requireParentPin(db: Db, header: string | undefined): Promise<void> {
  const ok = await verifyParentPin(db, header);
  if (!ok) throw new ApiError('bad_pin', 'ask a grown-up');
}
