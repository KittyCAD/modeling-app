import { AppTheme } from 'wasm-lib/kcl/bindings/AppTheme'

export enum Themes {
  Light = 'light',
  Dark = 'dark',
  System = 'system',
}

export function appThemeToTheme(theme: AppTheme | undefined): Themes {
  switch (theme) {
    case 'light':
      return Themes.Light
    case 'dark':
      return Themes.Dark
    case 'system':
      return Themes.System
    default:
      return Themes.System
  }
}

// Get the theme from the system settings manually
export function getSystemTheme(): Exclude<Themes, 'system'> {
  return typeof globalThis.window !== 'undefined' &&
    'matchMedia' in globalThis.window
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
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
