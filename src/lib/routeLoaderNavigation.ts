import {
  joinOSPaths,
  joinRouterPaths,
  normalizeFilesystemPathForComparison,
  PATHS,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'

type RequestedFileNavigation = {
  project: string
  file: string
}

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

export function isRequestedFileLoaded({
  requestedFileName,
  projectName,
  projectPath,
  currentFilePath,
}: {
  requestedFileName: RequestedFileNavigation
  projectName: string | null
  projectPath: string
  currentFilePath: string | null
}) {
  if (
    !requestedFileName.project ||
    !requestedFileName.file ||
    requestedFileName.project !== projectName ||
    !currentFilePath
  ) {
    return false
  }

  const requestedFilePath = joinOSPaths(projectPath, requestedFileName.file)
  return (
    normalizeFilesystemPathForComparison(currentFilePath) ===
    normalizeFilesystemPathForComparison(requestedFilePath)
  )
}
