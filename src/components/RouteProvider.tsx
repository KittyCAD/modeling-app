import type { ReactNode } from 'react'
import { createContext, useEffect, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useNavigation,
  useRouteLoaderData,
} from 'react-router-dom'

import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'

import { useAuthNavigation } from '@src/hooks/useAuthNavigation'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { trap } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import { settingsActor, useSettings } from '@src/lib/singletons'

export const RouteProviderContext = createContext({})

export function RouteProvider({ children }: { children: ReactNode }) {
  useAuthNavigation()
  const loadedProject = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const [first, setFirstState] = useState(true)
  const [settingsPath, setSettingsPath] = useState<string | undefined>(
    undefined
  )
  const navigation = useNavigation()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // On initialization, the react-router-dom does not send a 'loading' state event.
    // it sends an idle event first.
    const pathname = first ? location.pathname : navigation.location?.pathname
    const isHome = pathname === PATHS.HOME
    const isFile =
      pathname?.includes(PATHS.FILE) &&
      pathname?.substring(pathname?.length - 4) === '.kcl'
    if (isHome) {
      markOnce('code/willLoadHome')
    } else if (isFile) {
      markOnce('code/willLoadFile')
    }
    setFirstState(false)
  }, [first, navigation, location.pathname])

  useEffect(() => {
    if (!isDesktop()) return
    getAppSettingsFilePath().then(setSettingsPath).catch(trap)
  }, [])

  useFileSystemWatcher(
    async (eventType: string) => {
      // If there is a projectPath but it no longer exists it means
      // it was exterally removed. If we let the code past this condition
      // execute it will recreate the directory due to code in
      // loadAndValidateSettings trying to recreate files. I do not
      // wish to change the behavior in case anything else uses it.
      // Go home.
      if (loadedProject?.project?.path) {
        if (!window.electron.exists(loadedProject?.project?.path)) {
          navigate(PATHS.HOME)
          return
        }
      }

      // Only reload if there are changes. Ignore everything else.
      if (eventType !== 'change') return

      const data = await loadAndValidateSettings(loadedProject?.project?.path)
      settingsActor.send({
        type: 'Set all settings',
        settings: data.settings,
        doNotPersist: true,
      })
    },
    [settingsPath, loadedProject?.project?.path].filter(
      (x: string | undefined) => x !== undefined
    )
  )

  return (
    <RouteProviderContext.Provider value={{}}>
      {children}
    </RouteProviderContext.Provider>
  )
}
