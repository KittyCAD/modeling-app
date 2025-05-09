import { useHotkeys } from 'react-hotkeys-hook'
import { Outlet } from 'react-router-dom'
import { useDismiss } from '@src/routes/Onboarding/utils'
import { browserOnboardingRoutes } from '@src/routes/Onboarding/BrowserOnboardingRoutes'
import { desktopOnboardingRoutes } from '@src/routes/Onboarding/DesktopOnboardingRoutes'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'

/** Compile the onboarding routes into one object
 *  for use in the Router.
 */
export const onboardingRoutes = [
  ...browserOnboardingRoutes,
  ...desktopOnboardingRoutes,
].map(({ path, ...route }) => ({
  // react-router-dom wants these path to be relative in Router.tsx
  path: makeUrlPathRelative(path),
  ...route,
}))

export const OnboardingRootRoute = () => {
  const dismiss = useDismiss()
  useHotkeys('esc', () => dismiss())

  return (
    <div className="content" data-testid="onboarding-content">
      {/* Outlet is a magic react-router-dom element that hot-swaps child route content */}
      <Outlet />
    </div>
  )
}
