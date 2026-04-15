import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import type { LoaderFunction } from 'react-router-dom'
import fsZds from '@src/lib/fs-zds'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { getInitialDefaultDir, getProjectInfo } from '@src/lib/desktop'
import { readAppSettingsFile } from '@src/lib/desktop'
import {
  PATHS,
  getParentAbsolutePath,
  getProjectMetaByRouteId,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import {
  loadAndValidateSettings,
  userHasFeature,
  WEB_APP_FILE_BROWSER_FEATURE_FLAG,
} from '@src/lib/settings/settingsUtils'
import type { App } from '@src/lib/app'
import type {
  FileLoaderData,
  HomeLoaderData,
  IndexLoaderData,
} from '@src/lib/types'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { projectSkeletonCreate } from '@src/lang/project'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

/**
 * The base loader is used to reroute `/` root path requests.
 */
export const baseLoader =
  ({
    app,
  }: {
    app: App
  }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)

    // Let another part of the system handle the "open with web/desktop"...
    if (url.searchParams.has('ask-open-desktop')) {
      return
    }

    if (window.electron) {
      return redirect(PATHS.HOME + (url.search || ''))
    }

    const wasmInstance = await app.singletons.kclManager.wasmInstancePromise
    const settings = await loadAndValidateSettings(wasmInstance, undefined)
    const requestedProjectName = fsZds.resolve(
      settings.settings.app.projectDirectory.current,
      DEFAULT_WEB_PROJECT_NAME
    )

    try {
      await fsZds.stat(requestedProjectName)
    } catch {
      await projectSkeletonCreate(
        fsZds.resolve(
          await getInitialDefaultDir(),
          DEFAULT_WEB_PROJECT_NAME,
          'main.kcl'
        )
      )
    }

    return redirect(
      `${PATHS.FILE}/${encodeURIComponent(requestedProjectName)}${url.search || ''}`
    )
  }

export const fileLoader =
  ({
    app,
  }: {
    app: App
  }): LoaderFunction =>
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

    let settings = await loadAndValidateSettings(
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
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(fallbackFile)}${new URL(routerData.request.url).search || ''}`
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

    const appProjectDir = settings.settings.app.projectDirectory.current
    const requestedProjectDirectoryPath = project.path.includes(appProjectDir)
      ? appProjectDir
      : getParentAbsolutePath(project.path) // Fallback to parent directory if foreign to app project dir
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
  ({
    app,
  }: {
    app: App
  }): LoaderFunction =>
  async ({ request }): Promise<HomeLoaderData | Response> => {
    const webAppFileBrowserEnabled =
      window.electron ||
      (await userHasFeature(WEB_APP_FILE_BROWSER_FEATURE_FLAG, false))

    if (!webAppFileBrowserEnabled) {
      const url = new URL(request.url)
      return redirect(PATHS.INDEX + (url.search || ''))
    }

    app.systemIOActor.send({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    app.closeProject()
    app.settings.actor.send({
      type: 'clear.project',
    })
    return {}
  }
