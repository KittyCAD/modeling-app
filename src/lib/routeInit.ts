/**
 * Route initialization, as plain functions.
 *
 * These began as extracted React Router loader bodies. They now return typed
 * application transitions when one startup destination resolves to another.
 * The startup coordinator follows those transitions directly and projects the
 * canonical URL only after the resulting application state is ready.
 */

import type { App } from '@src/lib/app'
import { getRouterSearchFromRequestUrl, PATHS } from '@src/lib/paths'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'
import {
  appNavigationService,
  openProjectIntent,
} from '@src/registry/contracts/appNavigation'
import type { AppDestination } from '@src/registry/contracts/appUrl'

/**
 * A startup step either establishes its state or selects the next typed
 * application destination. `canonicalPath` is projected only after that
 * destination has been established.
 */
export type RouteInitResult<T> =
  | { kind: 'ready'; data: T }
  | {
      kind: 'transition'
      destination: AppDestination
      canonicalPath: string
    }

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
    return { kind: 'ready', data: undefined }
  }

  return {
    kind: 'transition',
    destination: { type: 'home' },
    canonicalPath: PATHS.HOME + routerSearch,
  }
}

/**
 * Initialization for `/file/:id`.
 *
 * Almost all of this is the `OpenProject` application intent: resolving the
 * legacy route id to a project and optional initial editor, deciding whether
 * the URL needs correction, and opening the project session. What stays here
 * is the one genuinely routing-shaped compatibility case.
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
  // Before multi-file web projects, the editor used
  // `/file/%2Fbrowser%2Fmain.kcl` for its virtual browser project. Send those
  // legacy entry URLs Home, where startup selects the current default project.
  // Remove when support for pre-OPFS URLs ends.
  if (id?.startsWith('/browser')) {
    // Transitional loader cancellation: this legacy branch returns before it
    // can call openProject, so the loader-era implementation must explicitly
    // invalidate an earlier file loader. Startup inversion removes this call.
    app.registry.get(appNavigationService).supersedeProjectOpen(requestSignal)
    // Continue at Home, which may select the default web project.
    return {
      kind: 'transition',
      destination: { type: 'home' },
      canonicalPath: PATHS.HOME,
    }
  }

  const outcome = await app.registry
    .get(appNavigationService)
    .dispatch(openProjectIntent, {
      target: id,
      requestUrl,
      signal: requestSignal,
    })
  return { kind: 'ready', data: outcome.data }
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
  return { kind: 'ready', data: loadHomeProjects(app) }
}
