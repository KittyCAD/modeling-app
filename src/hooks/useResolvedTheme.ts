import { Themes, getSystemTheme } from 'lib/theme'
import { useSettings } from 'machines/appMachine'

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
