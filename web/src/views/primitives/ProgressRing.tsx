/**
 * Unit H — a progress ring drawn around something else.
 *
 * Harvested from Skylight's routine switcher (H5 §2), which puts a ring around each
 * time-of-day button so "how much of my morning is left" is answerable without entering it.
 * The property that makes it worth copying on THIS wall is that it costs no height: the wall
 * is 540 logical pixels tall and every readout that needs its own row is a row a routine step
 * does not get.
 *
 * It is a SECOND channel, never the only one. A ring is a shape and a proportion, not a
 * number, and the bands that read numerals also draw them — so nothing here is the sole
 * carrier of a fact, which is the same rule the accents live under (Unit G rule 6).
 *
 * Drawn as an SVG arc rather than a conic gradient: `conic-gradient` antialiases its start
 * edge badly at small radii, and on a 225-nit anti-glare panel a soft edge is a lost edge.
 */

import { colour, strokePx } from '../../design/tokens.ts';

export interface ProgressRingProps {
  /** Outer diameter in logical pixels.  Comes from a token, never from a guess. */
  readonly sizePx: number;
  readonly done: number;
  readonly total: number;
  /** The filled arc.  The track is always the neutral border token. */
  readonly tone: string;
  readonly children?: React.ReactNode;
}

export function ProgressRing({ sizePx, done, total, tone, children }: ProgressRingProps) {
  // A ring with nothing to report draws only its track: an empty ring reads as "none yet",
  // which is true and useful, where hiding it entirely would make the row jump as the first
  // step lands.
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  const safeDone = Math.max(0, Math.min(Number.isFinite(done) ? Math.trunc(done) : 0, safeTotal));
  const fraction = safeTotal === 0 ? 0 : safeDone / safeTotal;

  const stroke = strokePx.medium;
  const radius = (sizePx - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${String(sizePx)}px`,
        height: `${String(sizePx)}px`,
        flex: '0 0 auto',
      }}
    >
      <svg
        width={sizePx}
        height={sizePx}
        viewBox={`0 0 ${String(sizePx)} ${String(sizePx)}`}
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden="true"
      >
        <circle
          cx={sizePx / 2}
          cy={sizePx / 2}
          r={radius}
          fill="none"
          stroke={colour.border}
          strokeWidth={stroke}
        />
        {fraction === 0 ? null : (
          <circle
            cx={sizePx / 2}
            cy={sizePx / 2}
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${String(circumference * fraction)} ${String(circumference)}`}
            // Twelve o'clock, clockwise. A ring that starts at three o'clock reads as a pie
            // chart; one that starts at the top reads as a clock, which is what it is
            // standing in for.
            transform={`rotate(-90 ${String(sizePx / 2)} ${String(sizePx / 2)})`}
          />
        )}
      </svg>
      <span style={{ position: 'relative', display: 'inline-flex' }}>{children}</span>
    </span>
  );
}
