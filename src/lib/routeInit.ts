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
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import {
  getRouterSearchFromRequestUrl,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import { getOnboardingChildRoute } from '@src/lib/routeLoaderNavigation'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'

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

function loadRouteSettings(
  app: App,
  wasmInstance: Awaited<App['wasmPromise']>,
  projectPath?: string
) {
  return loadAndValidateSettings(
    app.registry.get(fileOperationsService),
    wasmInstance,
    {
      defaultProjectLibraries: app.registry.get(
        projectLibrarySettingDefaultsValueSpec
      ),
      projectLibrarySettingDefaultPolicies: app.registry.get(
        projectLibrarySettingDefaultPoliciesValueSpec
      ),
      extensionSettings: app.registry.get(settingsValueSpec),
      projectPath,
    }
  )
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
    return { kind: 'ok', data: undefined }
  }

  return { kind: 'redirect', to: PATHS.HOME + routerSearch }
}

/**
 * Initialization for `/file/:id`: resolve the id to a project and a file, open
 * the project, and open the file in the editor.
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
  const assertCurrent = app.beginFileRouteLoad(requestSignal)
  const { kclManager } = app.singletons

  // Must basically remain for all eternity, until the last person
  // who's ever used ZDS on web before this point has died.
  if (id?.startsWith('/browser')) {
    // Pop us back home, which will cause a default project to be
    // created.
    return { kind: 'redirect', to: PATHS.HOME }
  }

  const wasmInstance = await kclManager.wasmInstancePromise
  assertCurrent()

  // Resolve the project root before loading project settings. Loading project
  // settings from a selected file's parent folder creates project.toml in
  // nested folders and makes them look like project roots.
  const appSettings = await loadRouteSettings(app, wasmInstance)
  assertCurrent()
  const currentProjectPath = app.project?.projectIORefSignal.value.path
  const targetLibraryPath = id
    ? (
        await getProjectLibraryOwnership(
          appSettings.settings.app.libraries?.current ?? [],
          id
        )
      )?.libraryPath
    : undefined
  const projectPathData = id
    ? parseProjectRoute(appSettings.configuration, id, {
        activeProjectPath: currentProjectPath,
        candidateProjectDirectories: targetLibraryPath
          ? [targetLibraryPath]
          : [],
      })
    : undefined

  if (!projectPathData) {
    return Promise.reject(
      new Error('bug: projectPathData undefined, early return')
    )
  }

  await loadRouteSettings(app, wasmInstance, projectPathData.projectPath)
  assertCurrent()

  const { projectName, projectPath, currentFileName, currentFilePath } =
    projectPathData

  const urlObj = new URL(requestUrl)

  if (!urlObj.pathname.endsWith('/settings')) {
    const fallbackFile = (
      await getProjectInfo(
        app.registry.get(fileOperationsService),
        projectPath,
        wasmInstance
      )
    ).default_file
    let fileExists = true
    if (currentFilePath && fileExists) {
      try {
        await app.registry.get(fileOperationsService).stat(currentFilePath)
      } catch (e) {
        if (isPathNotFoundError(e)) {
          fileExists = false
        }
      }
    }

    // If we are navigating to the project and want to navigate to its
    // default file, redirect to it keeping everything else in the URL the same.
    if (projectPath && !currentFileName && fileExists && id) {
      const encodedId = safeEncodeForRouterPaths(id)
      const requestUrlWithDefaultFile = requestUrl.replace(
        encodedId,
        safeEncodeForRouterPaths(fallbackFile)
      )
      return { kind: 'redirect', to: requestUrlWithDefaultFile }
    }

    if (!fileExists || !currentFileName || !currentFilePath || !projectName) {
      const routerSearch = getRouterSearchFromRequestUrl(
        requestUrl,
        Boolean(window.electron)
      )
      const onboardingChildRoute = id
        ? getOnboardingChildRoute(requestUrl, id)
        : ''
      return {
        kind: 'redirect',
        to: `${PATHS.FILE}/${encodeURIComponent(
          fallbackFile
        )}${onboardingChildRoute}${routerSearch}`,
      }
    }
  }

  const data = await app.openFile({
    resolved: { projectName, projectPath, currentFileName, currentFilePath },
    wasmInstance,
    assertCurrent,
  })

  return { kind: 'ok', data }
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
