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
import { useAuthState, useSettings } from 'machines/appMachine'
import { IndexLoaderData } from 'lib/types'
import { getAppSettingsFilePath } from 'lib/desktop'
import { isDesktop } from 'lib/isDesktop'
import { trap } from 'lib/trap'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { loadAndValidateSettings } from 'lib/settings/settingsUtils'
import { settingsActor } from 'machines/appMachine'
import { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'

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
  const settings = useSettings()

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

      /**
       * TODO: Move to XState. This block has been moved from routerLoaders
       * and is borrowing the `isFile` logic from the rest of this
       * telemetry-focused `useEffect`. Once `appMachine` knows about
       * the current route and navigation, this can be moved into settingsMachine
       * to fire as soon as the user settings have been read.
       */
      const onboardingStatus: OnboardingStatus =
        settings.app.onboardingStatus.current || ''
      // '' is the initial state, 'completed' and 'dismissed' are the final states
      const needsToOnboard =
        onboardingStatus.length === 0 ||
        !(onboardingStatus === 'completed' || onboardingStatus === 'dismissed')
      const shouldRedirectToOnboarding = isFile && needsToOnboard

      if (
        shouldRedirectToOnboarding &&
        settingsActor.getSnapshot().matches('idle')
      ) {
        navigate(
          (first ? location.pathname : navigation.location?.pathname) +
            PATHS.ONBOARDING.INDEX +
            onboardingStatus.slice(1)
        )
      }
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
