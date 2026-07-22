import { projectSkeletonCreate } from '@src/lang/project'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import {
  getInitialDefaultDir,
  getProjectInfo,
  readAppSettingsFile,
} from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  getParentAbsolutePath,
  getProjectMetaByRouteId,
  getRouterSearchFromRequestUrl,
  PATHS,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import {
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibraryPath,
  getDefaultDirectoryProjectLibrarySetting,
  isPathInDirectoryProjectLibrary,
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
import { projectLibrarySettingDefaultsValueSpec } from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'

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

    const heuristicProjectFilePath = params.id
      ? params.id.split(fsZds.sep).slice(0, -1).join(fsZds.sep)
      : undefined

    const wasmInstance = await kclManager.wasmInstancePromise

    const settings = await loadRouteSettings(
      app,
      wasmInstance,
      heuristicProjectFilePath
    )

    const projectPathData = await getProjectMetaByRouteId(
      readAppSettingsFile,
      wasmInstance,
      params.id,
      settings.configuration
    )

    if (!projectPathData) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

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

    const appProjectDir =
      getDefaultDirectoryProjectLibraryPath(
        settings.settings.app.libraries?.current
      ) ?? ''
    const requestedProjectDirectoryPath = isPathInDirectoryProjectLibrary(
      project.path,
      appProjectDir
    )
      ? appProjectDir
      : getParentAbsolutePath(project.path) // Fallback to parent directory if foreign to app project dir.
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

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred

// Should also clear currently loaded projects in SystemIO. They may be stale.
export const homeLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (): Promise<HomeLoaderData | Response> => {
    // If on unflagged web, bump out to root, which will redirect to a project.
    if (!window.electron && !(await webHomeRouteEnabled(app))) {
      return redirect(PATHS.INDEX)
    }

    return loadHomeProjects(app)
  }
