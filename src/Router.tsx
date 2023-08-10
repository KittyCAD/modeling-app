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

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Auth>
        <Outlet />
        <App />
      </Auth>
    ),
    errorElement: <ErrorPage />,
    loader: ({ request }) => {
      const store = localStorage.getItem('store')
      if (store === null) {
        return redirect('/onboarding')
      } else {
        const status = JSON.parse(store).state.onboardingStatus || ''
        const notEnRouteToOnboarding =
          !request.url.includes('/onboarding') && request.method === 'GET'
        // '' is the initial state, 'done' and 'dismissed' are the final states
        const hasValidOnboardingStatus =
          (status !== undefined && status.length === 0) ||
          !(status === 'done' || status === 'dismissed')
        const shouldRedirectToOnboarding =
          notEnRouteToOnboarding && hasValidOnboardingStatus

        if (shouldRedirectToOnboarding) {
          return redirect('/onboarding/' + status)
        }
      }
      return null
    },
    children: [
      {
        path: 'settings',
        element: <Settings />,
      },
      {
        path: 'onboarding',
        element: <Onboarding />,
        children: onboardingRoutes,
      },
    ],
  },
  {
    path: '/signin',
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
