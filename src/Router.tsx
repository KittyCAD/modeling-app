import { Suspense, useMemo } from 'react'
import toast from 'react-hot-toast'
import {
  Outlet,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
} from 'react-router-dom'
import { OpenedProject } from '@src/components/OpenedProject'
import RootLayout from '@src/Root'
import { CommandBar } from '@src/components/CommandBar/CommandBar'
import { ErrorPage } from '@src/components/ErrorPage'
import ModelingMachineProvider from '@src/components/ModelingMachineProvider'
import ModelingPageProvider from '@src/components/ModelingPageProvider'
import { NetworkContext } from '@src/hooks/useNetworkContext'
import { useNetworkStatus } from '@src/hooks/useNetworkStatus'
import { coreDump } from '@src/lang/wasm'
import { CoreDumpManager } from '@src/lib/coredump'
import useHotkeyWrapper from '@src/lib/hotkeyWrapper'
import { isDesktop } from '@src/lib/isDesktop'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS } from '@src/lib/paths'
import { baseLoader, fileLoader, homeLoader } from '@src/lib/routeLoaders'
import { useApp, useSingletons } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import Home from '@src/routes/Home'
import { OnboardingRootRoute, onboardingRoutes } from '@src/routes/Onboarding'
import { Settings } from '@src/routes/Settings'
import SignIn from '@src/routes/SignIn'
import { Telemetry } from '@src/routes/Telemetry'
import { TestLayout } from '@src/lib/layout/TestLayout'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import Loading from '@src/components/Loading'

const createRouter = isDesktop() ? createHashRouter : createBrowserRouter

/**
 * All routes in the app, used in src/lib/index.tsx
 * @returns RouterProvider
 */
export const Router = () => {
  const app = useApp()
  const { engineCommandManager } = useSingletons()
  const networkStatus = useNetworkStatus(engineCommandManager)
  const router = useMemo(
    () =>
      createRouter([
        {
          id: PATHS.INDEX,
          element: <RootLayout />,
          // Gotcha: declaring errorElement on the root will unmount the element causing our forever React components to unmount.
          // Leave errorElement on the child components, this allows for the entire react context on error pages as well.
          children: [
            {
              path: PATHS.INDEX,
              errorElement: <ErrorPage />,
              loader: baseLoader({ app }),
            },
            {
              loader: fileLoader({
                app,
              }),
              id: PATHS.FILE,
              path: PATHS.FILE + '/:id',
              errorElement: <ErrorPage />,
              element: (
                <ModelingPageProvider>
                  <Suspense
                    fallback={
                      <div className="absolute inset-0 grid place-content-center">
                        <Loading>Loading Design Studio...</Loading>
                      </div>
                    }
                  >
                    <ModelingMachineProvider>
                      <CoreDump />
                      <Outlet />
                      <OpenedProject />
                      <CommandBar />
                    </ModelingMachineProvider>
                  </Suspense>
                </ModelingPageProvider>
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
                      path: makeUrlPathRelative(PATHS.ONBOARDING),
                      element: <OnboardingRootRoute />,
                      children: onboardingRoutes,
                    },
                  ],
                },
                {
                  id: PATHS.FILE + 'TELEMETRY',
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
              errorElement: <ErrorPage />,
              element: (
                <>
                  <Outlet />
                  <Home />
                  <CommandBar />
                </>
              ),
              id: PATHS.HOME,
              loader: homeLoader({ app }),
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
                  element: <Telemetry />,
                },
              ],
            },
            {
              path: PATHS.SIGN_IN,
              errorElement: <ErrorPage />,
              element: <SignIn />,
            },
            ...(IS_STAGING_OR_DEBUG
              ? [
                  {
                    path: '/layout',
                    errorElement: <ErrorPage />,
                    element: <TestLayout />,
                  },
                ]
              : []),
          ],
        },
      ]),
    [app]
  )

  return (
    <NetworkContext.Provider value={networkStatus}>
      <RouterProvider router={router} />
    </NetworkContext.Provider>
  )
}

function CoreDump() {
  const { auth } = useApp()
  const { engineCommandManager, kclManager, rustContext } = useSingletons()
  const token = auth.useToken()
  const coreDumpManager = useMemo(
    () =>
      new CoreDumpManager(engineCommandManager, kclManager, rustContext, token),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    []
  )
  useHotkeyWrapper(
    ['mod + shift + period'],
    () => {
      toast
        .promise(
          coreDump(coreDumpManager, kclManager.wasmInstancePromise, true),
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
    },
    kclManager
  )
  return null
}
