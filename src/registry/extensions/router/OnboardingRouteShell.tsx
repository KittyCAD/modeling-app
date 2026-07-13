import { onboardingRoutes } from '@src/routes/Onboarding'
import { useDismiss } from '@src/routes/Onboarding/utils'
import { useHotkeys } from 'react-hotkeys-hook'
import { useRoutes } from 'react-router-dom'

export function OnboardingRouteShell() {
  const dismiss = useDismiss()
  const routeElement = useRoutes(onboardingRoutes)
  useHotkeys('esc', () => dismiss())

  return (
    <div className="content" data-testid="onboarding-content">
      {routeElement}
    </div>
  )
}
