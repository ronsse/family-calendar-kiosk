/**
 * The grown-up Home — six tiles, and every one is a door (the admin mockups, private notes, B-2).
 *
 * What an adult wants from ninety seconds at the wall is the household at a glance — is anything
 * waiting, how far through the day are they, what is owed, are the calendars current, which
 * picture is up, what does the wall look like — and one tap to whichever of those needs them.
 * So each tile says one big thing and one small thing, and the WHOLE tile is the control: there
 * is no button inside a tile, because a 280px card with a 64px key in its corner is a card most
 * of whose area does nothing.
 *
 * The words are decided in logic/grownup.ts §10, where the tests drive them. This file lays them
 * out, fits each big line to its tile (`tileBigFit` — a picture's long title steps down a size
 * rather than ending in an ellipsis), and reads the one thing nothing else on Home needs: the
 * picture catalog, for the Picture tile.
 *
 * The Picture tile is the one door that leaves the portal's shell. The picture library is its own
 * destination with its own rules — putting a picture up asks for no PIN — so the tile hands the
 * wall to it rather than drawing it in here.
 *
 * The calendar tile has no Fetch key of its own, although the mock drew one: a key inside a tile
 * that is itself a key is two targets on one card, and the miss between them opens Settings. Fetch
 * now lives on the Settings screen, one tap away, beside the line that says whether it is needed.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Child } from '../../../../src/types.ts';
import type { ApprovalItem, HouseholdSettings, SceneCatalog } from '../../app/adminActions.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import {
  childAccentForSlot,
  colour,
  font,
  fontSizePx,
  fontWeight,
  iconPx,
  radius,
  spacePx,
  strokePx,
} from '../../design/tokens.ts';
import { useBandTypography } from '../bands/registry.tsx';
import type { GlyphName } from '../contract.ts';
import { AccentFrame, AssetImage } from '../primitives/AssetImage.tsx';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { useTextRoom } from '../primitives/useTextRoom.ts';
import { card, px, tapTarget, text } from '../primitives/style.ts';
import {
  HOME_TILE_GLYPHS,
  HOME_TILE_WORDS,
  TILE_BIG_SIZES_PX,
  calendarLine,
  homeTileDoorFor,
  homeTilesFor,
  moneyTile,
  sceneTile,
  settingsTile,
  tileBigFit,
  todayTile,
  waitingTile,
  type GrownupSection,
  type HomeTileId,
  type TileWords,
} from '../logic/grownup.ts';
import { avatarRef, orderedChildren } from '../logic/summary.ts';

const CALENDAR_LOADING: TileWords = { big: 'One moment', small: 'Reading the calendars' };
const CALENDAR_UNREADABLE: TileWords = { big: 'Could not read', small: 'Leave and come back in' };

/** The Picture tile's thumbnail: 16:9, like the picture, and short enough to share the title row. */
const THUMB_WIDTH_PX = 80;
const THUMB_HEIGHT_PX = 45;

/** A tile's face size: an adult's summary, not a child's door, so smaller than the rail's. */
const TILE_FACE_PX = iconPx.sm;

export interface GrownupHomeProps {
  /** The queue as the Waiting screen draws it — the same list, so the count cannot disagree. */
  items: readonly ApprovalItem[];
  /** Null while the portal's first read is away; the tiles that need it say so. */
  settings: HouseholdSettings | null;
  settingsFailed: boolean;
  onSection: (section: GrownupSection) => void;
  onPictures: () => void;
}

export function GrownupHome({ items, settings, settingsFailed, onSection, onPictures }: GrownupHomeProps) {
  const { snapshot, actions, clock, resetKey } = useWall();

  // The picture catalog, read the way the picture library reads it — through the wall's own port,
  // which carries the device token — and again on every snapshot, because approving a picture
  // anywhere changes which one is up.
  const [catalog, setCatalog] = useState<SceneCatalog | null>(null);
  useEffect(() => {
    let live = true;
    void actions.fetchScenes().then((got) => {
      if (live) setCatalog(got);
    });
    return () => {
      live = false;
    };
  }, [actions, resetKey]);

  const waiting = waitingTile(items);
  const calendar =
    settings === null
      ? { tone: 'idle' as const, ...(settingsFailed ? CALENDAR_UNREADABLE : CALENDAR_LOADING) }
      : (() => {
          const line = calendarLine(settings.calendar.sources, clock.nowMs);
          return { tone: line.tone, big: line.head, small: line.detail };
        })();

  const words: Record<HomeTileId, TileWords> = {
    waiting,
    today: todayTile(snapshot),
    money: moneyTile(snapshot, settings?.centsPerPoint ?? null),
    calendar,
    scene: sceneTile(catalog),
    settings: settingsTile(snapshot.theme, settings?.departures ?? null),
  };

  const active = catalog?.scenes.find((s) => s.id === catalog.activeSceneId) ?? null;
  const faces = orderedChildren(snapshot.children).filter((c) => waiting.childIds.includes(c.id));

  return (
    <div
      data-grownup-home=""
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
        gap: px(spacePx.tapGap),
        flex: 1,
        minHeight: 0,
      }}
    >
      {homeTilesFor(snapshot.household).map((id) => {
        const door = homeTileDoorFor(id, snapshot.household);
        // The calendar tile says trouble by its MARK as well as its words: the glyph turns to
        // the alert and takes the adult-only red, so a failing fetch reads from across the room.
        const trouble = id === 'calendar' && calendar.tone === 'trouble';
        const glyph: GlyphName = trouble ? 'alert' : id === 'calendar' && calendar.tone === 'busy' ? 'sync' : HOME_TILE_GLYPHS[id];
        return (
          <Tile
            key={id}
            id={id}
            glyph={glyph}
            glyphTone={trouble ? colour.danger : colour.ink}
            words={words[id]}
            onTap={() => {
              if (door.kind === 'section') onSection(door.section);
              else onPictures();
            }}
            corner={
              id === 'scene' && active !== null ? (
                <span
                  aria-hidden
                  style={{
                    width: px(THUMB_WIDTH_PX),
                    height: px(THUMB_HEIGHT_PX),
                    flex: '0 0 auto',
                    marginLeft: 'auto',
                    background: `url("${active.image}") center/cover`,
                    border: `${px(strokePx.min)} solid ${colour.borderStrong}`,
                    borderRadius: radius.sm,
                    boxSizing: 'border-box',
                  }}
                />
              ) : null
            }
          >
            {id === 'waiting' && faces.length > 0 ? <Faces faces={faces} /> : null}
          </Tile>
        );
      })}
    </div>
  );
}

/**
 * One tile: a title row (the mark, the word, and anything that rides in the corner), the big
 * line fitted to the tile, then the small line in up to three lines.
 */
function Tile({
  id,
  glyph,
  glyphTone,
  words,
  onTap,
  corner,
  children,
}: {
  id: HomeTileId;
  glyph: GlyphName;
  glyphTone: string;
  words: TileWords;
  onTap: () => void;
  corner: ReactNode;
  children: ReactNode;
}) {
  const TYPO = useBandTypography();
  const TITLE_TEXT = TYPO.primaryTextPx ?? fontSizePx.small;
  const { ref, room } = useTextRoom<HTMLSpanElement>(fontWeight.bold);
  const fit =
    room === null
      ? { words: words.big, sizePx: TILE_BIG_SIZES_PX[0] ?? fontSizePx.cardTitle }
      : tileBigFit(words.big, room.roomPx, room.measure);

  return (
    <Tappable
      enabled
      onTap={onTap}
      data={{ 'data-home-tile': id }}
      style={tapTarget(TYPO.minTapPx, {
        ...card({
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          gap: px(spacePx.xs),
          padding: px(spacePx.md),
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }),
      })}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: px(spacePx.xs), minWidth: 0, flex: '0 0 auto' }}>
        <Glyph name={glyph} sizePx={iconPx.xs} tone={glyphTone} />
        <span style={{ ...text(TITLE_TEXT), flex: '0 1 auto', minWidth: 0 }}>{HOME_TILE_WORDS[id]}</span>
        {corner}
      </span>
      {/*
        The big line is MEASURED in the face it is drawn in, so its family never changes with its
        size: the display face at every step, where `numeralText` would switch to the numeric face
        below 24 and the reading would be of a different typeface from the one on the glass.
      */}
      <span
        ref={ref}
        style={{
          ...text(fit.sizePx),
          fontFamily: font.display,
          display: 'block',
          width: '100%',
          flex: '0 0 auto',
        }}
      >
        {fit.words}
      </span>
      {children}
      {words.small.length === 0 ? null : (
        <span style={{ ...text(TITLE_TEXT, { muted: true, wrap: true, lines: 3 }), flex: '0 0 auto' }}>
          {words.small}
        </span>
      )}
    </Tappable>
  );
}

/** Whose things are waiting: each child's face once, in household order. */
function Faces({ faces }: { faces: readonly Child[] }) {
  const { layout } = useWallLayout();
  return (
    <span style={{ display: 'flex', gap: px(spacePx.xs), flex: '0 0 auto' }}>
      {faces.map((child) => (
        <AccentFrame
          key={child.id}
          accent={childAccentForSlot(child.sortOrder)}
          sizePx={TILE_FACE_PX}
          selected={false}
          shape={layout.faceFrame}
        >
          <AssetImage asset={avatarRef(child)} sizePx={TILE_FACE_PX} />
        </AccentFrame>
      ))}
    </span>
  );
}
