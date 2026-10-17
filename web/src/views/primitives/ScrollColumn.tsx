/**
 * Unit H — a list that scrolls, on a wall whose scrollbars are hidden.
 *
 * ## Where this may be used, and where it may not
 *
 * The wall-cannot-scroll rule is about the IDLE board and the things read from the kitchen:
 * what is off the bottom of a screen nobody touches does not exist. It was applied to every
 * list on the wall, including the ones an adult stands at to MANAGE — the picture catalog, the
 * chore worths, a child's own job list — and there it sliced: "8 slots fit, the count says 12".
 * The household asked for the other thing, in words: *"I want to be able to scroll through
 * pictures... same with the other pages like the points and chores list... one column that is
 * scrollable."* So a list somebody is standing at may scroll. The idle board still may not.
 *
 * A child's routine is the one ordered list here, and it may scroll too (2026-09-13) — but only
 * past what a few full-width columns can hold (`fitRoutineGrid`, 2026-10-11), never in place of
 * them. `RoutinePanel` keeps the NEXT step scrolled into view so the order survives the fold: a
 * sequence the child is part-way through is never off the bottom.
 *
 * ## Why the edges are drawn
 *
 * The kiosk runs `--hide-scrollbars`, so a scrollable list looks exactly like a list that ends.
 * A fade over the last row, with a chevron in it, is the one cue that survives that: the row is
 * visibly cut, and cut things continue. Both edges are measured, not assumed — a list that fits
 * draws nothing, and a list scrolled to the end loses its bottom cue.
 *
 * `data-scroll-column` and `data-scroll-edge` are for `tools/panel-audit.mjs`, which fails
 * content larger than its box. A column that overflows AND draws its cue is this component
 * working; one that overflows with no cue is the bug the rule exists for. The audit checks the
 * cue is really in the DOM rather than trusting the column's say-so.
 *
 * Touch panning works under the body's `touch-action: manipulation` (pan is allowed; only
 * double-tap zoom is not), and `overscroll-behavior: contain` keeps a flick at the end of the
 * list from becoming a page gesture.
 *
 * ## It measures after every render, and SAYS something only on a change
 *
 * Handing every measurement to React and trusting it to drop the ones that changed nothing put
 * the wall into React #185 on 2026-10-11 — a loop of identical renders that blanked the body.
 * `logic/scrollMeasure.ts` has the mechanism; the rule is that an unchanged measurement must
 * schedule nothing at all.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { colour, iconPx, spacePx } from '../../design/tokens.ts';
import { measureLatch, NO_EDGES, type ScrollBoxNumbers, type ScrollEdges } from '../logic/scrollMeasure.ts';
import { Glyph } from './Glyph.tsx';
import { px } from './style.ts';

/** How tall the fade at a cut edge is. Two-thirds of a tap row: enough to read as a fade. */
export const SCROLL_EDGE_PX = 40;

interface ResizeWatcher {
  observe(target: unknown): void;
  disconnect(): void;
}

const RESIZE_OBSERVER = (
  globalThis as unknown as { ResizeObserver?: new (cb: () => void) => ResizeWatcher }
).ResizeObserver;

export function ScrollColumn({
  gapPx,
  ground,
  padPx,
  style,
  onHeight,
  children,
}: {
  /** The vertical gap between rows. */
  gapPx: number;
  /** The colour the fade dissolves into — the ground the list is drawn on. */
  ground?: string | undefined;
  /** Inner padding, so a selected row's border is not clipped by the scroll box. */
  padPx?: number | undefined;
  style?: CSSProperties | undefined;
  /**
   * Told the height the rows have — the box less its padding — on the first measurement and
   * whenever it changes. `RoutinePanel` sizes its steps from it, so the pane it fits is the pane
   * on the glass and not an arithmetic guess at it. The box's height is set by its parent, never
   * by its rows, so reporting it cannot feed back.
   */
  onHeight?: ((heightPx: number) => void) | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);
  // What this column last asked React for, one per mount; see logic/scrollMeasure.ts.
  const [latch] = useState(measureLatch);
  // Held in a ref so a new callback each render does not make a new `measure` (and a new
  // ResizeObserver) each render.
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;

  const measure = useCallback(() => {
    // The DOM, described narrowly, for the same reason `main.tsx` does it: this tree compiles
    // with `lib: ["es2023"]` so the logic modules can be unit-tested under Node.
    const el = ref.current as unknown as ScrollBoxNumbers | null;
    if (el === null) return;
    const sink = onHeightRef.current;
    const news = latch.read(el, padPx ?? 0, sink);
    if (news.heightPx !== null) sink?.(news.heightPx);
    if (news.edges !== null) setEdges(news.edges);
  }, [padPx, latch]);

  // After every render: the children are what change the scroll height. Most of these find
  // nothing new, and then nothing is set.
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    if (el === null || RESIZE_OBSERVER === undefined) return;
    const ro = new RESIZE_OBSERVER(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [measure]);

  const fadeTo = ground ?? colour.surface;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, ...style }}>
      <div
        ref={ref}
        data-scroll-column=""
        onScroll={measure}
        style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: px(gapPx),
          padding: padPx === undefined ? undefined : px(padPx),
          boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
      {edges.above ? <Edge side="top" ground={fadeTo} /> : null}
      {edges.below ? <Edge side="bottom" ground={fadeTo} /> : null}
    </div>
  );
}

function Edge({ side, ground }: { side: 'top' | 'bottom'; ground: string }) {
  return (
    <div
      aria-hidden="true"
      data-scroll-edge={side}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [side]: 0,
        height: px(SCROLL_EDGE_PX),
        display: 'flex',
        alignItems: side === 'top' ? 'flex-start' : 'flex-end',
        justifyContent: 'center',
        paddingBottom: side === 'bottom' ? px(spacePx.xxs) : undefined,
        paddingTop: side === 'top' ? px(spacePx.xxs) : undefined,
        boxSizing: 'border-box',
        background: `linear-gradient(to ${side}, transparent, ${ground} 70%)`,
        pointerEvents: 'none',
      }}
    >
      {/* The pager's chevron, turned on its side: the same mark for "there is more this way". */}
      <Glyph
        name="forward"
        sizePx={iconPx.xs}
        tone={colour.inkMuted}
        style={{ transform: `rotate(${side === 'bottom' ? '90deg' : '-90deg'})` }}
      />
    </div>
  );
}
