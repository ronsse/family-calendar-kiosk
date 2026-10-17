/**
 * Unit H — what the domain layer needs, in one place.
 *
 * The snapshot, the action port, the tap gate and the clock.  Domain components
 * read this; presentational leaves never do — a leaf that reached for the snapshot
 * could render something its band was not handed, which is exactly how three
 * renderings drift apart.
 */

import { createContext, useContext } from 'react';
import type { WallSnapshot } from '../../../src/types.ts';
import type { WallActions } from './actions.ts';
import type { TapGate } from './useTapGate.ts';
import type { WallClock } from './useWallClock.ts';

export interface WallContextValue {
  snapshot: WallSnapshot;
  actions: WallActions;
  gate: TapGate;
  clock: WallClock;
  /**
   * Error-boundary reset key.  A fresh snapshot retries a leaf that crashed on the
   * previous one, so a single bad payload cannot latch a component into its
   * fallback for the months this kiosk runs without a reload.
   */
  resetKey: string;
}

export const WallContext = createContext<WallContextValue | null>(null);

/**
 * Throws when there is no provider.  That can only happen if something mounts a
 * domain component outside `WallApp`, and `WallApp` wraps its whole tree in a
 * boundary, so the visible result is the offline card rather than a blank wall.
 */
export function useWall(): WallContextValue {
  const value = useContext(WallContext);
  if (value === null) throw new Error('wall domain component rendered outside WallApp');
  return value;
}
