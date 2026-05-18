import type { ShouldRevalidateFunction } from 'react-router-dom'

import { PATHS } from '@src/lib/paths'

const FILE_MODAL_CHILD_PATHS = [
  PATHS.SETTINGS,
  PATHS.TELEMETRY,
  PATHS.ONBOARDING,
]

function isFileModalChildPath(pathname: string): boolean {
  return FILE_MODAL_CHILD_PATHS.some((path) => pathname.endsWith(path))
}

export const shouldRevalidateFileRoute: ShouldRevalidateFunction = ({
  currentParams,
  currentUrl,
  defaultShouldRevalidate,
  formMethod,
  nextParams,
  nextUrl,
}) => {
  const isNavigation =
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search !== nextUrl.search ||
    currentUrl.hash !== nextUrl.hash

  if (
    isNavigation &&
    !formMethod &&
    currentParams.id &&
    currentParams.id === nextParams.id &&
    (isFileModalChildPath(currentUrl.pathname) ||
      isFileModalChildPath(nextUrl.pathname))
  ) {
    return false
  }

  return defaultShouldRevalidate
}
