import { useMemo } from 'react'
import toast from 'react-hot-toast'
import {
  Outlet,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  redirect,
} from 'react-router-dom'

import { App } from '@src/App'
import { AppStateProvider } from '@src/AppState'
import { Auth } from '@src/Auth'
import { CommandBar } from '@src/components/CommandBar/CommandBar'
import DownloadAppBanner from '@src/components/DownloadAppBanner'
import { ErrorPage } from '@src/components/ErrorPage'
import FileMachineProvider from '@src/components/FileMachineProvider'
import LspProvider from '@src/components/LspProvider'
import { MachineManagerProvider } from '@src/components/MachineManagerProvider'
import ModelingMachineProvider from '@src/components/ModelingMachineProvider'
import { OpenInDesktopAppHandler } from '@src/components/OpenInDesktopAppHandler'
import { ProjectsContextProvider } from '@src/components/ProjectsContextProvider'
import { RouteProvider } from '@src/components/RouteProvider'
import { WasmErrBanner } from '@src/components/WasmErrBanner'
import { NetworkContext } from '@src/hooks/useNetworkContext'
import { useNetworkStatus } from '@src/hooks/useNetworkStatus'
import { KclContextProvider } from '@src/lang/KclProvider'
import { coreDump } from '@src/lang/wasm'
import {
  ASK_TO_OPEN_QUERY_PARAM,
  BROWSER_PROJECT_NAME,
} from '@src/lib/constants'
import { CoreDumpManager } from '@src/lib/coredump'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS } from '@src/lib/paths'
import { fileLoader, homeLoader, telemetryLoader } from '@src/lib/routeLoaders'
import {
  codeManager,
  engineCommandManager,
  rustContext,
} from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { useToken } from '@src/machines/appMachine'
import Home from '@src/routes/Home'
import Onboarding, { onboardingRoutes } from '@src/routes/Onboarding'
import { Settings } from '@src/routes/Settings'
import SignIn from '@src/routes/SignIn'
import { Telemetry } from '@src/routes/Telemetry'

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
