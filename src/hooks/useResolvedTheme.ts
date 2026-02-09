import { useApp } from '@src/lib/boot'
import { Themes, getSystemTheme } from '@src/lib/theme'

/**
 * Resolves the current theme based on the theme setting
 * and the system theme if needed.
 * @returns {Themes.Light | Themes.Dark}
 */
export function useResolvedTheme() {
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  return settingsValues.app.theme.current === Themes.System
    ? getSystemTheme()
    : settingsValues.app.theme.current
}
