/**
 * Which STRUCTURE the wall is wearing, for the domain components that lay it out.
 *
 * `WallApp` resolves the household's theme to its `WallLayout` row and the current screen to a
 * `ShellGeometry` once per render, and provides both here. A component then asks "which rail?"
 * or "how tall is my pane?" — never "which theme?" — and the band leaves never ask at all: they
 * are handed the one or two forms they draw as props, like everything else they draw.
 *
 * The default is felt on a child's screen, so a component rendered outside `WallApp` draws the
 * household's default rather than throwing.
 */

import { createContext, useContext } from 'react';
import { shellGeometry, WALL_LAYOUTS, type ShellGeometry, type WallLayout } from '../views/logic/theme.ts';

export interface WallLayoutValue {
  readonly layout: WallLayout;
  /** This screen's shell: where the rail is, and the body it leaves. */
  readonly frame: ShellGeometry;
}

export const DEFAULT_WALL_LAYOUT: WallLayoutValue = {
  layout: WALL_LAYOUTS.felt,
  frame: shellGeometry(WALL_LAYOUTS.felt, false),
};

export const WallLayoutContext = createContext<WallLayoutValue>(DEFAULT_WALL_LAYOUT);

export function useWallLayout(): WallLayoutValue {
  return useContext(WallLayoutContext);
}
