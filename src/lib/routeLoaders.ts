import { ActionFunction, LoaderFunction, redirect } from 'react-router-dom'
import { HomeLoaderData, IndexLoaderData } from './types'
import { isTauri } from './isTauri'
import { getProjectMetaByRouteId, paths } from './paths'
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
import { sep } from '@tauri-apps/api/path'
import { readDir, readTextFile } from '@tauri-apps/api/fs'
import { metadata } from 'tauri-plugin-fs-extra-api'
import { kclManager } from 'lang/KclSingleton'
import { fileSystemManager } from 'lang/std/fileSystemManager'

// The root loader simply resolves the settings and any errors that
// occurred during the settings load
export const settingsLoader: LoaderFunction = async ({
  params,
}): ReturnType<typeof loadAndValidateSettings> => {
  let settings = await loadAndValidateSettings()

  // I don't love that we have to read the settings again here,
  // but we need to get the project path to load the project settings
  if (params.id) {
    const defaultDir = settings.app.projectDirectory.current || ''
    const projectPathData = getProjectMetaByRouteId(params.id, defaultDir)
    if (projectPathData) {
      const { projectPath } = projectPathData
      settings = await loadAndValidateSettings(projectPath)
    }
  }

  return settings
}

// Redirect users to the appropriate onboarding page if they haven't completed it
export const onboardingRedirectLoader: ActionFunction = async ({ request }) => {
  const settings = await loadAndValidateSettings()
  const onboardingStatus = settings.app.onboardingStatus.current || ''
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
  let settings = await loadAndValidateSettings()

  const defaultDir = settings.app.projectDirectory.current || ''
  const projectPathData = getProjectMetaByRouteId(params.id, defaultDir)

  if (params.id !== BROWSER_FILE_NAME && projectPathData) {
    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    if (!currentFileName || !currentFilePath)
      return redirect(
        `${paths.FILE}/${encodeURIComponent(
          `${params.id}${sep}${PROJECT_ENTRYPOINT}`
        )}`
      )

    // TODO: PROJECT_ENTRYPOINT is hardcoded
    // until we support setting a project's entrypoint file
    const code = await readTextFile(currentFilePath)
    const entrypointMetadata = await metadata(
      projectPath + sep + PROJECT_ENTRYPOINT
    )
    const children = await readDir(projectPath, { recursive: true })
    kclManager.setCodeAndExecute(code, false)

    // Set the file system manager to the project path
    // So that WASM gets an updated path for operations
    fileSystemManager.dir = projectPath

    const projectData: IndexLoaderData = {
      code,
      project: {
        name: projectName,
        path: projectPath,
        children,
        entrypointMetadata,
      },
      file: {
        name: currentFileName,
        path: currentFilePath,
      },
    }

    return {
      ...projectData,
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
  const settings = await loadAndValidateSettings()

  console.log('settings', settings)
  const projectDir = await initializeProjectDirectory(
    settings.app.projectDirectory.current || (await getInitialDefaultDir())
  )

  if (projectDir.path) {
    if (projectDir.path !== settings.app.projectDirectory.current) {
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
