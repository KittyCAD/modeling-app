import { App } from './App'
import {
  createBrowserRouter,
  Outlet,
  redirect,
  RouterProvider,
} from 'react-router-dom'
import { ErrorPage } from './components/ErrorPage'
import { Settings } from './routes/Settings'
import Onboarding, {
  onboardingRoutes,
  onboardingPaths,
} from './routes/Onboarding'
import SignIn from './routes/SignIn'
import { Auth } from './Auth'
import { isTauri } from './lib/isTauri'
import Home from './routes/Home'
import { readTextFile } from '@tauri-apps/api/fs'
import makeUrlPathRelative from './lib/makeUrlPathRelative'
import { PROJECT_ENTRYPOINT } from './lib/tauriFS'

const prependRoutes =
  (routesObject: Record<string, string>) => (prepend: string) => {
    return Object.fromEntries(
      Object.entries(routesObject).map(([constName, path]) => [
        constName,
        prepend + path,
      ])
    )
  }

export const paths = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS: '/settings',
  SIGN_IN: '/signin',
  ONBOARDING: prependRoutes(onboardingPaths)(
    '/onboarding'
  ) as typeof onboardingPaths,
}

export type IndexLoaderData = {
  code: string | null
}

const router = createBrowserRouter([
  {
    path: paths.INDEX,
    loader: () =>
      isTauri() ? redirect(paths.HOME) : redirect(paths.FILE + '/new'),
  },
  {
    path: paths.FILE + '/:id',
    element: (
      <Auth>
        <Outlet />
        <App />
      </Auth>
    ),
    errorElement: <ErrorPage />,
    loader: async ({
      request,
      params,
    }): Promise<IndexLoaderData | Response> => {
      const store = localStorage.getItem('store')
      if (store === null) {
        return redirect(paths.ONBOARDING.INDEX)
      } else {
        const status = JSON.parse(store).state.onboardingStatus || ''
        const notEnRouteToOnboarding =
          !request.url.includes(paths.ONBOARDING.INDEX) &&
          request.method === 'GET'
        // '' is the initial state, 'done' and 'dismissed' are the final states
        const hasValidOnboardingStatus =
          (status !== undefined && status.length === 0) ||
          !(status === 'done' || status === 'dismissed')
        const shouldRedirectToOnboarding =
          notEnRouteToOnboarding && hasValidOnboardingStatus

        if (shouldRedirectToOnboarding) {
          return redirect(makeUrlPathRelative(paths.ONBOARDING.INDEX) + status)
        }
      }

      if (params.id && params.id !== 'new') {
        // Note that PROJECT_ENTRYPOINT is hardcoded until we support multiple files
        const code = await readTextFile(params.id + '/' + PROJECT_ENTRYPOINT)

        return {
          code,
        }
      }

      return {
        code: '',
      }
    },
    children: [
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
  {
    path: paths.HOME,
    element: (
      <Auth>
        <Outlet />
        <Home />
      </Auth>
    ),
    loader: () => !isTauri() && redirect(paths.FILE + '/new'),
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
])

/**
 * All routes in the app, used in src/index.tsx
 * @returns RouterProvider
 */
export const Router = () => {
  return <RouterProvider router={router} />
}
