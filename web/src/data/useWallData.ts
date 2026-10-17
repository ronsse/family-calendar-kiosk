/**
 * Unit I — the controller, as a hook.
 *
 * Thin on purpose. Everything that decides anything lives in `controller.ts`, which has no
 * React in it and therefore no need for a DOM to be tested. This file only owns the two things
 * React genuinely owns: keeping one controller alive across renders, and turning its state
 * pushes into re-renders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalDate } from '../../../src/types.ts';
import { applyHouseholdView } from '../../../src/config/presentation.ts';
import {
  createWallDataController,
  type WallDataController,
  type WallDataDeps,
  type WallDataState,
} from './controller.ts';

export interface WallData extends WallDataState {
  /** Hand this to `WallApp`'s `onLocalDateChange`. */
  readonly onLocalDateChange: (date: LocalDate) => void;
}

export function useWallData(deps: WallDataDeps = {}): WallData {
  // The controller is created ONCE. Re-creating it on a dep change would drop the open stream
  // and the last good snapshot together — a blank wall caused by a render, which is the
  // failure class this whole unit exists to prevent.
  const ref = useRef<WallDataController | null>(null);
  const [state, setState] = useState<WallDataState>(() => ({
    snapshot: null,
    degraded: null,
    streamConnected: false,
    lastGoodAtMs: null,
  }));

  if (ref.current === null) {
    ref.current = createWallDataController({
      ...deps,
      onState: (next) => {
        // The household's zone, locale and currency ride in the snapshot. Applied BEFORE the
        // render so every formatter in that render agrees with the server's "today"; a cached
        // snapshot from an older server has no `household` and leaves the defaults alone.
        applyHouseholdView(next.snapshot?.household);
        setState(next);
        deps.onState?.(next);
      },
    });
  }
  const controller = ref.current;

  useEffect(() => {
    controller.start();
    return () => {
      controller.stop();
    };
  }, [controller]);

  /**
   * STABLE IDENTITY, and this is not a micro-optimisation — it is the difference between a
   * working wall and a denial-of-service against your own house.
   *
   * `WallApp` reports its clock from `useEffect(..., [localDate, onLocalDateChange])`. A
   * callback rebuilt whenever `state` changed would close the loop: state changes -> new
   * identity -> the effect re-runs -> refetch -> new snapshot -> state changes. MEASURED in a
   * real headless Chromium against a real server before this was a `useCallback`: **2404
   * snapshot requests in eight seconds**, climbing, and invisible from the living room until
   * the server fell over.
   *
   * `controller.reportShellDate` is the structural half of the same fix — it does nothing at
   * all when the date has not changed, so the loop cannot be reopened by a future edit to a
   * dependency array. Both halves are wanted; neither is redundant.
   *
   * The shell's clock remains a genuinely SECOND path to the boundary refetch, independent of
   * the controller's own tick, which is the reason it is wired up at all: one missed boundary
   * costs the whole school morning.
   */
  const onLocalDateChange = useCallback(
    (date: LocalDate) => {
      controller.reportShellDate(date);
    },
    [controller],
  );

  return useMemo<WallData>(() => ({ ...state, onLocalDateChange }), [state, onLocalDateChange]);
}
