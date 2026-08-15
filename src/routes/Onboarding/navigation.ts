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
  const isOnboardingNavigation = request.requestedPath.includes(
    String(PATHS.ONBOARDING)
  )
  if (isOnboardingNavigation && request.currentPathname === PATHS.HOME) {
    return false
  }

  const onboardingHasEnded =
    request.onboardingStatus === 'completed' ||
    request.onboardingStatus === 'dismissed'
  const isStaleOnboardingNavigation =
    onboardingHasEnded &&
    isOnboardingNavigation &&
    !request.currentPathname.includes(String(PATHS.ONBOARDING))

  return !isStaleOnboardingNavigation
}
