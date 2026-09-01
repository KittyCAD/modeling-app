/**
 * Route initialization, as plain functions.
 *
 * These used to be the bodies of the React Router loaders in `routeLoaders.ts`.
 * They were never really data loaders: nothing calls `useLoaderData`, so their
 * return values were computed and discarded, and the actual work was mutating
 * the `App` singleton and the XState actors. The only load-bearing thing they
 * got from React Router was `redirect()`.
 *
 * So they say what they want instead of performing it — a `redirect` outcome
 * rather than a `Response` — and the adapters in `routeLoaders.ts` translate.
 * That leaves the URL-to-state work callable without a router, which is what
 * the navigation contract needs.
 */

import type { App } from '@src/lib/app'
import { getRouterSearchFromRequestUrl, PATHS } from '@src/lib/paths'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'

/**
 * What a route wants to happen, said rather than done.
 *
 * `to` is whatever the loader would have passed to `redirect()`, so it is
 * sometimes a path and sometimes a whole URL — preserved exactly, because the
 * URLs are the contract with the Playwright suite.
 */
export type RouteInitResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'redirect'; to: string }

/**
 * Initialization for `/`, which is a funnel: it never renders anything, it
 * decides where the app should actually be.
 *
 * The index route redirects to Home while preserving router-owned search.
 */
export async function initIndexRoute(
  _app: App,
  { requestUrl }: { requestUrl: string }
): Promise<RouteInitResult<undefined>> {
  const url = new URL(requestUrl)
  const routerSearch = getRouterSearchFromRequestUrl(
    requestUrl,
    Boolean(window.electron)
  )

  // Let another part of the system handle the "open with web/desktop"...
  if (!window.electron && url.searchParams.has('ask-open-desktop')) {
    return { kind: 'ok', data: undefined }
  }

  return { kind: 'redirect', to: PATHS.HOME + routerSearch }
}

/**
 * Initialization for `/file/:id`.
 *
 * Almost all of this is `app.openFile`: resolving the id to a project and a
 * file, deciding whether the URL names something that has to be corrected, and
 * opening it. What stays here is the one genuinely routing-shaped thing — a
 * legacy URL shape that has no meaning as application state.
 */
export async function initFileRoute(
  app: App,
  {
    id,
    requestUrl,
    requestSignal = new AbortController().signal,
  }: {
    id: string | undefined
    requestUrl: string
    requestSignal?: AbortSignal
  }
): Promise<RouteInitResult<FileLoaderData>> {
  // Must basically remain for all eternity, until the last person
  // who's ever used ZDS on web before this point has died.
  if (id?.startsWith('/browser')) {
    // Pop us back home, which will cause a default project to be
    // created.
    return { kind: 'redirect', to: PATHS.HOME }
  }

  const outcome = await app.openFile({
    id,
    requestUrl,
    signal: requestSignal,
  })
  return outcome.kind === 'redirect'
    ? { kind: 'redirect', to: outcome.to }
    : { kind: 'ok', data: outcome.data }
}

/**
 * Initialization for `/home` and `/library/:libraryId`.
 *
 * This clears the currently-open project because the projects listed on Home
 * may otherwise be stale.
 */
export async function initHomeRoute(
  app: App
): Promise<RouteInitResult<HomeLoaderData>> {
  return { kind: 'ok', data: loadHomeProjects(app) }
}
