/**
 * Unit H — the browser's half of a strip that chooses its words (logic/textFit.ts decides).
 *
 * Two numbers come off the glass rather than out of arithmetic: how wide the strip's box is, and
 * how wide a run of words is in the typeface the box draws in. The room is the element's content
 * box, read again whenever a ResizeObserver says it moved; the ruler is a canvas `measureText` in
 * the element's own computed font family. Neither is derived from tokens, because what cut the
 * header's date and the leave-by banner (2026-10-11) was neighbours that change width with the
 * time of day, the theme's typeface and the freshness label — no constant could have held.
 *
 * The element's width must not depend on its words (`flex: 1 1 0` with `minWidth: 0`), or the
 * choice would feed back into the room it was chosen for.
 *
 * It SAYS something only on a change. A reading equal to the last schedules nothing: handing
 * React every measurement once put the wall into React #185 (logic/scrollMeasure.ts), and this
 * is the same shape. A web font that finishes loading after the first reading makes the ruler
 * stale without moving any box, so `document.fonts` is listened to as well.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MeasureText } from '../logic/textFit.ts';

// The DOM, described narrowly: this tree compiles with `lib: ["es2023"]` so the logic modules can
// be unit-tested under Node (the same bargain `main.tsx` and `ScrollColumn` make).
interface BoxLike {
  readonly clientWidth: number;
}
interface ComputedLike {
  readonly fontFamily: string;
  readonly paddingLeft: string;
  readonly paddingRight: string;
}
interface Canvas2D {
  font: string;
  measureText(words: string): { readonly width: number };
}
interface FontSetLike {
  addEventListener(type: 'loadingdone', listener: () => void): void;
  removeEventListener(type: 'loadingdone', listener: () => void): void;
}
const DOM = globalThis as unknown as {
  ResizeObserver?: new (cb: () => void) => { observe(target: unknown): void; disconnect(): void };
  getComputedStyle?: (el: unknown) => ComputedLike;
  document?: {
    createElement(tag: 'canvas'): { getContext(kind: '2d'): Canvas2D | null };
    fonts?: FontSetLike;
  };
};

let canvas: Canvas2D | null | undefined;
function ruler(): Canvas2D | null {
  if (canvas === undefined) canvas = DOM.document?.createElement('canvas').getContext('2d') ?? null;
  return canvas;
}

export interface TextRoom {
  /** The content box's width, whole pixels, rounded down. */
  readonly roomPx: number;
  /** Words at a size, in this element's typeface and the given weight. */
  readonly measure: MeasureText;
}

interface Reading {
  readonly roomPx: number;
  readonly family: string;
}

/**
 * Attach `ref` to the strip. `room` is null until the first reading (and wherever there is no
 * canvas); a strip draws its widest form until then, and the first reading lands before paint.
 */
export function useTextRoom<E>(weight: number): { readonly ref: RefObject<E>; readonly room: TextRoom | null } {
  const ref = useRef<E>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const last = useRef<Reading | null>(null);
  const [fontsLoaded, setFontsLoaded] = useState(0);

  const read = useCallback(() => {
    const el = ref.current;
    if (el === null || DOM.getComputedStyle === undefined) return;
    const cs = DOM.getComputedStyle(el);
    const pad = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
    const roomPx = Math.max(0, Math.floor((el as unknown as BoxLike).clientWidth - pad));
    const family = cs.fontFamily;
    const prev = last.current;
    if (prev !== null && prev.roomPx === roomPx && prev.family === family) return;
    const next = { roomPx, family };
    last.current = next;
    setReading(next);
  }, []);

  useLayoutEffect(read, [read]);
  useEffect(() => {
    const el = ref.current;
    if (el === null || DOM.ResizeObserver === undefined) return;
    const ro = new DOM.ResizeObserver(read);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [read]);
  useEffect(() => {
    const fonts = DOM.document?.fonts;
    if (fonts === undefined) return;
    const loaded = (): void => {
      setFontsLoaded((n) => n + 1);
    };
    fonts.addEventListener('loadingdone', loaded);
    return () => {
      fonts.removeEventListener('loadingdone', loaded);
    };
  }, []);

  const family = reading?.family ?? null;
  const measure = useMemo<MeasureText | null>(() => {
    const ctx = ruler();
    if (family === null || ctx === null) return null;
    // `fontsLoaded` is read so a finished font makes a new ruler, and with it a new decision.
    void fontsLoaded;
    return (words, sizePx) => {
      ctx.font = `${String(weight)} ${String(sizePx)}px ${family}`;
      return ctx.measureText(words).width;
    };
  }, [family, weight, fontsLoaded]);

  return { ref, room: reading === null || measure === null ? null : { roomPx: reading.roomPx, measure } };
}
