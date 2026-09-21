/**
 * Startup initialization as plain functions.
 *
 * These functions establish application state or select the next typed
 * destination. URL-owned state stays structured until appUrl projects it.
 */

import type { App } from '@src/lib/app'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'
import {
  appNavigationService,
  openProjectIntent,
} from '@src/registry/contracts/appNavigation'
import type {
  AppDestination,
  AppUrlState,
} from '@src/registry/contracts/appUrl'

export type RouteInitResult<T> =
  | { kind: 'ready'; data: T }
  | {
      kind: 'transition'
      destination: AppDestination
      urlState: AppUrlState
    }

/** Resolve the index funnel to Home while preserving router-owned search. */
export async function initIndexRoute(
  _app: App,
  { urlState }: { urlState: AppUrlState }
): Promise<RouteInitResult<undefined>> {
  if (
    !window.electron &&
    new URLSearchParams(urlState.search).has('ask-open-desktop')
  ) {
    return { kind: 'ready', data: undefined }
  }

  return {
    kind: 'transition',
    destination: { type: 'home' },
    urlState: { search: urlState.search, hash: '' },
  }
}

/** Open the project represented by the legacy `/file/:id` URL shape. */
export async function initFileRoute(
  app: App,
  {
    id,
    startup,
    requestSignal = new AbortController().signal,
  }: {
    id: string
    startup: AppUrlState
    requestSignal?: AbortSignal
  }
): Promise<RouteInitResult<FileLoaderData>> {
  // Before multi-file web projects, the editor used
  // `/file/%2Fbrowser%2Fmain.kcl` for its virtual browser project. Send those
  // legacy entry URLs Home. Remove when support for pre-OPFS URLs ends.
  if (id.startsWith('/browser')) {
    app.registry.get(appNavigationService).supersedeProjectOpen(requestSignal)
    return {
      kind: 'transition',
      destination: { type: 'home' },
      urlState: { search: '', hash: '' },
    }
  }

  const outcome = await app.registry
    .get(appNavigationService)
    .dispatch(openProjectIntent, {
      target: id,
      startup,
      signal: requestSignal,
    })
  return { kind: 'ready', data: outcome.data }
}

/** Clear the open project and load the projects shown on Home. */
export async function initHomeRoute(
  app: App
): Promise<RouteInitResult<HomeLoaderData>> {
  return { kind: 'ready', data: loadHomeProjects(app) }
}
