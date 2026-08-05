import { projectSkeletonCreate } from '@src/lang/project'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
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
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibrarySetting,
  isPathInDirectoryProjectLibrary,
  normalizeProjectLibrarySettingPath,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
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
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

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

type ProjectLibraryPathResolution = {
  library: ProjectLibrarySetting
  path: string
}

async function resolveProjectLibraryLocalPath(library: ProjectLibrarySetting) {
  if (library.type === CLOUD_PROJECT_LIBRARY_TYPE) {
    return getCloudProjectLibraryMaterializationDirectoryPath(library).catch(
      () => undefined
    )
  }

  return library.path.trim() ? library.path : undefined
}

async function getContainingProjectLibraryPath(
  libraries: readonly ProjectLibrarySetting[],
  projectPath: string
): Promise<ProjectLibraryPathResolution | undefined> {
  const candidates: ProjectLibraryPathResolution[] = []

  for (const library of libraries) {
    const libraryPath = await resolveProjectLibraryLocalPath(library)
    if (!libraryPath) {
      continue
    }

    const normalizedProjectPath =
      normalizeProjectLibrarySettingPath(projectPath)
    const normalizedLibraryPath =
      normalizeProjectLibrarySettingPath(libraryPath)
    if (
      normalizedProjectPath !== normalizedLibraryPath &&
      isPathInDirectoryProjectLibrary(projectPath, libraryPath)
    ) {
      candidates.push({ library, path: libraryPath })
    }
  }

  return candidates
    .toSorted(
      (left, right) =>
        normalizeProjectLibrarySettingPath(right.path).length -
        normalizeProjectLibrarySettingPath(left.path).length
    )
    .at(0)
}

function canProjectLibraryScopeCloudSync(library?: ProjectLibrarySetting) {
  return (
    library?.type === CLOUD_PROJECT_LIBRARY_TYPE ||
    library?.type === DIRECTORY_PROJECT_LIBRARY_TYPE
  )
}

function redirectToFile(filePath: string, routerSearch: string) {
  return redirect(
    `${PATHS.FILE}/${encodeURIComponent(filePath)}${routerSearch}`
  )
}

/**
 * The base loader is used to reroute `/` root path requests,
 * to the home route on desktop, and to a constrained single project view on web.
 *
 * The OPFS cloud feature flag enables the home, multi-project view on web.
 */
export const baseLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)
    const routerSearch = getRouterSearchFromRequestUrl(
      request.url,
      Boolean(window.electron)
    )

    // Desktop, redirect and return early
    if (window.electron) {
      return redirect(PATHS.HOME + routerSearch)
    }

    // Let another part of the system handle the "open with web/desktop"...
    if (url.searchParams.has('ask-open-desktop')) {
      return
    }

    if (await webHomeRouteEnabled(app)) {
      return redirect(PATHS.HOME + routerSearch)
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

    return redirectToFile(defaultFilePath, routerSearch)
  }

export const fileLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (routerData): Promise<FileLoaderData | Response> => {
    const {
      settings: { actor: settingsActor },
    } = app
    const { kclManager } = app.singletons
    const { params } = routerData

    // Must basically remain for all eternity, until the last person
    // who's ever used ZDS on web before this point has died.
    if (params.id?.startsWith('/browser')) {
      // Pop us back home, which will cause a default project to be
      // created.
      return redirect(PATHS.HOME)
    }

    const wasmInstance = await kclManager.wasmInstancePromise

    // Resolve the project root before loading project settings. Loading project
    // settings from a selected file's parent folder creates project.toml in
    // nested folders and makes them look like project roots.
    const appSettings = await loadRouteSettings(app, wasmInstance)
    const projectPathData = params.id
      ? parseProjectRoute(appSettings.configuration, params.id)
      : undefined

    if (!projectPathData) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

    const settings = await loadRouteSettings(
      app,
      wasmInstance,
      projectPathData.projectPath
    )

    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    const urlObj = new URL(routerData.request.url)

    if (!urlObj.pathname.endsWith('/settings')) {
      const fallbackFile = (await getProjectInfo(projectPath, wasmInstance))
        .default_file
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
      if (projectPath && !currentFileName && fileExists && params.id) {
        const encodedId = safeEncodeForRouterPaths(params.id)
        const requestUrlWithDefaultFile = routerData.request.url.replace(
          encodedId,
          safeEncodeForRouterPaths(fallbackFile)
        )
        return redirect(requestUrlWithDefaultFile)
      }

      if (!fileExists || !currentFileName || !currentFilePath || !projectName) {
        const routerSearch = getRouterSearchFromRequestUrl(
          routerData.request.url,
          Boolean(window.electron)
        )
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(fallbackFile)}${routerSearch}`
        )
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
    const owningProjectLibrary = await getContainingProjectLibraryPath(
      settings.settings.app.libraries.current,
      project.path
    )
    app.registry.get(cloudSyncService).setProjectScope({
      projectPath: project.path,
      syncable: canProjectLibraryScopeCloudSync(owningProjectLibrary?.library),
    })

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
      owningProjectLibrary?.path ?? getParentAbsolutePath(project.path)
    app.systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: {
        requestedProjectDirectoryPath,
      },
    })

    const projectData: IndexLoaderData = {
      code: editor.code,
      project,
      file: {
        name: currentFileName || '',
        path: currentFilePath || '',
        children: [],
      },
    }

    return {
      ...projectData,
    }
  }

// Loads the settings and by extension the configured project library entries
// and returns them to the Home route, along with any errors that occurred

// Should also clear currently loaded projects in SystemIO. They may be stale.
export const homeLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (): Promise<HomeLoaderData | Response> => {
    app.registry.get(cloudSyncService).setProjectScope(undefined)

    // If on unflagged web, bump out to root, which will redirect to a project.
    if (!window.electron && !(await webHomeRouteEnabled(app))) {
      return redirect(PATHS.INDEX)
    }

    return loadHomeProjects(app)
  }
