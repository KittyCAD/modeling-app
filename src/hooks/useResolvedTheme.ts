import { useSingletons } from '@src/lib/singletons'
import { Themes, getSystemTheme } from '@src/lib/theme'

/**
 * Resolves the current theme based on the theme setting
 * and the system theme if needed.
 * @returns {Themes.Light | Themes.Dark}
 */
export function useResolvedTheme() {
  const { useSettings } = useSingletons()
  const settings = useSettings()
  return settings.app.theme.current === Themes.System
    ? getSystemTheme()
    : settings.app.theme.current
}
