/**
 * Typed mirror of the token set in `tokens.css`.
 *
 * CSS remains the source of truth for values; this file is the source of truth
 * for token *names*. Anything that needs a token in TypeScript — the theme
 * service, a canvas renderer that has to hand real colours to WebGL, a chart —
 * goes through here so a rename is a type error rather than a silent blank.
 */

export const themeNames = ['dark', 'light'] as const
export type ThemeName = (typeof themeNames)[number]

/** Attribute the theme is published on, read by every token override block. */
export const themeAttribute = 'data-zds-theme'

/** Wrap a token name in `var()`. */
export function cssVar(token: string, fallback?: string): string {
  return fallback ? `var(${token}, ${fallback})` : `var(${token})`
}

/**
 * Resolve a token to a concrete value from the live cascade.
 *
 * Needed whenever a value has to leave CSS — engine clear colours, canvas
 * strokes, generated textures — since those consumers cannot read `var()`.
 */
export function resolveToken(
  token: string,
  element: Element = document.documentElement
): string {
  return getComputedStyle(element).getPropertyValue(token).trim()
}

const surface = {
  viewport: '--zds-surface-viewport',
  chassis: '--zds-surface-chassis',
  panel: '--zds-surface-panel',
  raised: '--zds-surface-raised',
  overlay: '--zds-surface-overlay',
  sunken: '--zds-surface-sunken',
  hover: '--zds-surface-hover',
  active: '--zds-surface-active',
  selected: '--zds-surface-selected',
  scrim: '--zds-surface-scrim',
} as const

const textColor = {
  primary: '--zds-text-primary',
  secondary: '--zds-text-secondary',
  tertiary: '--zds-text-tertiary',
  disabled: '--zds-text-disabled',
  inverse: '--zds-text-inverse',
  accent: '--zds-text-accent',
  fault: '--zds-text-fault',
  flag: '--zds-text-flag',
  datum: '--zds-text-datum',
} as const

const border = {
  subtle: '--zds-border-subtle',
  default: '--zds-border-default',
  strong: '--zds-border-strong',
  focus: '--zds-border-focus',
} as const

const status = {
  ok: '--zds-status-ok',
  warn: '--zds-status-warn',
  fault: '--zds-status-fault',
  idle: '--zds-status-idle',
} as const

const space = {
  0: '--zds-space-0',
  px: '--zds-space-px',
  '025': '--zds-space-025',
  '05': '--zds-space-05',
  1: '--zds-space-1',
  2: '--zds-space-2',
  3: '--zds-space-3',
  4: '--zds-space-4',
  5: '--zds-space-5',
  6: '--zds-space-6',
  8: '--zds-space-8',
  10: '--zds-space-10',
  12: '--zds-space-12',
  16: '--zds-space-16',
  20: '--zds-space-20',
  24: '--zds-space-24',
} as const

const fontSize = {
  micro: '--zds-font-size-micro',
  mini: '--zds-font-size-mini',
  small: '--zds-font-size-small',
  body: '--zds-font-size-body',
  large: '--zds-font-size-large',
  title: '--zds-font-size-title',
  display: '--zds-font-size-display',
  hero: '--zds-font-size-hero',
} as const

const radius = {
  chassis: '--zds-radius-chassis',
  content: '--zds-radius-content',
  contentLarge: '--zds-radius-content-lg',
  pill: '--zds-radius-pill',
} as const

const size = {
  topbar: '--zds-size-topbar',
  statusbar: '--zds-size-statusbar',
  rail: '--zds-size-rail',
  controlSmall: '--zds-size-control-sm',
  controlMedium: '--zds-size-control-md',
  controlLarge: '--zds-size-control-lg',
  iconSmall: '--zds-size-icon-sm',
  iconMedium: '--zds-size-icon-md',
  iconLarge: '--zds-size-icon-lg',
  datumStripe: '--zds-size-datum-stripe',
  hairline: '--zds-size-hairline',
} as const

const motion = {
  instant: '--zds-motion-instant',
  fast: '--zds-motion-fast',
  normal: '--zds-motion-normal',
  slow: '--zds-motion-slow',
  ease: '--zds-motion-ease',
  easeOut: '--zds-motion-ease-out',
} as const

const layer = {
  content: '--zds-z-content',
  rail: '--zds-z-rail',
  overlay: '--zds-z-overlay',
  popover: '--zds-z-popover',
  modal: '--zds-z-modal',
  toast: '--zds-z-toast',
  tooltip: '--zds-z-tooltip',
} as const

export const tokens = {
  surface,
  textColor,
  border,
  status,
  space,
  fontSize,
  radius,
  size,
  motion,
  layer,
  accent: '--zds-accent',
  accentMuted: '--zds-accent-muted',
  accentContrast: '--zds-accent-contrast',
  fontSans: '--zds-font-sans',
  fontMono: '--zds-font-mono',
} as const

export type TokenGroup = keyof typeof tokens
