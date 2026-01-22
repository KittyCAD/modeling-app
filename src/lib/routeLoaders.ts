import type { LoaderFunction } from 'react-router-dom'
import fsZds from '@src/lib/fs-zds'
import path from 'path'
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
import type { SystemIOActor } from '@src/lib/singletons'
import type {
  FileLoaderData,
  HomeLoaderData,
  IndexLoaderData,
} from '@src/lib/types'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type RustContext from '@src/lib/rustContext'
import type { SettingsActorType } from '@src/machines/settingsMachine'

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
      ? params.id.split(path.sep).slice(0, -1).join(path.sep)
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
export const homeLoader =
  ({
    settingsActor,
  }: {
    settingsActor: SettingsActorType
  }): LoaderFunction =>
  async ({ request }): Promise<HomeLoaderData | Response> => {
    settingsActor.send({
      type: 'clear.project',
    })
    return {}
  }
