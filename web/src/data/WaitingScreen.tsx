/**
 * Unit I — what the wall shows before it has ever had a snapshot.
 *
 * This is the only screen in the bundle that is not `WallApp`, and it exists because there is
 * exactly one moment the shell cannot cover: the seconds between Chromium painting and the
 * first snapshot arriving. After that there is always a last good snapshot to fall back to,
 * so every later failure renders the real wall with a staleness mark instead of this.
 *
 * It is a CLOCK and nothing else. Three reasons, in order:
 *
 *  - A clock is the one thing that is certainly true, and a moving second hand is how the
 *    household tells "waiting" from "frozen" at ten feet. The Pi's own offline fallback page
 *    already works this way; this is deliberately the same idea in the design system's colours,
 *    so the handover between them is not a jarring change of screen.
 *  - No words. A pre-reader may be the first one at the panel, and a word she cannot read is
 *    indistinguishable from a broken screen (design/README rule 5).
 *  - No error text, no spinner tied to a request, nothing that says "failed". A child gets the
 *    last good state or a calm waiting state; never a diagnostic.
 */

import { useEffect, useState } from 'react';
import { colour, font, fontSizePx, fontWeight, layoutPx, spacePx } from '../design/tokens.ts';

/*
 * The BROWSER's zone and locale, on purpose (2026-10-12). This screen exists only before the
 * first snapshot, which is the only thing that can say what the household's zone is — so there
 * is no household setting to read yet. The panel's own clock is in the household's zone (the
 * live Pi's is America/Denver), and a clock in the wrong zone is still a moving clock, which
 * is all this screen promises.
 */
const TIME_TEXT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const DATE_TEXT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export function WaitingScreen({ tickMs = 15_000 }: { tickMs?: number }) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, tickMs);
    return () => {
      clearInterval(id);
    };
  }, [tickMs]);

  const at = new Date(nowMs);

  return (
    <div
      style={{
        width: `${String(layoutPx.wallWidth)}px`,
        height: `${String(layoutPx.wallHeight)}px`,
        boxSizing: 'border-box',
        background: colour.bg,
        color: colour.ink,
        fontFamily: font.family,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: `${String(spacePx.md)}px`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: `${String(fontSizePx.clock)}px`,
          fontWeight: fontWeight.bold,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {TIME_TEXT.format(at)}
      </div>
      <div
        style={{
          fontSize: `${String(fontSizePx.sectionTitle)}px`,
          fontWeight: fontWeight.regular,
          color: colour.inkMuted,
        }}
      >
        {DATE_TEXT.format(at)}
      </div>
    </div>
  );
}
