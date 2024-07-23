import { App } from './App'
import {
  createBrowserRouter,
  Outlet,
  redirect,
  RouterProvider,
} from 'react-router-dom'
import { ErrorPage } from './components/ErrorPage'
import { Settings } from './routes/Settings'
import Onboarding, { onboardingRoutes } from './routes/Onboarding'
import SignIn from './routes/SignIn'
import { Auth } from './Auth'
import { isDesktop } from './lib/isDesktop'
import Home from './routes/Home'
import { NetworkContext } from './hooks/useNetworkContext'
import { useNetworkStatus } from './hooks/useNetworkStatus'
import makeUrlPathRelative from './lib/makeUrlPathRelative'
import DownloadAppBanner from 'components/DownloadAppBanner'
import { WasmErrBanner } from 'components/WasmErrBanner'
import { CommandBar } from 'components/CommandBar/CommandBar'
import ModelingMachineProvider from 'components/ModelingMachineProvider'
import FileMachineProvider from 'components/FileMachineProvider'
import { paths } from 'lib/paths'
import {
  fileLoader,
  homeLoader,
  onboardingRedirectLoader,
  settingsLoader,
} from 'lib/routeLoaders'
import { CommandBarProvider } from 'components/CommandBar/CommandBarProvider'
import SettingsAuthProvider from 'components/SettingsAuthProvider'
import LspProvider from 'components/LspProvider'
import { KclContextProvider } from 'lang/KclProvider'
import { BROWSER_PROJECT_NAME } from 'lib/constants'
import { getState, setState } from 'lib/desktop'
import { CoreDumpManager } from 'lib/coredump'
import { engineCommandManager } from 'lib/singletons'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import toast from 'react-hot-toast'
import { coreDump } from 'lang/wasm'
import { useMemo } from 'react'
import { AppStateProvider } from 'AppState'

const router = createBrowserRouter([
  {
    loader: settingsLoader,
    id: paths.INDEX,
    /* Make sure auth is the outermost provider or else we will have
     * inefficient re-renders, use the react profiler to see. */
    element: (
      <CommandBarProvider>
        <SettingsAuthProvider>
          <LspProvider>
            <KclContextProvider>
              <AppStateProvider>
                <Outlet />
              </AppStateProvider>
            </KclContextProvider>
          </LspProvider>
        </SettingsAuthProvider>
      </CommandBarProvider>
    ),
    errorElement: <ErrorPage />,
    children: [
      {
        path: paths.INDEX,
        loader: async () => {
          const onDesktop = isDesktop()
          if (onDesktop) {
            const appState = await getState()

            if (appState) {
              // Reset the state.
              // We do this so that we load the initial state from the cli but everything
              // else we can ignore.
              await setState(undefined)
              // Redirect to the file if we have a file path.
              if (appState.current_file) {
                return redirect(
                  paths.FILE + '/' + encodeURIComponent(appState.current_file)
                )
              }
            }
          }

          return onDesktop
            ? redirect(paths.HOME)
            : redirect(paths.FILE + '/%2F' + BROWSER_PROJECT_NAME)
        },
      },
      {
        loader: fileLoader,
        id: paths.FILE,
        path: paths.FILE + '/:id',
        element: (
          <Auth>
            <FileMachineProvider>
              <ModelingMachineProvider>
                <CoreDump />
                <Outlet />
                <App />
                <CommandBar />
                {!isDesktop() && import.meta.env.PROD && <DownloadAppBanner />}
              </ModelingMachineProvider>
              <WasmErrBanner />
            </FileMachineProvider>
          </Auth>
        ),
        children: [
          {
            id: paths.FILE + 'SETTINGS',
            loader: settingsLoader,
            children: [
              {
                loader: onboardingRedirectLoader,
                index: true,
                element: <></>,
              },
              {
                path: makeUrlPathRelative(paths.SETTINGS),
                element: <Settings />,
              },
              {
                path: makeUrlPathRelative(paths.ONBOARDING.INDEX),
                element: <Onboarding />,
                children: onboardingRoutes,
              },
            ],
          },
        ],
      },
      {
        path: paths.HOME,
        element: (
          <Auth>
            <Outlet />
            <Home />
            <CommandBar />
          </Auth>
        ),
        id: paths.HOME,
        loader: homeLoader,
        children: [
          {
            index: true,
            element: <></>,
            id: paths.HOME + 'SETTINGS',
            loader: settingsLoader,
          },
          {
            path: makeUrlPathRelative(paths.SETTINGS),
            loader: settingsLoader,
            element: <Settings />,
          },
        ],
      },
      {
        path: paths.SIGN_IN,
        element: <SignIn />,
      },
    ],
  },
])

/**
 * All routes in the app, used in src/index.tsx
 * @returns RouterProvider
 */
export const Router = () => {
  const networkStatus = useNetworkStatus()

  return (
    <NetworkContext.Provider value={networkStatus}>
      <RouterProvider router={router} />
    </NetworkContext.Provider>
  )
}

function CoreDump() {
  const { auth } = useSettingsAuthContext()
  const token = auth?.context?.token
  const coreDumpManager = useMemo(
    () => new CoreDumpManager(engineCommandManager, token),
    []
  )
  useHotkeyWrapper(['meta + shift + .'], () => {
    toast.promise(
      coreDump(coreDumpManager, true),
      {
        loading: 'Starting core dump...',
        success: 'Core dump completed successfully',
        error: 'Error while exporting core dump',
      },
      {
        success: {
          // Note: this extended duration is especially important for Playwright e2e testing
          // default duration is 2000 - https://react-hot-toast.com/docs/toast#default-durations
          duration: 6000,
        },
      }
    )
  })
  return null
}
