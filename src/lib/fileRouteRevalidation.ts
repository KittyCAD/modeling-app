import { matchPath } from 'react-router-dom'
import type { ShouldRevalidateFunction } from 'react-router-dom'

/** Settings owns its tab and anchor, not the loaded file/project session. */
export function createFileRouteRevalidation(
  fileRoutePath: string,
  settingsPath: string
): ShouldRevalidateFunction {
  const settingsRoutePath = `${fileRoutePath}${settingsPath}`
  return ({
    currentUrl,
    nextUrl,
    currentParams,
    nextParams,
    formMethod,
    formAction,
    actionStatus,
    actionResult,
    defaultShouldRevalidate,
  }) => {
    // Same-URL navigation includes explicit refresh/revalidation. Submissions
    // and action results retain the router's data-refresh semantics as well.
    if (
      currentUrl.href === nextUrl.href ||
      currentUrl.origin !== nextUrl.origin ||
      formMethod !== undefined ||
      formAction !== undefined ||
      actionStatus !== undefined ||
      actionResult !== undefined ||
      currentParams.id === undefined ||
      currentParams.id !== nextParams.id
    )
      return defaultShouldRevalidate

    const currentSettings = matchPath(settingsRoutePath, currentUrl.pathname)
    const nextSettings = matchPath(settingsRoutePath, nextUrl.pathname)
    if (
      !(currentSettings || nextSettings) ||
      !(currentSettings || matchPath(fileRoutePath, currentUrl.pathname)) ||
      !(nextSettings || matchPath(fileRoutePath, nextUrl.pathname))
    )
      return defaultShouldRevalidate

    const currentIntent = new URLSearchParams(currentUrl.search)
    const nextIntent = new URLSearchParams(nextUrl.search)
    currentIntent.delete('tab')
    nextIntent.delete('tab')
    currentIntent.sort()
    nextIntent.sort()
    if (currentIntent.toString() !== nextIntent.toString())
      return defaultShouldRevalidate

    return false
  }
}
