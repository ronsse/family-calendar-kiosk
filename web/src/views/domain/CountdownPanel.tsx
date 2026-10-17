/**
 * Unit H — sleeps until the thing that matters.
 *
 * `sleepsRemaining` is a whole local-date difference computed on the server as a
 * date subtraction, never an instant delta — so it does not shift by one at a DST
 * boundary.  Nothing here recomputes it; the client only chooses how to draw it.
 */

import { spacePx } from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { BandLeaf, useActiveBand } from '../bands/registry.tsx';
import { px } from '../primitives/style.ts';
import { localDateText } from '../logic/clock.ts';
import { pipsForCount } from '../logic/pips.ts';

export function CountdownPanel({ limit }: { limit: number }) {
  const { snapshot, resetKey } = useWall();
  const band = useActiveBand();
  const countdowns = [...(snapshot.countdowns ?? [])]
    .sort((a, b) => a.sleepsRemaining - b.sleepsRemaining)
    .slice(0, Math.max(0, limit));
  if (countdowns.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.tapGap), minWidth: 0 }}>
      {countdowns.map((c) => (
        <BandLeaf
          key={c.id}
          leaf="CountdownCard"
          resetKey={resetKey}
          props={{
            countdownId: c.id,
            labelShort: c.labelShort,
            labelFull: c.labelFull,
            icon: c.icon,
            emoji: c.emoji,
            sleepsRemaining: c.sleepsRemaining,
            pips: pipsForCount(c.sleepsRemaining, band),
            targetDateText: localDateText(c.targetDate, 'short'),
          }}
        />
      ))}
    </div>
  );
}
