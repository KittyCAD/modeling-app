import { App } from './App'
import {
  createBrowserRouter,
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
    element: <Auth><App /></Auth>,
    errorElement: <ErrorPage />,
    loader: () => {
      const store = localStorage.getItem('store')
      if (store === null) {
        return redirect('/onboarding')
      } else {
        const status = JSON.parse(store).state.onboardingStatus
        if (status !== 'done' && status !== 'dismissed') {
          return redirect('/onboarding/' + status)
        }
      }
      return null
    },
  },
  {
    path: '/settings',
    element: <Auth><Settings /></Auth>,
  },
  {
    path: '/onboarding',
    element: <Auth><Onboarding /></Auth>,
    children: onboardingRoutes,
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
