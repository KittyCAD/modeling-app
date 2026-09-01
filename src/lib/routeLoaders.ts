/**
 * React Router adapters over the plain route-init functions in `routeInit.ts`.
 *
 * The initialization work itself no longer knows the router exists; these
 * translate its `redirect` outcome into a `Response`. Keeping the throw and the
 * redirect on this side means `errorElement` and React Router's replace
 * semantics behave exactly as before.
 */

import type { App } from '@src/lib/app'
import {
  initFileRoute,
  initHomeRoute,
  initIndexRoute,
} from '@src/lib/routeInit'
import type {
  FileLoaderData,
  HomeLoaderData,
} from '@src/lib/types'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'

export { DEFAULT_WEB_PROJECT_NAME } from '@src/lib/routeInit'

/**
 * The base loader is used to reroute `/` root path requests,
 * to the home route on desktop, and to a constrained single project view on web.
 *
 * The OPFS cloud feature flag enables the home, multi-project view on web.
 */
export const baseLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async ({ request }) => {
    const result = await initIndexRoute(app, { requestUrl: request.url })
    if (result.kind === 'redirect') {
      return redirect(result.to)
    }
    return result.data
  }

export const fileLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (routerData): Promise<FileLoaderData | Response> => {
    const result = await initFileRoute(app, {
      id: routerData.params.id,
      requestUrl: routerData.request.url,
    })
    if (result.kind === 'redirect') {
      return redirect(result.to)
    }
    return result.data
  }

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred

// Should also clear currently loaded projects in SystemIO. They may be stale.
export const homeLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (): Promise<HomeLoaderData | Response> => {
    const result = await initHomeRoute(app)
    if (result.kind === 'redirect') {
      return redirect(result.to)
    }
    return result.data
  }
