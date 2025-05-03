import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'

import { fileSystemManager } from '@src/lang/std/fileSystemManager'
import { normalizeLineEndings } from '@src/lib/codeEditor'
import {
  BROWSER_FILE_NAME,
  BROWSER_PROJECT_NAME,
  FILE_EXT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { getProjectInfo } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { BROWSER_PATH, PATHS, getProjectMetaByRouteId } from '@src/lib/paths'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { codeManager } from '@src/lib/singletons'
import type {
  FileLoaderData,
  HomeLoaderData,
  IndexLoaderData,
} from '@src/lib/types'
import { settingsActor } from '@src/lib/singletons'
import { NAVIGATION_COMPLETE_EVENT } from '@src/machines/systemIO/utils'

export const fileLoader: LoaderFunction = async (
  routerData
): Promise<FileLoaderData | Response> => {
  const { params } = routerData
  let { configuration } = await loadAndValidateSettings()

  const projectPathData = await getProjectMetaByRouteId(
    params.id,
    configuration
  )
  const isBrowserProject = params.id === decodeURIComponent(BROWSER_PATH)

  let code = ''

  if (!isBrowserProject && projectPathData) {
    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    const urlObj = new URL(routerData.request.url)

    if (!urlObj.pathname.endsWith('/settings')) {
      const fallbackFile = isDesktop()
        ? (await getProjectInfo(projectPath)).default_file
        : ''
      let fileExists = isDesktop()
      if (currentFilePath && fileExists) {
        try {
          await window.electron.stat(currentFilePath)
        } catch (e) {
          if (e === 'ENOENT') {
            fileExists = false
          }
        }
      }

      if (!fileExists || !currentFileName || !currentFilePath || !projectName) {
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(
            isDesktop() ? fallbackFile : params.id + '/' + PROJECT_ENTRYPOINT
          )}${new URL(routerData.request.url).search || ''}`
        )
      }

      code = await window.electron.readFile(currentFilePath, {
        encoding: 'utf-8',
      })
      code = normalizeLineEndings(code)

      // If persistCode in localStorage is present, it'll persist that code
      // through *anything*. INTENDED FOR TESTS.
      if (window.electron.process.env.IS_PLAYWRIGHT) {
        code = codeManager.localStoragePersistCode() || code
      }

      // Update both the state and the editor's code.
      // We explicitly do not write to the file here since we are loading from
      // the file system and not the editor.
      codeManager.updateCurrentFilePath(currentFilePath)
      // We pass true on the end here to clear the code editor history.
      // This way undo and redo are not super weird when opening new files.
      codeManager.updateCodeStateEditor(code, true)
      window.dispatchEvent(new CustomEvent(NAVIGATION_COMPLETE_EVENT))
    }

    // Set the file system manager to the project path
    // So that WASM gets an updated path for operations
    fileSystemManager.dir = projectPath

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

    const maybeProjectInfo = isDesktop()
      ? await getProjectInfo(projectPath)
      : null

    const project = maybeProjectInfo ?? defaultProjectData

    // Fire off the event to load the project settings
    // once we know it's idle.
    await waitFor(settingsActor, (state) => state.matches('idle'))
    settingsActor.send({
      type: 'load.project',
      project,
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

  const project = {
    name: BROWSER_PROJECT_NAME,
    path: `/${BROWSER_PROJECT_NAME}`,
    children: [
      {
        name: `${BROWSER_FILE_NAME}.${FILE_EXT}`,
        path: BROWSER_PATH,
        children: [],
      },
    ],
    default_file: BROWSER_FILE_NAME,
    directory_count: 0,
    kcl_file_count: 1,
    metadata: null,
    readWriteAccess: true,
  }

  // Fire off the event to load the project settings
  // once we know it's idle.
  await waitFor(settingsActor, (state) => state.matches('idle'))
  settingsActor.send({
    type: 'load.project',
    project,
  })

  return {
    code,
    project,
    file: {
      name: BROWSER_FILE_NAME,
      path: decodeURIComponent(BROWSER_PATH),
      children: [],
    },
  }
}

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred
export const homeLoader: LoaderFunction = async ({
  request,
}): Promise<HomeLoaderData | Response> => {
  const url = new URL(request.url)
  if (!isDesktop()) {
    return redirect(
      PATHS.FILE + '/%2F' + BROWSER_PROJECT_NAME + (url.search || '')
    )
  }
  settingsActor.send({
    type: 'clear.project',
  })
  return {}
}
