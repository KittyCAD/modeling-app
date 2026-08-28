import type { ThemeName } from '@kittycad/ui-kit/tokens'

export interface EngineColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * The engine takes colour channels as 0–1, not 0–255.
 *
 * Getting this wrong does not error: every channel saturates and the scene comes
 * back white.
 */
const channel = (value: number): number => value / 255

/**
 * The stream's background, per theme.
 *
 * The same two values the existing app uses, so a screenshot from either is the
 * same colour. They are deliberately *not* read from the design tokens: the
 * token surface is chosen for text contrast in a panel, while this sits behind
 * shaded geometry, and tying them together would mean a palette tweak silently
 * changing what renders.
 */
export function backgroundColorFor(theme: ThemeName): EngineColor {
  const level = theme === 'dark' ? 28 : 249
  return { r: channel(level), g: channel(level), b: channel(level), a: 1 }
}

/**
 * Colour for the engine's own overlay geometry — grid lines, axes, edges.
 *
 * The *opposite* theme's background, because these are drawn on top of the
 * background and need to contrast with it rather than match it.
 */
export function systemColorFor(theme: ThemeName): EngineColor {
  return backgroundColorFor(theme === 'dark' ? 'light' : 'dark')
}

/** Zoo's selection amber, shared with the existing app. */
export const SELECTION_COLOR: EngineColor = {
  r: channel(255),
  g: channel(183),
  b: channel(39),
  a: 1,
}

/** The same amber at 70%, for hover. */
export const HIGHLIGHT_COLOR: EngineColor = {
  r: channel(179),
  g: channel(128),
  b: channel(27),
  a: 1,
}

/**
 * Parse `#rgb` or `#rrggbb`.
 *
 * Returns null rather than a fallback colour: a caller that cannot read the
 * value should leave the engine's own default alone instead of quietly
 * substituting something else.
 */
export function parseHexColor(value: string): EngineColor | null {
  const hex = value.trim().replace(/^#/, '')
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => part + part)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null

  return {
    r: channel(Number.parseInt(expanded.slice(0, 2), 16)),
    g: channel(Number.parseInt(expanded.slice(2, 4), 16)),
    b: channel(Number.parseInt(expanded.slice(4, 6), 16)),
    a: 1,
  }
}
