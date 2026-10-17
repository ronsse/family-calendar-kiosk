/**
 * Unit H — the dog's week.  The Easter egg.
 *
 * The operator's idea; the household said: *"The dog should have, when you press on him, he
 * can have a little menu of weekly generated activities that a dog would do and check them off.
 * Things like sleep all day, poop outside, eat underwear, wander away, get pet, get pet more,
 * chase squirrels."*
 *
 * Then the pivot, also theirs: *"under him, it should come from the dog's perspective … play fetch
 * with me, brush me, clean ears — those should be chores, extras, anyone can do it.  Write them
 * in a tricky way, like it was coming from a dog."*
 *
 * The dog is hidden in every picture — the same picture the children find themselves in — and
 * the finder writes down where he is (`WallScene.dog`).  Tap him and this comes up, and every
 * word on it is HIS.  Two halves:
 *
 *   - **Do this for me** — today's `pet` EXTRAS (`dogAsks`), one line each, with a face for
 *     every child who could still do it.  Tapping a face claims that child's row, exactly as
 *     the card on her own board would, and pays what the board would pay; the sheet is only a
 *     second door to the same chore, opened by the dog instead of by the child.  Anyone may do
 *     an extra and nobody must, which is why "who did it" is a question and not a name.
 *   - **What I did** — four deeds drawn for the week from a pool of forty-odd, first person,
 *     and a check beside each.  No points, no approval, no child: it is a joke the household
 *     tells itself, and the wall's only job is to remember which lines it has told.
 *
 * What it borrows and why:
 *
 *   - The **tap gate** (`deedKey` for a deed, `choreKey` for an ask — the SAME key the board
 *     uses, so the two doors never disagree about a claim), so a tick draws at once, can be
 *     undone within the window and is dropped when the snapshot disagrees — exactly like a
 *     routine step.  A control that waits for the server to draw its own state is a control
 *     that feels broken on a wall.
 *   - The **emoji is the non-reader's channel**, as it is beside a calendar event.  The youngest cannot
 *     read "chase squirrels" and does not need to: 🐿️ and a check is the whole message.
 *   - **It closes itself.**  Sixty seconds untouched and it is gone, because it covers the
 *     picture and the picture is home; and it never outlives the picture (`dogSheetAfter`).
 */

import { useEffect, useState } from 'react';
import type { DogDeed, DogWeek } from '../../../../src/types.ts';
import {
  childAccentForSlot,
  colour,
  cssTokens,
  fontSizePx,
  iconPx,
  radius,
  spacePx,
  stateTreatments,
  strokePx,
  tapPx,
} from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, px, tapTarget, text } from '../primitives/style.ts';
import { shownChoreTap } from '../logic/chores.ts';
import { choreKey } from '../logic/tap.ts';
import {
  DOG_ASKS_VISIBLE,
  DOG_FACE_TICK_PX,
  DOG_DEEDS_COLUMN_PX,
  DOG_SHEET_DECAY_MS,
  DOG_SHEET_WIDTH_PX,
  type DogAsk,
  askLine,
  deedKey,
  dogAsks,
  dogLine,
  dogTitle,
  petNameOf,
} from '../logic/dog.ts';
import { avatarRef } from '../logic/summary.ts';
import { ToggleKey } from './RoutinesPanel.tsx';

/**
 * The sheet, or nothing.  A household with no pet has `snapshot.dog === null` (2026-10-12), and
 * then there is no week to draw: the sheet is never mounted, whoever asked for it.  The guard is
 * HERE rather than at the mount site so the one component that needs a week is the one that
 * refuses to draw without it.
 */
export function DogSheet({ onClose }: { onClose: () => void }) {
  const { snapshot } = useWall();
  const week = snapshot.dog ?? null;
  if (week === null) return null;
  return <DogSheetBody week={week} name={petNameOf(snapshot.household)} onClose={onClose} />;
}

function DogSheetBody({
  week,
  name,
  onClose,
}: {
  week: DogWeek;
  name: string;
  onClose: () => void;
}) {
  const { snapshot, actions, gate } = useWall();
  const [touchedAtMs, setTouchedAtMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setTimeout(onClose, DOG_SHEET_DECAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [touchedAtMs, onClose]);

  // What to draw is the gate's answer, not the server's: a tick shows the moment it lands.
  const shown = week.deeds.map((deed) => ({
    ...deed,
    done: gate.value(deedKey(week.week, deed.id), deed.done),
  }));
  const line = dogLine({ week: week.week, deeds: shown });

  // His asks, from the rows as the gate shows them: a face just tapped is already "done by".
  const asks = dogAsks(
    snapshot.chores.map((chore) => ({
      ...chore,
      state: shownChoreTap(
        chore.state,
        gate.value(choreKey(chore.assignmentId), chore.state !== 'pending'),
      ).state,
    })),
    snapshot.children,
  );
  const childById = new Map(snapshot.children.map((c) => [c.id, c]));

  const face = (childId: string, assignmentId: number, done: boolean, onTap: (() => void) | null) => {
    const child = childById.get(childId);
    if (child === undefined) return null;
    return (
      <Tappable
        key={`${String(assignmentId)}:${childId}`}
        enabled={onTap !== null}
        onTap={() => {
          setTouchedAtMs(Date.now());
          onTap?.();
        }}
        style={tapTarget(tapPx.min, {
          width: px(tapPx.min),
          height: px(tapPx.min),
          padding: px(spacePx.none),
          background: 'transparent',
          borderRadius: radius.xl,
        })}
      >
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <AccentFrame accent={childAccentForSlot(child.sortOrder)} sizePx={iconPx.md} selected={done}>
            <AssetImage asset={avatarRef(child)} sizePx={iconPx.md} />
          </AccentFrame>
          {/* The answer to "who did this today", for the two children who cannot read. */}
          {done ? (
            <span
              style={{
                position: 'absolute',
                right: px(-spacePx.xs),
                bottom: px(-spacePx.xs),
                width: px(DOG_FACE_TICK_PX),
                height: px(DOG_FACE_TICK_PX),
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.pill,
                background: stateTreatments.approved.fill,
                border: `${px(strokePx.medium)} solid ${colour.surface}`,
                boxSizing: 'border-box',
              }}
            >
              <Glyph name="check" sizePx={iconPx.xs} tone={stateTreatments.approved.ink} />
            </span>
          ) : null}
        </span>
      </Tappable>
    );
  };

  const askRow = (ask: DogAsk) => {
    // Every eligible child is drawn, always, and each face answers only for that child. The
    // row is a LOG of who did it today, not a race one of them wins — see `dogAsks`.
    const spent = ask.faces.every((f) => f.done || f.inert);
    return (
      <div
        key={ask.choreId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: px(spacePx.sm),
          minHeight: px(tapPx.min),
          minWidth: 0,
        }}
      >
        <AssetImage asset={ask.icon} sizePx={iconPx.md} />
        <span style={{ flex: 1, minWidth: 0, ...text(fontSizePx.body, { muted: spent, wrap: true, lines: 2 }) }}>
          {ask.label}
        </span>
        {/* The faces ARE the "who did it" question, and all three are always asked. */}
        <div style={{ display: 'flex', gap: px(spacePx.tapGap), flex: '0 0 auto' }}>
          {ask.faces.map((f) =>
            face(
              f.childId,
              f.assignmentId,
              f.done,
              f.inert
                ? null
                : () => {
                    // One key per ROW, so two children tapping the same ask do not debounce
                    // each other — `choreKey` is per assignment, which is already per child.
                    gate.tap(choreKey(f.assignmentId), !f.done, () =>
                      f.done
                        ? actions.unclaimChore(f.assignmentId, f.childId)
                        : actions.claimChore(f.assignmentId, f.childId),
                    );
                  },
            ),
          )}
        </div>
      </div>
    );
  };

  const heading = (title: string, sub: string) => (
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={text(fontSizePx.body)}>{title}</span>
      <span style={text(fontSizePx.small, { muted: true })}>{sub}</span>
    </span>
  );

  const row = (deed: DogDeed) => {
    const done = deed.done;
    const key = deedKey(week.week, deed.id);
    return (
      <div
        key={deed.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: px(spacePx.sm),
          minHeight: px(tapPx.min),
          minWidth: 0,
        }}
      >
        <ToggleKey
          assigned={done}
          enabled={true}
          minTapPx={tapPx.min}
          onTap={() => {
            setTouchedAtMs(Date.now());
            gate.tap(key, !done, () => actions.setDogDeed(week.week, deed.id, !done));
          }}
        />
        <span
          aria-hidden="true"
          style={{
            fontSize: px(iconPx.md),
            lineHeight: cssTokens['--lh-tight'],
            flex: '0 0 auto',
            width: px(iconPx.md),
            textAlign: 'center',
          }}
        >
          {deed.emoji}
        </span>
        {/* Two lines before an ellipsis: a truncated deed is not a joke anybody can read. */}
        <span style={text(fontSizePx.body, { muted: done, wrap: true, lines: 2 })}>
          {deed.label}
        </span>
      </div>
    );
  };

  return (
    <div
      // The sheet sits ON the picture and leaves it showing round the edges.  Positioned and
      // stacked above the invisible doors, which are earlier siblings at auto z-index.
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: px(DOG_SHEET_WIDTH_PX),
        zIndex: 2,
        ...card({
          padding: px(spacePx.md),
          display: 'flex',
          flexDirection: 'column',
          gap: px(spacePx.sm),
        }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.sm) }}>
        <span aria-hidden="true" style={{ fontSize: px(iconPx.md), lineHeight: cssTokens['--lh-tight'] }}>
          🐾
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={text(fontSizePx.cardTitle)}>{dogTitle(name)}</span>
        </span>
        <Tappable
          enabled={true}
          onTap={onClose}
          style={tapTarget(tapPx.min, {
            width: px(tapPx.min),
            height: px(tapPx.min),
            padding: px(spacePx.none),
            background: colour.surfaceSunken,
            borderRadius: radius.md,
          })}
        >
          <Glyph name="cross" sizePx={fontSizePx.bodyLarge} tone={colour.ink} />
        </Tappable>
      </div>
      {/* Side by side, because stacked they were 625px on a 540px wall (see DOG_SHEET_WIDTH_PX). */}
      <div style={{ display: 'flex', gap: px(spacePx.md), alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: px(spacePx.sm) }}>
          {heading('Do this for me', askLine(asks))}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: px(spacePx.tapGap),
              // Four rows fit beside the deeds; a fifth ask scrolls rather than hides.
              maxHeight: px(DOG_ASKS_VISIBLE * tapPx.min + (DOG_ASKS_VISIBLE - 1) * spacePx.tapGap),
              overflowY: 'auto',
            }}
          >
            {asks.map(askRow)}
          </div>
        </div>
        <div
          style={{
            flex: `0 0 ${px(DOG_DEEDS_COLUMN_PX)}`,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: px(spacePx.sm),
          }}
        >
          {heading('What I did', line)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: px(spacePx.tapGap), minWidth: 0 }}>
            {shown.map(row)}
          </div>
        </div>
      </div>
    </div>
  );
}
