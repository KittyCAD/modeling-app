import { App } from './App'
import {
  createBrowserRouter,
  createHashRouter,
  Outlet,
  redirect,
  RouterProvider,
} from 'react-router-dom'
import { ErrorPage } from './components/ErrorPage'
import { Settings } from './routes/Settings'
import { Telemetry } from './routes/Telemetry'
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
import { MachineManagerProvider } from 'components/MachineManagerProvider'
import { PATHS } from 'lib/paths'
import { fileLoader, homeLoader, telemetryLoader } from 'lib/routeLoaders'
import LspProvider from 'components/LspProvider'
import { KclContextProvider } from 'lang/KclProvider'
import { ASK_TO_OPEN_QUERY_PARAM, BROWSER_PROJECT_NAME } from 'lib/constants'
import { CoreDumpManager } from 'lib/coredump'
import { codeManager, engineCommandManager } from 'lib/singletons'
import useHotkeyWrapper from 'lib/hotkeyWrapper'
import toast from 'react-hot-toast'
import { coreDump } from 'lang/wasm'
import { useMemo } from 'react'
import { AppStateProvider } from 'AppState'
import { reportRejection } from 'lib/trap'
import { RouteProvider } from 'components/RouteProvider'
import { ProjectsContextProvider } from 'components/ProjectsContextProvider'
import { useToken } from 'machines/appMachine'
import { OpenInDesktopAppHandler } from 'components/OpenInDesktopAppHandler'
import { rustContext } from 'lib/singletons'

const createRouter = isDesktop() ? createHashRouter : createBrowserRouter

const router = createRouter([
  {
    id: PATHS.INDEX,
    element: (
      <OpenInDesktopAppHandler>
        <RouteProvider>
          <LspProvider>
            <ProjectsContextProvider>
              <KclContextProvider>
                <AppStateProvider>
                  <MachineManagerProvider>
                    <Outlet />
                  </MachineManagerProvider>
                </AppStateProvider>
              </KclContextProvider>
            </ProjectsContextProvider>
          </LspProvider>
        </RouteProvider>
      </OpenInDesktopAppHandler>
    ),
    errorElement: <ErrorPage />,
    children: [
      {
        path: PATHS.INDEX,
        loader: async ({ request }) => {
          const onDesktop = isDesktop()
          const url = new URL(request.url)
          if (onDesktop) {
            return redirect(PATHS.HOME + (url.search || ''))
          } else {
            const searchParams = new URLSearchParams(url.search)
            if (!searchParams.has(ASK_TO_OPEN_QUERY_PARAM)) {
              return redirect(
                PATHS.FILE + '/%2F' + BROWSER_PROJECT_NAME + (url.search || '')
              )
            }
          }
          return null
        },
      },
      {
        loader: fileLoader,
        id: PATHS.FILE,
        path: PATHS.FILE + '/:id',
        element: (
          <Auth>
            <FileMachineProvider>
              <ModelingMachineProvider>
                <CoreDump />
                <Outlet />
                <App />
                <CommandBar />
                {
                  // @ts-ignore
                  !isDesktop() && import.meta.env.PROD && <DownloadAppBanner />
                }
              </ModelingMachineProvider>
              <WasmErrBanner />
            </FileMachineProvider>
          </Auth>
        ),
        children: [
          {
            id: PATHS.FILE + 'SETTINGS',
            children: [
              {
                path: makeUrlPathRelative(PATHS.SETTINGS),
                element: <Settings />,
              },
              {
                path: makeUrlPathRelative(PATHS.ONBOARDING.INDEX),
                element: <Onboarding />,
                children: onboardingRoutes,
              },
            ],
          },
          {
            id: PATHS.FILE + 'TELEMETRY',
            loader: telemetryLoader,
            children: [
              {
                path: makeUrlPathRelative(PATHS.TELEMETRY),
                element: <Telemetry />,
              },
            ],
          },
        ],
      },
      {
        path: PATHS.HOME,
        element: (
          <Auth>
            <Outlet />
            <Home />
            <CommandBar />
          </Auth>
        ),
        id: PATHS.HOME,
        loader: homeLoader,
        children: [
          {
            index: true,
            element: <></>,
            id: PATHS.HOME + 'SETTINGS',
          },
          {
            path: makeUrlPathRelative(PATHS.SETTINGS),
            element: <Settings />,
          },
          {
            path: makeUrlPathRelative(PATHS.TELEMETRY),
            loader: telemetryLoader,
            element: <Telemetry />,
          },
        ],
      },
      {
        path: PATHS.SIGN_IN,
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
  const token = useToken()
  const coreDumpManager = useMemo(
    () =>
      new CoreDumpManager(
        engineCommandManager,
        codeManager,
        rustContext,
        token
      ),
    []
  )
  useHotkeyWrapper(['mod + shift + .'], () => {
    toast
      .promise(
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
      .catch(reportRejection)
  })
  return null
}
