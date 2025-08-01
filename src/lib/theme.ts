import type { AppTheme } from '@rust/kcl-lib/bindings/AppTheme'
import { converter } from 'culori'

/** A media query matcher for dark mode */
export const darkModeMatcher =
  (typeof globalThis.window !== 'undefined' &&
    'matchMedia' in globalThis.window &&
    globalThis.window.matchMedia('(prefers-color-scheme: dark)')) ||
  undefined

export enum Themes {
  Light = 'light',
  Dark = 'dark',
  System = 'system',
}

export function appThemeToTheme(
  theme: AppTheme | undefined
): Themes | undefined {
  switch (theme) {
    case 'light':
      return Themes.Light
    case 'dark':
      return Themes.Dark
    case 'system':
      return Themes.System
    default:
      return undefined
  }
}

// Get the theme from the system settings manually
export function getSystemTheme(): Exclude<Themes, 'system'> {
  return typeof globalThis.window !== 'undefined' &&
    'matchMedia' in globalThis.window
    ? darkModeMatcher?.matches
      ? Themes.Dark
      : Themes.Light
    : Themes.Light
}

// Set the theme class on the body element
export function setThemeClass(theme: Themes) {
  if (theme === Themes.Dark) {
    document.body.classList.add('dark')
  } else {
    document.body.classList.remove('dark')
  }
}

// Returns the resolved theme in use (Dark || Light)
export function getResolvedTheme(theme: Themes) {
  return theme === Themes.System ? getSystemTheme() : theme
}

// Returns the opposing theme
export function getOppositeTheme(theme: Themes) {
  const resolvedTheme = getResolvedTheme(theme)
  return resolvedTheme === Themes.Dark ? Themes.Light : Themes.Dark
}

/**
 * Converts OKLCH values to RGB using Culori library
 * @param l - Lightness (0-1)
 * @param c - Chroma (0-1)
 * @param h - Hue (0-360 degrees)
 * @returns RGB values as [r, g, b] where each component is 0-255
 */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  // Create a converter from OKLCH to RGB using Culori
  const toRgb = converter('rgb')

  // Convert OKLCH to RGB using Culori
  const rgb = toRgb({ mode: 'oklch', l, c, h })

  if (!rgb) {
    // Fallback if conversion fails
    return [255, 255, 255]
  }

  // Clamp values. When OKLCH values represent colors outside the sRGB gamut, the RGB values can be negative or greater than 1.
  const clampedR = Math.max(0, Math.min(1, rgb.r))
  const clampedG = Math.max(0, Math.min(1, rgb.g))
  const clampedB = Math.max(0, Math.min(1, rgb.b))

  // Convert from 0-1 range to 0-255 range
  return [
    Math.round(clampedR * 255),
    Math.round(clampedG * 255),
    Math.round(clampedB * 255),
  ]
}

/**
 * Gets the primary color from CSS custom properties and converts it to Three.js hex format
 * @returns Primary color as a hex number for Three.js, or fallback purple if unable to get CSS value
 */
export function getPrimaryColorForThreeJs(): number {
  if (typeof globalThis.window === 'undefined' || !globalThis.document) {
    // Fallback for SSR or when DOM is not available
    return 0x7c3aed // Default purple
  }

  try {
    const computedStyle = getComputedStyle(document.documentElement)

    // Get the individual primary color components
    const hue = parseFloat(
      computedStyle.getPropertyValue('--primary-hue').trim()
    )
    const chroma = parseFloat(
      computedStyle.getPropertyValue('--primary-chroma').trim()
    )
    const lightness =
      parseFloat(
        computedStyle
          .getPropertyValue('--primary-lightness')
          .replace('%', '')
          .trim()
      ) / 100

    if (Number.isNaN(hue) || Number.isNaN(chroma) || Number.isNaN(lightness)) {
      console.warn(
        'Unable to parse primary color components from CSS, using fallback'
      )
      return 0x7c3aed // Default purple
    }

    // Convert OKLCH to RGB
    const [r, g, b] = oklchToRgb(lightness, chroma, hue)

    // Convert RGB to hex
    return (r << 16) | (g << 8) | b
  } catch (error) {
    console.warn('Error getting primary color from CSS:', error)
    return 0x7c3aed // Default purple fallback
  }
}

/**
 * The engine takes RGBA values from 0-1
 * So we convert from the conventional 0-255 found in Figma
 * @param theme
 * @returns { r: number, g: number, b: number, a: number }
 */
export function getThemeColorForEngine(theme: Themes) {
  const resolvedTheme = getResolvedTheme(theme)
  const dark = 28 / 255
  const light = 249 / 255
  return resolvedTheme === Themes.Dark
    ? { r: dark, g: dark, b: dark, a: 1 }
    : { r: light, g: light, b: light, a: 1 }
}

/**
 * ThreeJS uses hex values for colors
 * @param theme
 * @returns
 */
export function getThemeColorForThreeJs(theme: Themes) {
  const resolvedTheme = getResolvedTheme(theme)
  const dark = 0x1c1c1c
  const light = 0xf9f9f9
  return resolvedTheme === Themes.Dark ? dark : light
}
