import type { OnboardingStatus } from '@src/lib/onboardingPaths'
import { PATHS } from '@src/lib/paths'

export interface RequestedNavigation {
  currentPathname: string
  onboardingStatus: OnboardingStatus
  requestedPath: string
}

export function shouldNavigateToRequestedPath(
  request: RequestedNavigation
): boolean {
  const onboardingHasEnded =
    request.onboardingStatus === 'completed' ||
    request.onboardingStatus === 'dismissed'
  const isStaleOnboardingNavigation =
    onboardingHasEnded &&
    request.requestedPath.includes(String(PATHS.ONBOARDING)) &&
    !request.currentPathname.includes(String(PATHS.ONBOARDING))

  return !isStaleOnboardingNavigation
}
