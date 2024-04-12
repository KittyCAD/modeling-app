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
import { isTauri } from './lib/isTauri'
import Home from './routes/Home'
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
              <Outlet />
            </KclContextProvider>
          </LspProvider>
        </SettingsAuthProvider>
      </CommandBarProvider>
    ),
    errorElement: <ErrorPage />,
    children: [
      {
        path: paths.INDEX,
        loader: () =>
          isTauri()
            ? redirect(paths.HOME)
            : redirect(paths.FILE + '/%2F' + BROWSER_PROJECT_NAME),
      },
      {
        loader: fileLoader,
        id: paths.FILE,
        path: paths.FILE + '/:id',
        element: (
          <Auth>
            <FileMachineProvider>
              <ModelingMachineProvider>
                <Outlet />
                <App />
                <CommandBar />
                {!isTauri() && import.meta.env.PROD && <DownloadAppBanner />}
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
  return <RouterProvider router={router} />
}
