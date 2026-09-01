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
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { getInitialDefaultDir, getProjectInfo } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  getParentAbsolutePath,
  getRouterSearchFromRequestUrl,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import {
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import {
  loadHomeProjects,
  webHomeRouteEnabled,
} from '@src/lib/routeLoaderUtils'
import {
  type AppSettings,
  loadAndValidateSettings,
} from '@src/lib/settings/settingsUtils'
import type {
  FileLoaderData,
  HomeLoaderData,
  IndexLoaderData,
} from '@src/lib/types'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { waitFor } from 'xstate'

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

type CanonicalWebProjectLibrary = {
  library: ProjectLibrarySetting
  projectPath: string
  defaultFilePath: string
}

function loadRouteSettings(
  app: App,
  wasmInstance: Awaited<App['wasmPromise']>,
  projectPath?: string
) {
  return loadAndValidateSettings(wasmInstance, {
    defaultProjectLibraries: app.registry.get(
      projectLibrarySettingDefaultsValueSpec
    ),
    projectLibrarySettingDefaultPolicies: app.registry.get(
      projectLibrarySettingDefaultPoliciesValueSpec
    ),
    extensionSettings: app.registry.get(settingsValueSpec),
    projectPath,
  })
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
export async function initIndexRoute(
  app: App,
  { requestUrl }: { requestUrl: string }
): Promise<RouteInitResult<undefined>> {
  const url = new URL(requestUrl)
  const routerSearch = getRouterSearchFromRequestUrl(
    requestUrl,
    Boolean(window.electron)
  )

  // Desktop, redirect and return early
  if (window.electron) {
    return { kind: 'redirect', to: PATHS.HOME + routerSearch }
  }

  // Let another part of the system handle the "open with web/desktop"...
  if (url.searchParams.has('ask-open-desktop')) {
    return { kind: 'ok', data: undefined }
  }

  if (await webHomeRouteEnabled(app)) {
    return { kind: 'redirect', to: PATHS.HOME + routerSearch }
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

  return {
    kind: 'redirect',
    to: fileRoutePath(defaultFilePath, routerSearch),
  }
}

/**
 * Initialization for `/file/:id`: resolve the id to a project and a file, open
 * the project, and open the file in the editor.
 */
export async function initFileRoute(
  app: App,
  { id, requestUrl }: { id: string | undefined; requestUrl: string }
): Promise<RouteInitResult<FileLoaderData>> {
  const {
    settings: { actor: settingsActor },
  } = app
  const { kclManager } = app.singletons

  // Must basically remain for all eternity, until the last person
  // who's ever used ZDS on web before this point has died.
  if (id?.startsWith('/browser')) {
    // Pop us back home, which will cause a default project to be
    // created.
    return { kind: 'redirect', to: PATHS.HOME }
  }

  const wasmInstance = await kclManager.wasmInstancePromise

  // Resolve the project root before loading project settings. Loading project
  // settings from a selected file's parent folder creates project.toml in
  // nested folders and makes them look like project roots.
  const appSettings = await loadRouteSettings(app, wasmInstance)
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

  const { projectName, projectPath, currentFileName, currentFilePath } =
    projectPathData

  const urlObj = new URL(requestUrl)

  if (!urlObj.pathname.endsWith('/settings')) {
    const fallbackFile = (await getProjectInfo(projectPath, wasmInstance))
      .default_file
    // NOTE: this shadows the module-level `fileExists`, and the `catch` below
    // compares an Error to the string 'ENOENT', so it never matches and this
    // stays true. Preserved verbatim: fixing it changes behaviour and belongs
    // in its own change with its own Playwright run.
    let fileExists = true
    if (currentFilePath && fileExists) {
      try {
        await fsZds.stat(currentFilePath)
      } catch (e) {
        if (e === 'ENOENT') {
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
      return {
        kind: 'redirect',
        to: fileRoutePath(fallbackFile, routerSearch),
      }
    }
  }

  // Set the file system manager to the project path
  // So that WASM gets an updated path for operations
  projectFsManager.dir = projectPath

  const defaultProjectData = {
    name: projectName || 'unnamed',
    path: projectPath,
    children: [],
    kcl_file_count: 0,
    directory_count: 0,
    metadata: null,
    default_file: projectPath,
    readWriteAccess: true,
  }

  const maybeProjectInfo = await getProjectInfo(projectPath, wasmInstance)

  const project = maybeProjectInfo ?? defaultProjectData

  // Fire off the event to load the project settings
  // once we know it's idle.
  await waitFor(settingsActor, (state) => state.matches('idle'))
  settingsActor.send({
    type: 'load.project',
    project,
  })
  await waitFor(settingsActor, (state) => state.matches('idle'))

  const projectRef = await app.openProject(project)
  const editor = await projectRef.openEditor(
    currentFilePath || PROJECT_ENTRYPOINT,
    app.singletons.kclManager,
    // If persistCode in localStorage is present, it'll persist that code
    // through *anything*. INTENDED FOR TESTS.
    window.electron?.process.env.NODE_ENV === 'test'
      ? kclManager.localStoragePersistCode()
      : undefined
  )

  const requestedFileName =
    app.systemIOActor.getSnapshot().context.requestedFileName
  if (requestedFileName.project === projectName) {
    requestedFileName.onProjectLoaderComplete?.()
  }

  const requestedProjectDirectoryPath =
    projectRef.projectIORefSignal.value.libraryPath ??
    getParentAbsolutePath(project.path)
  const systemIOSnapshot = app.systemIOActor.getSnapshot()
  // Same-directory file navigation should not restart SystemIO's own
  // post-mutation folder refresh.
  const shouldSyncProjectDirectory =
    requestedProjectDirectoryPath !==
      systemIOSnapshot.context.projectDirectoryPath ||
    (systemIOSnapshot.matches(SystemIOMachineStates.idle) &&
      systemIOSnapshot.context.folders === undefined)
  if (shouldSyncProjectDirectory) {
    app.systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: {
        requestedProjectDirectoryPath,
      },
    })
  }

  const projectData: IndexLoaderData = {
    code: editor.code,
    project,
    file: {
      name: currentFileName || '',
      path: currentFilePath || '',
      children: [],
    },
  }

  return { kind: 'ok', data: { ...projectData } }
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
