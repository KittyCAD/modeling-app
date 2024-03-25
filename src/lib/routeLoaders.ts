import { ActionFunction, LoaderFunction, redirect } from 'react-router-dom'
import { FileEntry, HomeLoaderData, IndexLoaderData } from './types'
import { isTauri } from './isTauri'
import { paths } from './paths'
import { BROWSER_FILE_NAME } from 'Router'
import { SETTINGS_PERSIST_KEY } from 'lib/constants'
import { loadAndValidateSettings } from './settings/settingsUtils'
import {
  getInitialDefaultDir,
  getProjectsInDir,
  initializeProjectDirectory,
  PROJECT_ENTRYPOINT,
} from './tauriFS'
import makeUrlPathRelative from './makeUrlPathRelative'
import { join, sep } from '@tauri-apps/api/path'
import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { kclManager } from 'lib/singletons'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { invoke } from '@tauri-apps/api/core'

// The root loader simply resolves the settings and any errors that
// occurred during the settings load
export const indexLoader: LoaderFunction = async (): ReturnType<
  typeof loadAndValidateSettings
> => {
  return await loadAndValidateSettings()
}

// Redirect users to the appropriate onboarding page if they haven't completed it
export const onboardingRedirectLoader: ActionFunction = async ({ request }) => {
  const { settings } = await loadAndValidateSettings()
  const onboardingStatus = settings.onboardingStatus || ''
  const notEnRouteToOnboarding = !request.url.includes(paths.ONBOARDING.INDEX)
  // '' is the initial state, 'done' and 'dismissed' are the final states
  const hasValidOnboardingStatus =
    onboardingStatus.length === 0 ||
    !(onboardingStatus === 'done' || onboardingStatus === 'dismissed')
  const shouldRedirectToOnboarding =
    notEnRouteToOnboarding && hasValidOnboardingStatus

  if (shouldRedirectToOnboarding) {
    return redirect(
      makeUrlPathRelative(paths.ONBOARDING.INDEX) + onboardingStatus.slice(1)
    )
  }

  return null
}

export const fileLoader: LoaderFunction = async ({
  params,
}): Promise<IndexLoaderData | Response> => {
  const { settings } = await loadAndValidateSettings()

  const defaultDir = settings.defaultDirectory || ''

  if (params.id && params.id !== BROWSER_FILE_NAME) {
    const decodedId = decodeURIComponent(params.id)
    const projectAndFile = decodedId.replace(defaultDir + sep(), '')
    const firstSlashIndex = projectAndFile.indexOf(sep())
    const projectName = projectAndFile.slice(0, firstSlashIndex)
    const projectPath = await join(defaultDir, projectName)
    const currentFileName = projectAndFile.slice(firstSlashIndex + 1)

    if (firstSlashIndex === -1 || !currentFileName)
      return redirect(
        `${paths.FILE}/${encodeURIComponent(
          await join(params.id, PROJECT_ENTRYPOINT)
        )}`
      )

    // TODO: PROJECT_ENTRYPOINT is hardcoded
    // until we support setting a project's entrypoint file
    const code = await readTextFile(decodedId)
    const entrypointMetadata = await stat(
      await join(projectPath, PROJECT_ENTRYPOINT)
    )
    const children = await invoke<FileEntry[]>('read_dir_recursive', {
      path: projectPath,
    })
    kclManager.setCodeAndExecute(code, false)

    // Set the file system manager to the project path
    // So that WASM gets an updated path for operations
    fileSystemManager.dir = projectPath

    return {
      code,
      project: {
        name: projectName,
        path: projectPath,
        children,
        entrypointMetadata,
      },
      file: {
        name: currentFileName,
        path: params.id,
      },
    }
  }

  return {
    code: '',
  }
}

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred
export const homeLoader: LoaderFunction = async (): Promise<
  HomeLoaderData | Response
> => {
  if (!isTauri()) {
    return redirect(paths.FILE + '/' + BROWSER_FILE_NAME)
  }
  const { settings } = await loadAndValidateSettings()
  const projectDir = await initializeProjectDirectory(
    settings.defaultDirectory || (await getInitialDefaultDir())
  )

  if (projectDir.path) {
    if (projectDir.path !== settings.defaultDirectory) {
      localStorage.setItem(
        SETTINGS_PERSIST_KEY,
        JSON.stringify({
          ...settings,
          defaultDirectory: projectDir,
        })
      )
    }
    const projects = await getProjectsInDir(projectDir.path)

    return {
      projects,
    }
  } else {
    return {
      projects: [],
    }
  }
}
