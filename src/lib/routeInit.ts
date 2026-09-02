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

import { projectSkeletonCreate } from '@src/lang/project'
import type { App } from '@src/lib/app'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { getInitialDefaultDir, getProjectInfo } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { getRouterSearchFromRequestUrl, PATHS } from '@src/lib/paths'
import {
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  loadHomeProjects,
  webHomeRouteEnabled,
} from '@src/lib/routeLoaderUtils'
import { loadRouteSettings } from '@src/lib/routeSettings'
import type { AppSettings } from '@src/lib/settings/settingsUtils'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

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
 * Where `/` decides the app should actually be.
 *
 * `/` renders nothing; it is a funnel. Saying where to go rather than
 * *redirecting* there lets the same decision serve two callers: the React
 * Router loader, which turns it into a `redirect`, and the `UrlRoute`, which
 * turns it into application state. Those two want opposite things from it,
 * which is why it cannot stay a `Response`.
 */
export type IndexTarget =
  /** Desktop, or web with the cloud feature: the project list. */
  | { kind: 'home' }
  /** Unflagged web: the one project it is allowed to have. */
  | { kind: 'file'; filePath: string }
  /** `?ask-open-desktop` is present; another part of the app owns this. */
  | { kind: 'defer' }

type CanonicalWebProjectLibrary = {
  library: ProjectLibrarySetting
  projectPath: string
  defaultFilePath: string
}

async function getCanonicalWebProjectLibrary(
  settings: AppSettings['settings']
): Promise<CanonicalWebProjectLibrary> {
  const fallbackLibraryPath =
    settings.app.projectDirectory.current.trim() ||
    (await getInitialDefaultDir())
  const configuredLibrary = getDefaultDirectoryProjectLibrarySetting(
    settings.app.libraries?.current
  )
  const libraryPath = configuredLibrary?.path.trim()
    ? configuredLibrary.path
    : fallbackLibraryPath
  const library = {
    title: configuredLibrary?.title || DEFAULT_PROJECT_LIBRARY_TITLE,
    path: libraryPath,
    type: configuredLibrary?.type || DIRECTORY_PROJECT_LIBRARY_TYPE,
  }

  return {
    library,
    projectPath: fsZds.resolve(library.path, DEFAULT_WEB_PROJECT_NAME),
    defaultFilePath: fsZds.resolve(
      library.path,
      DEFAULT_WEB_PROJECT_NAME,
      PROJECT_ENTRYPOINT
    ),
  }
}

async function maybeGetExistingDefaultFilePath(
  projectPath: string,
  wasmInstance: Awaited<App['wasmPromise']>
) {
  try {
    const project = await getProjectInfo(projectPath, wasmInstance)
    return project.default_file
  } catch {
    return undefined
  }
}

async function fileExists(filePath: string) {
  try {
    await fsZds.stat(filePath)
    return true
  } catch {
    return false
  }
}

function fileRoutePath(filePath: string, routerSearch: string) {
  return `${PATHS.FILE}/${encodeURIComponent(filePath)}${routerSearch}`
}

/**
 * Initialization for `/`, which is a funnel: it never renders anything, it
 * decides where the app should actually be.
 *
 * Desktop goes home. Web goes home when the OPFS cloud flag is on, and
 * otherwise gets a default project created for it and opens that.
 */
export async function resolveIndexTarget(
  app: App,
  { requestUrl }: { requestUrl: string }
): Promise<IndexTarget> {
  const url = new URL(requestUrl)

  // Desktop goes to the project list.
  if (window.electron) {
    return { kind: 'home' }
  }

  // Let another part of the system handle the "open with web/desktop"...
  if (url.searchParams.has('ask-open-desktop')) {
    return { kind: 'defer' }
  }

  if (await webHomeRouteEnabled(app)) {
    return { kind: 'home' }
  }

  // Web, make a default project and redirect to it.
  const wasmInstance = await app.singletons.kclManager.wasmInstancePromise

  const { settings } = await loadRouteSettings(app, wasmInstance)
  const canonicalLibrary = await getCanonicalWebProjectLibrary(settings)
  let defaultFilePath =
    (await maybeGetExistingDefaultFilePath(
      canonicalLibrary.projectPath,
      wasmInstance
    )) ?? canonicalLibrary.defaultFilePath

  if (!(await fileExists(defaultFilePath))) {
    await projectSkeletonCreate(
      canonicalLibrary.defaultFilePath,
      settings.modeling.defaultUnit.current ?? DEFAULT_DEFAULT_LENGTH_UNIT,
      wasmInstance
    )
    defaultFilePath = canonicalLibrary.defaultFilePath
  }

  return { kind: 'file', filePath: defaultFilePath }
}

/**
 * The `/` route as React Router still sees it: a redirect.
 *
 * Thin on purpose. The decision is `resolveIndexTarget`; this only renders it
 * as the `Response` the router wants, preserving the query string exactly as
 * before.
 */
export async function initIndexRoute(
  app: App,
  { requestUrl }: { requestUrl: string }
): Promise<RouteInitResult<undefined>> {
  const target = await resolveIndexTarget(app, { requestUrl })
  const routerSearch = getRouterSearchFromRequestUrl(
    requestUrl,
    Boolean(window.electron)
  )

  if (target.kind === 'home') {
    return { kind: 'redirect', to: PATHS.HOME + routerSearch }
  }
  if (target.kind === 'file') {
    return {
      kind: 'redirect',
      to: fileRoutePath(target.filePath, routerSearch),
    }
  }
  return { kind: 'ok', data: undefined }
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
  { id, requestUrl }: { id: string | undefined; requestUrl: string }
): Promise<RouteInitResult<FileLoaderData>> {
  // Must basically remain for all eternity, until the last person
  // who's ever used ZDS on web before this point has died.
  if (id?.startsWith('/browser')) {
    // Pop us back home, which will cause a default project to be
    // created.
    return { kind: 'redirect', to: PATHS.HOME }
  }

  const outcome = await app.openFile({ id, requestUrl })
  return outcome.kind === 'redirect'
    ? { kind: 'redirect', to: outcome.to }
    : { kind: 'ok', data: outcome.data }
}

/**
 * Initialization for `/home` and `/library/:libraryId`.
 *
 * Unflagged web has no home, so it bounces to `/`, which will redirect on to a
 * project. Otherwise this clears the currently-open project — the projects
 * listed there may be stale.
 */
export async function initHomeRoute(
  app: App
): Promise<RouteInitResult<HomeLoaderData>> {
  // If on unflagged web, bump out to root, which will redirect to a project.
  if (!window.electron && !(await webHomeRouteEnabled(app))) {
    return { kind: 'redirect', to: PATHS.INDEX }
  }

  return { kind: 'ok', data: loadHomeProjects(app) }
}
