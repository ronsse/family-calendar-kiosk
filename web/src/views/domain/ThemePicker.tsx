/**
 * The Theme picker: the wall's three looks, one tap each (2026-10-11).
 *
 * The household chose the felt board and asked to be able to switch, so this is the switch. It
 * heads the Settings pane behind the PIN, and a tap is a request like every other control on
 * this screen: the server stores the look, answers with the whole settings object, and pushes
 * the change to every screen — so the wall, and this very panel, change look the moment the
 * answer lands. Nothing is drawn optimistically; the ring moves when the server says so.
 *
 * ## What a card shows
 *
 * A MINIATURE of the look — its ground, one card in its card language (edge, corner, ledge),
 * and the three children's accents standing where that look puts the faces: along the bottom
 * for felt, on a plinth for gallery, on a dark spine for storybook. Then the name, and
 * "Default" under the one the household gets without choosing. Every value in the miniature
 * is that look's own (`themeSwatch`, logic/themePicker.ts says why it cannot be `var()`), while
 * the card around it is drawn in the CURRENT look like the rest of the screen.
 *
 * The chosen look gets the heavy ink ring and a check: weight and a shape, never colour alone,
 * on a panel that is 225 nits behind etched glass. The names stay in this screen's own face —
 * storybook's display face is never set under 24px, and a name at 24 does not fit a third of
 * the pane beside its miniature.
 *
 * It sits in the first row of Settings, inside the row edge every portal row wears
 * (`SettingsPanel`), and the grown-up screens around it follow the October 2026 portal layout
 * (the admin mockups (private notes)) in whichever look is chosen.
 */

import type { WallThemeId } from '../../../../src/types.ts';
import { colour, iconPx, radius, spacePx, strokePx, tapPx } from '../../design/tokens.ts';
import { Glyph } from '../primitives/Glyph.tsx';
import { Tappable } from '../primitives/Tappable.tsx';
import { card, px, tapTarget, text } from '../primitives/style.ts';
import { themeOptions, type ThemeOption, type ThemeSwatch } from '../logic/themePicker.ts';

const HEADING_WORD = 'Wall theme';
const DEFAULT_WORD = 'Default';

/** The miniature: a large tap target wide, the tap floor tall. */
const THUMB_W = tapPx.lg;
const THUMB_H = tapPx.min;
/** The miniature's rail, and a face standing on it. Schematic, not to scale: at a tenth of the glass a face would be a pixel. */
const MINI_RAIL_PX = spacePx.md + spacePx.xxs;
const MINI_FACE_PX = spacePx.sm;

export function ThemePicker({
  theme,
  busy,
  onTheme,
  primaryTextPx,
  secondaryTextPx,
  minTapPx,
}: {
  /** What the settings response says the wall wears. Anything that is not a look is felt. */
  theme: unknown;
  busy: boolean;
  onTheme: (theme: WallThemeId) => void;
  primaryTextPx: number;
  secondaryTextPx: number;
  minTapPx: number;
}) {
  const options = themeOptions(theme, busy);
  return (
    <section
      data-theme-picker=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(spacePx.xs),
        flex: '0 0 auto',
        minWidth: 0,
      }}
    >
      <span style={text(secondaryTextPx)}>{HEADING_WORD}</span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${String(options.length)}, minmax(0, 1fr))`,
          gap: px(spacePx.tapGap),
          minWidth: 0,
        }}
      >
        {options.map((option) => (
          <ThemeCard
            key={option.theme}
            option={option}
            onPick={onTheme}
            primaryTextPx={primaryTextPx}
            secondaryTextPx={secondaryTextPx}
            minTapPx={minTapPx}
          />
        ))}
      </div>
    </section>
  );
}

function ThemeCard({
  option,
  onPick,
  primaryTextPx,
  secondaryTextPx,
  minTapPx,
}: {
  option: ThemeOption;
  onPick: (theme: WallThemeId) => void;
  primaryTextPx: number;
  secondaryTextPx: number;
  minTapPx: number;
}) {
  return (
    // `data-theme-option` and `data-selected` are for the panel audit and a CDP probe, which
    // have no other way to tell three buttons apart from outside.
    <div
      data-theme-option={option.theme}
      data-selected={option.selected ? 'true' : 'false'}
      style={{ display: 'flex', minWidth: 0 }}
    >
      <Tappable
        enabled={option.live}
        onTap={() => {
          onPick(option.theme);
        }}
        style={tapTarget(
          minTapPx,
          card({
            flex: 1,
            justifyContent: 'flex-start',
            gap: px(spacePx.sm),
            padding: px(spacePx.xs),
            // The ring is drawn INSIDE the card's own edge, so choosing a look moves nothing and
            // the scroll box cannot clip it. The card keeps its edge either way.
            ...(option.selected
              ? {
                  outline: `${px(strokePx.focus)} solid ${colour.ink}`,
                  outlineOffset: px(-strokePx.focus),
                }
              : {}),
          }),
        )}
      >
        <span style={{ position: 'relative', display: 'block', flex: '0 0 auto' }}>
          <Miniature swatch={option.swatch} />
          {option.selected ? <ChosenBadge /> : null}
        </span>
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: px(spacePx.xxs),
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ ...text(primaryTextPx), maxWidth: '100%' }}>{option.name}</span>
          {option.isDefault ? (
            <span
              style={{
                ...text(secondaryTextPx),
                padding: `${px(spacePx.none)} ${px(spacePx.xs)}`,
                background: colour.surfaceSunken,
                border: `${px(strokePx.min)} solid ${colour.border}`,
                borderRadius: radius.pill,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              {DEFAULT_WORD}
            </span>
          ) : null}
        </span>
      </Tappable>
    </div>
  );
}

/** The look in miniature: its ground, its faces where it stands them, and one of its cards. */
function Miniature({ swatch }: { swatch: ThemeSwatch }) {
  const side = swatch.rail !== 'bottom';
  return (
    <span
      style={{
        display: 'flex',
        // Felt's faces stand along the bottom; the other two looks put them in a column on the left.
        flexDirection: side ? 'row' : 'column-reverse',
        width: px(THUMB_W),
        height: px(THUMB_H),
        background: swatch.ground,
        backgroundImage: swatch.groundTexture,
        backgroundSize: swatch.groundTextureSize,
        // The miniature's own frame is THIS screen's edge: it is a picture sitting on this page.
        border: `${px(strokePx.min)} solid ${colour.border}`,
        borderRadius: radius.sm,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: side ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: side ? 'center' : 'flex-start',
          gap: px(spacePx.xxs),
          flex: '0 0 auto',
          width: side ? px(MINI_RAIL_PX) : undefined,
          height: side ? undefined : px(MINI_RAIL_PX),
          paddingLeft: side ? undefined : px(spacePx.xs),
          background: swatch.railFill ?? 'transparent',
          borderRight:
            swatch.railEdge === null ? undefined : `${px(strokePx.min)} solid ${swatch.railEdge}`,
          boxSizing: 'border-box',
        }}
      >
        {swatch.accents.map((accent, slot) => (
          <span
            key={slot}
            style={{
              display: 'block',
              flex: '0 0 auto',
              width: px(MINI_FACE_PX),
              height: px(MINI_FACE_PX),
              background: accent,
              border: `${px(strokePx.min)} solid ${swatch.card}`,
              borderRadius: swatch.faceFrame === 'round' ? '50%' : px(spacePx.none),
              boxSizing: 'border-box',
            }}
          />
        ))}
      </span>
      <span
        style={{
          display: 'flex',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          padding: px(spacePx.xs),
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            display: 'block',
            flex: 1,
            background: swatch.card,
            border: `${swatch.cardEdgeWidth} solid ${swatch.cardEdge}`,
            borderRadius: swatch.cardCorner,
            boxShadow: swatch.cardShadow,
            boxSizing: 'border-box',
          }}
        />
      </span>
    </span>
  );
}

/** The check on the chosen look's miniature: an ink disc with the inverse tick, on a paper ring. */
function ChosenBadge() {
  return (
    <span
      style={{
        position: 'absolute',
        top: px(-spacePx.xxs),
        right: px(-spacePx.xs),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px(iconPx.xs),
        height: px(iconPx.xs),
        background: colour.ink,
        border: `${px(strokePx.min)} solid ${colour.surface}`,
        borderRadius: '50%',
        boxSizing: 'border-box',
      }}
    >
      <Glyph name="check" sizePx={iconPx.xs - 2 * strokePx.min} tone={colour.inkInverse} />
    </span>
  );
}
