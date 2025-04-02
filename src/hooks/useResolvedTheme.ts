import { Themes, getSystemTheme } from '@src/lib/theme'
import { useSettings } from '@src/machines/appMachine'

/**
 * Resolves the current theme based on the theme setting
 * and the system theme if needed.
 * @returns {Themes.Light | Themes.Dark}
 */
export function useResolvedTheme() {
  const settings = useSettings()
  return settings.app.theme.current === Themes.System
    ? getSystemTheme()
    : settings.app.theme.current
}
