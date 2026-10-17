/**
 * Unit H — THE branch.  It happens exactly once, here.
 *
 * H2 Q3, adopted: one capability-driven domain tree, and a single
 * `BandRendererProvider` supplying a typed registry keyed by `ReadingBand`.  Domain
 * components own data, derived state and actions; they call `useBandRenderer()`
 * (or render `<BandLeaf>`) only to obtain a presentational leaf.  All stateful
 * logic — action dispatch, tap debounce, the undo window, idle decay — exists once,
 * above the bands, so the three renderings cannot silently drift apart as features
 * land.
 *
 * H2 specified an ESLint rule forbidding `if (band ===` / `switch (band)` outside
 * this file.  No ESLint is installed, so the same guarantee is a test:
 * test/unit-h.sources.test.ts greps every file under web/src/views and web/src/app.
 * It currently finds ZERO band branches — including in this file, because the
 * mapping here is a keyed LOOKUP, which is stronger than the rule asked for: a new
 * `ReadingBand` is a compile error in `Record<ReadingBand, RendererSet>` rather
 * than a silently-unhandled case.
 *
 * Band-conditional CHROME (the shell asking "does this band show text at all?")
 * reads `bandTypography[band]` as data.  That is a lookup too, and it is how a
 * fourth band would get correct chrome for free.
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { BandRendererRegistry, ReadingBand } from '../../../../src/types.ts';
import { typographyFor, type BandTypography, type ViewingDistance } from '../../design/tokens.ts';
import type { AnyRenderer, LeafName, LeafPropsByName, RendererComponent, RendererSet } from '../contract.ts';
import { FALLBACK_BAND } from '../logic/idle.ts';
import { InertBlock, RendererErrorBoundary } from '../RendererErrorBoundary.tsx';
import { pictureRenderers } from './picture.tsx';
import { emergentRenderers } from './emergent.tsx';
import { fluentRenderers } from './fluent.tsx';

export type WallRegistry = Record<ReadingBand, RendererSet>;

/**
 * `satisfies` proves this is a `BandRendererRegistry<C>` in the frozen contract's
 * terms while keeping the precise per-leaf types for callers.  A band missing from
 * this object, or a leaf missing from a band, does not compile.
 */
const REGISTRY = {
  picture: pictureRenderers,
  emergent: emergentRenderers,
  fluent: fluentRenderers,
} satisfies BandRendererRegistry<AnyRenderer>;

export const bandRendererRegistry: WallRegistry = REGISTRY;

interface BandContextValue {
  band: ReadingBand;
  registry: WallRegistry;
  /** How far away the reader is standing. See NearScope and H8. */
  distance: ViewingDistance;
}

/**
 * The default is the picture band, not a throw.  A missing provider is a bug, but
 * it is a bug that must still render something a three-year-old can use at 6:00 AM
 * rather than an exception that blanks the wall.
 */
const BandContext = createContext<BandContextValue>({
  band: FALLBACK_BAND,
  registry: bandRendererRegistry,
  distance: 'far',
});

export function BandRendererProvider({
  band,
  registry = bandRendererRegistry,
  // FAR by default, because the screen this wall shows almost all the time is the idle one and
  // that is read from the kitchen. A destination somebody walks up to opts IN (H8).
  distance = 'far',
  children,
}: {
  band: ReadingBand;
  registry?: WallRegistry;
  distance?: ViewingDistance;
  children: ReactNode;
}) {
  const value = useMemo<BandContextValue>(
    () => ({ band, registry, distance }),
    [band, registry, distance],
  );
  return <BandContext.Provider value={value}>{children}</BandContext.Provider>;
}

/**
 * Declare that everything below is read at ARM'S LENGTH.
 *
 * Wrap a destination, not a component: distance is a property of the SCREEN somebody is
 * standing in front of, and a card that shrinks in one place and not another is how a design
 * system stops being one.
 */
/**
 * The grown-up portal's scope: an ADULT AT A CONTROL PANEL.
 *
 * Same arm's length as `NearScope` and a different reader — see `deskTypography`, which is
 * where the reasoning and the one thing that does not shrink (the 64px tap floor) are written
 * down. Asked for after the first real use: *"you can shrink the size in the [admin] tab a
 * lot."*
 */
export function DeskScope({ children }: { children: ReactNode }) {
  const { band, registry } = useContext(BandContext);
  return (
    <BandRendererProvider band={band} registry={registry} distance="desk">
      {children}
    </BandRendererProvider>
  );
}

export function NearScope({ children }: { children: ReactNode }) {
  const { band, registry } = useContext(BandContext);
  return (
    <BandRendererProvider band={band} registry={registry} distance="near">
      {children}
    </BandRendererProvider>
  );
}

/**
 * Nest a different band for one subtree.  The child selector needs this: every
 * child's face is drawn in that child's OWN band, because the selector is the one
 * surface all three bands use at the same moment — the pre-reader has to be able to
 * find herself while her sister's screen is up.
 */
export function BandScope({ band, children }: { band: ReadingBand; children: ReactNode }) {
  const { registry, distance } = useContext(BandContext);
  return (
    <BandRendererProvider band={band} registry={registry} distance={distance}>
      {children}
    </BandRendererProvider>
  );
}

export function useActiveBand(): ReadingBand {
  return useContext(BandContext).band;
}

/** The presentational leaves for the active band. */
export function useBandRenderer(): RendererSet {
  const { band, registry } = useContext(BandContext);
  return registry[band] ?? registry[FALLBACK_BAND];
}


/**
 * Presentation data for the active band, for chrome that is not one of the seven
 * leaves (the header's date line asking whether this band shows words at all).
 */
export function useBandTypography(): BandTypography {
  const { band, distance } = useContext(BandContext);
  return typographyFor(band, distance);
}

/**
 * The only way a domain component should reach a leaf.  It does three things at
 * once, which is why it exists instead of `useBandRenderer().ChoreCard`:
 *   1. looks the leaf up in the active band;
 *   2. wraps it so a crash degrades to the picture band's version of the SAME leaf;
 *   3. wraps that so a crash in the picture version degrades to an inert block.
 * A leaf can therefore fail twice and still not leave a hole in the wall.
 */
export function BandLeaf<K extends LeafName>({
  leaf,
  props,
  resetKey,
}: {
  leaf: K;
  props: LeafPropsByName[K];
  resetKey?: string | number | undefined;
}) {
  const { band, registry } = useContext(BandContext);
  const set = registry[band] ?? registry[FALLBACK_BAND];
  const Leaf = pick(set, leaf);
  const Picture = pick(registry[FALLBACK_BAND], leaf);
  return (
    <RendererErrorBoundary label={leaf} resetKey={resetKey} fallback={<InertBlock />}>
      <RendererErrorBoundary label={leaf} resetKey={resetKey} fallback={<Picture {...props} />}>
        <Leaf {...props} />
      </RendererErrorBoundary>
    </RendererErrorBoundary>
  );
}

/**
 * The one cast in the view layer.  `RendererSet[K]` and
 * `RendererComponent<LeafPropsByName[K]>` are the same type for every concrete K —
 * both interfaces are written leaf-by-leaf above — but TypeScript cannot relate
 * them through a generic index.  The pairing is checked at every DEFINITION site
 * instead: each band declares `const xRenderers: RendererSet = { … }`.
 */
function pick<K extends LeafName>(set: RendererSet, leaf: K): RendererComponent<LeafPropsByName[K]> {
  return set[leaf] as unknown as RendererComponent<LeafPropsByName[K]>;
}
