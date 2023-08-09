import { Themes } from '../useStore'

export function getSystemTheme(): Exclude<Themes, 'system'> {
  return typeof window !== 'undefined' &&
    'matchMedia' in window &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? Themes.Dark
    : Themes.Light
}
