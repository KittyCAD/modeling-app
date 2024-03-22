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
  indexLoader,
  onboardingRedirectLoader,
} from 'lib/routeLoaders'
import { CommandBarProvider } from 'components/CommandBar/CommandBarProvider'
import SettingsAuthProvider from 'components/SettingsAuthProvider'
import LspProvider from 'components/LspProvider'
import { KclContextProvider } from 'lang/KclProvider'

export const BROWSER_FILE_NAME = 'new'

const router = createBrowserRouter([
  {
    loader: indexLoader,
    id: paths.INDEX,
    element: (
      <CommandBarProvider>
        <KclContextProvider>
          <SettingsAuthProvider>
            <LspProvider>
              <Outlet />
            </LspProvider>
          </SettingsAuthProvider>
        </KclContextProvider>
      </CommandBarProvider>
    ),
    children: [
      {
        path: paths.INDEX,
        loader: () =>
          isTauri()
            ? redirect(paths.HOME)
            : redirect(paths.FILE + '/' + BROWSER_FILE_NAME),
        errorElement: <ErrorPage />,
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
              </ModelingMachineProvider>
              <WasmErrBanner />
            </FileMachineProvider>
            {!isTauri() && import.meta.env.PROD && <DownloadAppBanner />}
          </Auth>
        ),
        children: [
          {
            loader: onboardingRedirectLoader,
            index: true,
            element: <></>,
          },
          {
            children: [
              {
                path: makeUrlPathRelative(paths.SETTINGS),
                loader: indexLoader, // very rare someone will load into settings first, but it's possible in the browser
                element: <Settings />,
              },
              {
                path: makeUrlPathRelative(paths.ONBOARDING.INDEX),
                element: <Onboarding />,
                loader: indexLoader, // very rare someone will load into settings first, but it's possible in the browser
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
            path: makeUrlPathRelative(paths.SETTINGS),
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
