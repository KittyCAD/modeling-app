import { useRouteLoaderData } from 'react-router-dom'
import { useSettingsAuthContext } from './useSettingsAuthContext'
import { PATHS } from 'lib/paths'
import { settings } from 'lib/settings/initialSettings'
import { useEffect } from 'react'

/**
 * I was dismayed to learn that index route in Router.tsx where we initially load up the settings
 * doesn't re-run on subsequent navigations. This hook is a workaround,
 * in conjunction with additional uses of settingsLoader further down the router tree.
 * @param routeId - The id defined in Router.tsx to load the settings from.
 */
export function useRefreshSettings(routeId: string = PATHS.INDEX) {
  const ctx = useSettingsAuthContext()
  const routeData = useRouteLoaderData(routeId) as typeof settings

  if (!ctx) {
    // Intended to stop the world
    // eslint-disable-next-line
    throw new Error(
      'useRefreshSettings must be used within a SettingsAuthProvider'
    )
  }

  useEffect(() => {
    ctx.settings.send({
      type: 'Set all settings',
      settings: routeData,
      doNotPersist: true,
    })
  }, [])
}
