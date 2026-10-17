/**
 * Unit H — a render crash degrades to pictures, never to a hole.
 *
 * H2 Q3 adopted this together with `BAND_ORDER` being picture-first: whatever
 * breaks, what is left standing must be usable by the child who cannot read.  A
 * leaf that throws is replaced by the SAME leaf from the picture band; if that
 * throws too, the outer boundary swaps in an inert block — still a shape, still
 * the right size, still not a hole in the wall.
 *
 * `resetKey` matters more here than it looks.  The kiosk runs for months without
 * a reload, so a boundary that latches on one bad snapshot would stay latched
 * until someone notices at 6:00 AM in December.  The domain passes the snapshot's
 * `generatedAtUtc`, so every fresh snapshot retries the real renderer once.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { colour, radius, strokePx, tapPx } from '../design/tokens.ts';
import { px } from './primitives/style.ts';
import { Glyph } from './primitives/Glyph.tsx';

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  /** Change it to retry the real renderer.  Usually `freshness.generatedAtUtc`. */
  resetKey?: string | number | undefined;
  /** Names the leaf in the console line; never rendered on the wall. */
  label?: string | undefined;
}

interface BoundaryState {
  failed: boolean;
}

export class RendererErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The wall has nobody watching a console, but the Pi keeps browser logs and
    // this is the only trace of a leaf that quietly went to pictures.
    console.error(`[wall] renderer failed: ${this.props.label ?? 'leaf'}`, error, info.componentStack);
  }

  override componentDidUpdate(prev: BoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The last resort.  No text, no data, no props to get wrong — the one thing on the
 * wall that cannot itself fail.  It keeps a tap-target-sized footprint so the
 * layout around it does not collapse and reflow everything else.
 */
export function InertBlock() {
  return (
    <div
      style={{
        minWidth: px(tapPx.min),
        minHeight: px(tapPx.min),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colour.surfaceSunken,
        border: `${px(strokePx.medium)} dashed ${colour.borderStrong}`,
        borderRadius: radius.md,
        boxSizing: 'border-box',
      }}
    >
      <Glyph name="unknown" sizePx={tapPx.min / 2} tone={colour.borderStrong} />
    </div>
  );
}
