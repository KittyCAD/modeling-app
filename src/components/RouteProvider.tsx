import { useEffect, useState, createContext, ReactNode } from 'react'
import {
  useNavigation,
  useLocation,
  useNavigate,
  useRouteLoaderData,
} from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { markOnce } from 'lib/performance'
import { useAuthNavigation } from 'hooks/useAuthNavigation'
import { useAuthState } from 'machines/appMachine'
import { IndexLoaderData } from 'lib/types'
import { getAppSettingsFilePath } from 'lib/desktop'
import { isDesktop } from 'lib/isDesktop'
import { trap } from 'lib/trap'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { loadAndValidateSettings } from 'lib/settings/settingsUtils'
import { settingsActor } from 'machines/appMachine'

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

  const authState = useAuthState()
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
  }, [navigation])

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
