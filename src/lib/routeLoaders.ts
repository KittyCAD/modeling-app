import type { LoaderFunction } from 'react-router-dom'
import fsZds from '@src/lib/fs-zds'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { normalizeLineEndings } from '@src/lib/codeEditor'
import { getProjectInfo } from '@src/lib/desktop'
import { readAppSettingsFile } from '@src/lib/desktop'
import {
  PATHS,
  getParentAbsolutePath,
  getProjectMetaByRouteId,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import type { KclManager } from '@src/lang/KclManager'
import type { SystemIOActor } from '@src/lib/app'
import type {
  FileLoaderData,
  HomeLoaderData,
  IndexLoaderData,
} from '@src/lib/types'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type RustContext from '@src/lib/rustContext'
import type { SettingsActorType } from '@src/machines/settingsMachine'

/**
 * The base loader is used to reroute `/` root path requests,
 * to the home route on desktop, and to a constrained single project view on web.
 *
 * Once we get cloud storage or another solution we'll introduce the home, multi-project view on web.
 */
export const baseLoader =
  ({
    kclManager,
    systemIOActor,
  }: {
    kclManager: KclManager
    systemIOActor: SystemIOActor
  }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)

    // Desktop, redirect and return early
    if (window.electron) {
      return redirect(PATHS.HOME + (url.search || ''))
    }

    // Web, make a default project and redirect to it.
    const wasmInstance = await kclManager.wasmInstancePromise
    const defaultProjectName = 'demo-project'

    const settings = await loadAndValidateSettings(wasmInstance, undefined)

    const requestedProjectName = fsZds.resolve(
      settings.settings.app.projectDirectory.current,
      defaultProjectName
    )

    // We have to create and/or navigate to a project on web.
    try {
      await fsZds.stat(requestedProjectName)
      systemIOActor.send({
        type: SystemIOMachineEvents.navigateToProject,
        data: { requestedProjectName },
      })
    } catch {
      systemIOActor.send({
        type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject,
        data: {
          requestedProjectName,
          files: [
            {
              requestedFileName: 'main.kcl',
              requestedProjectName: defaultProjectName,
              requestedCode:
                '// This is the code editor. Code will appear here as you sketch!',
            },
          ],
        },
      })
    }
  }

export const fileLoader =
  ({
    kclManager,
    rustContext,
    systemIOActor,
    settingsActor,
  }: {
    kclManager: KclManager
    rustContext: RustContext
    systemIOActor: SystemIOActor
    settingsActor: SettingsActorType
  }): LoaderFunction =>
  async (routerData): Promise<FileLoaderData | Response> => {
    const { params } = routerData

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
    let code = ''

    if (!projectPathData)
      return Promise.reject(new Error('projectPathData falsey'))

    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    const urlObj = new URL(routerData.request.url)

    if (!urlObj.pathname.endsWith('/settings')) {
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

      try {
        await fsZds.stat(projectPath)
      } catch (e) {
        if (e === 'ENOENT') {
          return redirect(PATHS.HOME)
        }
      }

      const fallbackFile = (await getProjectInfo(projectPath, wasmInstance))
        .default_file

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

      code = await fsZds.readFile(currentFilePath, {
        encoding: 'utf-8',
      })
      code = normalizeLineEndings(code)

      // If persistCode in localStorage is present, it'll persist that code
      // through *anything*. INTENDED FOR TESTS.
      if (window.electron?.process.env.NODE_ENV === 'test') {
        code = kclManager.localStoragePersistCode() || code
      }

      // Update both the state and the editor's code.
      kclManager.updateCurrentFilePath(currentFilePath)
      kclManager.updateCodeEditor(code, {
        shouldExecute: true,
        // This way undo and redo are not super weird when opening new files.
        shouldClearHistory: true,
        shouldResetCamera: true,
        // We explicitly do not write to the file here since we are loading from
        // the file system and not the editor.
        shouldWriteToDisk: false,
      })
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
    await rustContext.sendOpenProject(project, currentFilePath)

    // Fire off the event to load the project settings
    // once we know it's idle.
    await waitFor(settingsActor, (state) => state.matches('idle'))
    settingsActor.send({
      type: 'load.project',
      project,
    })

    const appProjectDir = settings.settings.app.projectDirectory.current
    const requestedProjectDirectoryPath = project.path.includes(appProjectDir)
      ? appProjectDir
      : getParentAbsolutePath(project.path) // Fallback to parent directory if foreign to app project dir
    systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: {
        requestedProjectDirectoryPath,
      },
    })

    const projectData: IndexLoaderData = {
      code,
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
    settingsActor,
    systemIOActor,
  }: {
    settingsActor: SettingsActorType
    systemIOActor: SystemIOActor
  }): LoaderFunction =>
  async ({ request }): Promise<HomeLoaderData | Response> => {
    // If on web, bump out to root, which will redirect to a project.
    if (!window.electron) {
      return redirect(PATHS.INDEX)
    }

    systemIOActor.send({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    settingsActor.send({
      type: 'clear.project',
    })
    return {}
  }
