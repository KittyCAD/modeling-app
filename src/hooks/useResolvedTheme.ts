import { Themes, getSystemTheme } from 'lib/theme'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'

/**
 * Resolves the current theme based on the theme setting
 * and the system theme if needed.
 * @returns {Themes.Light | Themes.Dark}
 */
export function useResolvedTheme() {
  const {
    settings: { context },
  } = useSettingsAuthContext()
  return context.app.appearance.theme.current === Themes.System
    ? getSystemTheme()
    : context.app.appearance.theme.current
}
