import {
  joinRouterPaths,
  PATHS,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'

export function getOnboardingChildRoute(requestUrl: string, routeId: string) {
  const url = new URL(requestUrl)
  const fileRoutePrefix = joinRouterPaths(
    PATHS.FILE,
    safeEncodeForRouterPaths(routeId)
  )
  const childRoute = url.pathname.startsWith(`${fileRoutePrefix}/`)
    ? url.pathname.slice(fileRoutePrefix.length)
    : ''

  return childRoute === PATHS.ONBOARDING ||
    childRoute.startsWith(`${PATHS.ONBOARDING}/`)
    ? childRoute
    : ''
}
