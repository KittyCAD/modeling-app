import { PATHS } from '@src/lib/paths'
import { defineAppNavigationIntent } from '@src/registry/contracts/appNavigation'
import { defineAppNavigationUrlContribution } from '@src/registry/contracts/appUrl'

export type SettingsOverlayTab = 'user' | 'project' | 'keybindings' | 'plugins'

export interface SettingsOverlayState {
  tab?: SettingsOverlayTab
  setting?: string
}

const isSettingsOverlayTab = (
  value: string | null
): value is SettingsOverlayTab =>
  value === 'user' ||
  value === 'project' ||
  value === 'keybindings' ||
  value === 'plugins'

function decodeHash(hash: string): string | undefined {
  if (!hash) {
    return undefined
  }

  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return undefined
  }
}

export const openSettingsIntent = defineAppNavigationIntent<
  SettingsOverlayState,
  void
>('settings.open')

export const settingsNavigationUrlContribution =
  defineAppNavigationUrlContribution(openSettingsIntent, {
    parse: ({ path, search, hash }) => {
      if (path !== PATHS.SETTINGS) {
        return undefined
      }

      const requestedTab = search.get('tab')
      const setting = decodeHash(hash)
      return {
        ...(isSettingsOverlayTab(requestedTab) ? { tab: requestedTab } : {}),
        ...(setting ? { setting } : {}),
      } satisfies SettingsOverlayState
    },
    format: (state: SettingsOverlayState) => ({
      path: PATHS.SETTINGS,
      search: state.tab ? `?tab=${state.tab}` : undefined,
      hash: state.setting ? `#${encodeURIComponent(state.setting)}` : undefined,
    }),
  })
