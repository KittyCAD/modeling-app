import { Suspense, useMemo } from 'react'
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
import { isDesktop } from '@src/lib/isDesktop'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS } from '@src/lib/paths'
import { baseLoader, fileLoader, homeLoader } from '@src/lib/routeLoaders'
import { useApp, useSingletons } from '@src/lib/boot'
import Home from '@src/routes/Home'
import { OnboardingRootRoute, onboardingRoutes } from '@src/routes/Onboarding'
import { Settings } from '@src/routes/Settings'
import SignIn from '@src/routes/SignIn'
import { Telemetry } from '@src/routes/Telemetry'
import { TestLayout } from '@src/lib/layout/TestLayout'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import Loading from '@src/components/Loading'
import { MachineApiController } from '@src/components/MachineApiController'
import { routesValueSpec } from '@src/registry/contracts/routes'
import { useSignals } from '@preact/signals-react/runtime'

const createRouter = isDesktop() ? createHashRouter : createBrowserRouter

/**
 * All routes in the app, used in src/lib/index.tsx
 * @returns RouterProvider
 */
export const Router = () => {
  useSignals()
  const app = useApp()
  const { kclManager } = useSingletons()
  const networkStatus = useNetworkStatus(kclManager.engineCommandManager)
  const routesProvidedByRegistry = app.registry.signal(routesValueSpec).value
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
            ...routesProvidedByRegistry,
          ],
        },
      ]),
    [app, routesProvidedByRegistry]
  )

  return (
    <NetworkContext.Provider value={networkStatus}>
      <MachineApiController />
      <RouterProvider router={router} />
    </NetworkContext.Provider>
  )
}
