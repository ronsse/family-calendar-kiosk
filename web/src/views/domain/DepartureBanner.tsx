/**
 * "Get ready for Dance — leave at 4:15." The leave-by alert, drawn.
 *
 * Two placements of the same words:
 *
 *   - `header`: the middle of the chrome bar on the board and every child screen, where the
 *     time and date sit. It is a strip, one card tall, and the words are sized for a parent
 *     at arm's length and a seven-year-old beside them — this is a mid-morning, mid-afternoon
 *     thing, and the household is in the room for it.
 *   - `scene`: a floating card at the top-left of the picture, which has no header. Bigger,
 *     because the picture is the wall the kitchen glances at, and "are we late" is a glance.
 *
 * Both carry the emoji and, for a calendar event, the child's face — the non-readers' whole
 * reading of the banner. The colour says the phase before any of it is read: sky for "get
 * ready", orange for "go". Never red; red is the adult surface's.
 *
 * Visual only. There is no sound on this wall and this does not add one: a chime in the
 * living room at 7:15 every school morning is the kind of thing a household turns off in a
 * week, and the switch for that is behind the PIN (Grown-ups → Settings → Leave-by alerts).
 *
 * Judged every tick from the clock and the snapshot — nothing is stored. When the clock says
 * the window has closed, the banner is simply not rendered; there is nothing to dismiss and
 * nothing to acknowledge, which is the design: a wall does not want you to tap it to make it
 * stop.
 */

import { colour, cssTokens, fontSizePx, fontWeight, iconPx, radius, spacePx, strokePx } from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { AssetImage } from '../primitives/AssetImage.tsx';
import { px, text } from '../primitives/style.ts';
import { useTextRoom } from '../primitives/useTextRoom.ts';
import { avatarRef } from '../logic/summary.ts';
import {
  departureFit,
  departureNow,
  departureWords,
  departuresForDay,
  DEPARTURE_SCENE_MAX_WIDTH_PX,
  type DepartureAlert,
  type DepartureFit,
} from '../logic/departures.ts';

/** The alert to draw right now, from the wall's own clock. Null renders nothing. */
export function useDepartureAlert(): DepartureAlert | null {
  const { snapshot, clock } = useWall();
  const departures = departuresForDay(snapshot.events, snapshot.departures, clock.localDate);
  return departureNow(departures, clock.localTime);
}

export function DepartureBanner({ placement }: { placement: 'header' | 'scene' }) {
  const { snapshot } = useWall();
  const alert = useDepartureAlert();
  // Measured before the early return: a hook may not be skipped on the ticks with no alert.
  const { ref, room } = useTextRoom<HTMLDivElement>(fontWeight.bold);
  if (alert === null) return null;

  const go = alert.phase === 'go';
  const fill = go ? colour.leaveGoFill : colour.leaveReadyFill;
  const edge = go ? colour.leaveGoEdge : colour.leaveReadyEdge;
  const child = snapshot.children.find((c) => c.id === alert.departure.childId) ?? null;
  const big = placement === 'scene';
  const face = big ? iconPx.md : iconPx.sm;
  const emojiPx = big ? iconPx.sm : fontSizePx.bodyLarge;

  // The picture's card has the room and keeps the whole sentence. The header's strip is what is
  // left of the bar, and beside a side rail on a stale wall that can be under a hundred pixels,
  // so it CHOOSES its words (logic/departures.ts `departureFit`) instead of clipping them — on
  // 2026-10-11 it drew "G… / S…". Until the first reading, the two lines it always had.
  const fit: DepartureFit = big
    ? {
        form: 'words',
        head: { words: departureWords(alert).head, sizePx: fontSizePx.bodyLarge },
        detail: { words: departureWords(alert).detail, sizePx: fontSizePx.body },
        face: child !== null,
      }
    : room === null
      ? {
          form: 'words',
          head: { words: departureWords(alert, true).head, sizePx: fontSizePx.small },
          detail: { words: departureWords(alert, true).detail, sizePx: fontSizePx.meta },
          face: child !== null,
        }
      : departureFit(
          alert,
          {
            roomPx: room.roomPx,
            emojiPx: room.measure(alert.departure.emoji, emojiPx),
            facePx: child === null ? null : face,
            gapPx: spacePx.xs,
          },
          room.measure,
        );

  return (
    <div
      ref={ref}
      data-departure={alert.departure.key}
      data-departure-phase={alert.phase}
      data-departure-form={fit.form}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(spacePx.xs),
        minWidth: 0,
        // The header's strip is `xs` inside: beside a side rail every 8px is most of a digit.
        paddingLeft: px(big ? spacePx.sm : spacePx.xs),
        paddingRight: px(big ? spacePx.sm : spacePx.xs),
        paddingTop: px(big ? spacePx.xs : spacePx.none),
        paddingBottom: px(big ? spacePx.xs : spacePx.none),
        background: fill,
        border: `${px(strokePx.medium)} solid ${edge}`,
        borderRadius: radius.md,
        boxSizing: 'border-box',
        ...(big
          ? {
              position: 'absolute',
              top: px(spacePx.md),
              left: px(spacePx.md),
              maxWidth: px(DEPARTURE_SCENE_MAX_WIDTH_PX),
              boxShadow: `0 ${px(strokePx.medium)} 0 0 ${edge}`,
              zIndex: 2,
            }
          : // Grown from nothing: its width is what the bar leaves, never its words, or the
            // choice would feed back into the room it was chosen for. So the emoji alone stands
            // in the middle of that room, where it reads as a sign rather than an empty pill.
            { flex: '1 1 0', height: '100%', ...(fit.form === 'glyph' ? { justifyContent: 'center' } : {}) }),
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: px(emojiPx),
          lineHeight: cssTokens['--lh-tight'],
          flex: '0 0 auto',
        }}
      >
        {alert.departure.emoji}
      </span>
      {child !== null && fit.face ? <AssetImage asset={avatarRef(child)} sizePx={face} /> : null}
      {fit.form === 'words' ? (
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={text(fit.head.sizePx)}>{fit.head.words}</span>
          <span style={text(fit.detail.sizePx, { muted: true })}>{fit.detail.words}</span>
        </span>
      ) : fit.form === 'minutes' ? (
        <span style={text(fit.line.sizePx)}>{fit.line.words}</span>
      ) : null}
    </div>
  );
}
