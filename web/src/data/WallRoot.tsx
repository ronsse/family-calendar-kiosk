/**
 * Unit I — the composition root of the bundle.
 *
 * Unit H's `WallApp` takes a snapshot as a PROP and has no data layer, deliberately. This is
 * where the two halves meet: the controller supplies snapshots, the action port supplies
 * writes, and nothing above this file knows that a network exists.
 *
 * The only rendering decision made here is the first one — snapshot or waiting screen — and it
 * is a one-way door. Once a snapshot has arrived, this component never falls back to the
 * waiting screen again, no matter what fails afterwards, because `state.snapshot` holds the
 * last good one. Failure after that point is Unit H's job: it renders the wall it already has
 * plus the staleness pill that `freshness` drives. Stale-but-labelled satisfies the prime
 * invariant; blank does not.
 */

import { useMemo } from 'react';
import { WallApp } from '../app/WallApp.tsx';
import { createWallActions } from '../app/actions.ts';
import { createAdminActions } from '../app/adminActions.ts';
import { browserWindow, claimDeviceToken, hardReload, safeStorage } from './browser.ts';
import { isProbeSession } from './device.ts';
import { WaitingScreen } from './WaitingScreen.tsx';
import { useWallData } from './useWallData.ts';

export interface WallRootProps {
  /** Present so a preview or a harness can drive this without a real browser. */
  baseUrl?: string | undefined;
}

export function WallRoot({ baseUrl }: WallRootProps) {
  // Resolved once, outside render-sensitive state: the fragment is scrubbed from the address
  // bar as a side effect, and doing that twice would be harmless but pointless.
  const boot = useMemo(() => {
    const win = browserWindow();
    const store = safeStorage(win);
    return { win, store, token: claimDeviceToken(win, store) };
  }, []);

  const data = useWallData({
    deviceToken: boot.token,
    store: boot.store,
    baseUrl,
    hardReload: () => {
      hardReload(boot.win);
    },
  });

  const actions = useMemo(
    () =>
      createWallActions({
        baseUrl: baseUrl ?? '',
        deviceToken: boot.token ?? '',
        // `#probe=1` survives the address-bar scrub the same way `gate=` does: only the
        // device token is filtered out of the fragment. Read once per mount, never stored.
        countTaps: !isProbeSession(boot.win?.location.hash),
      }),
    [baseUrl, boot.token],
  );

  // The SAME device token, because the admin surface needs the token AS WELL AS the PIN. What
  // it does not get, ever, is a stored PIN: that arrives per request from the sheet and is
  // gone again before the fetch resolves.
  const adminActions = useMemo(
    () =>
      createAdminActions({
        baseUrl: baseUrl ?? '',
        deviceToken: boot.token ?? '',
      }),
    [baseUrl, boot.token],
  );

  if (data.snapshot === null) return <WaitingScreen />;

  return (
    <WallApp
      snapshot={data.snapshot}
      actions={actions}
      adminActions={adminActions}
      onLocalDateChange={data.onLocalDateChange}
    />
  );
}
