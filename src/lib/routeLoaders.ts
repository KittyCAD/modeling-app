import { ActionFunction, LoaderFunction, redirect } from 'react-router-dom'
import { FileLoaderData, HomeLoaderData, IndexLoaderData } from './types'
import { isTauri } from './isTauri'
import { getProjectMetaByRouteId, paths } from './paths'
import { BROWSER_PATH } from 'lib/paths'
import {
  BROWSER_FILE_NAME,
  BROWSER_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
} from 'lib/constants'
import { loadAndValidateSettings } from './settings/settingsUtils'
import makeUrlPathRelative from './makeUrlPathRelative'
import { sep } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { codeManager, kclManager } from 'lib/singletons'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import {
  getProjectInfo,
  initializeProjectDirectory,
  listProjects,
} from './tauri'
import { createSettings } from './settings/initialSettings'

// The root loader simply resolves the settings and any errors that
// occurred during the settings load
export const settingsLoader: LoaderFunction = async ({
  params,
}): Promise<
  ReturnType<typeof createSettings> | ReturnType<typeof redirect>
> => {
  let { settings, configuration } = await loadAndValidateSettings()

  // I don't love that we have to read the settings again here,
  // but we need to get the project path to load the project settings
  if (params.id) {
    const projectPathData = await getProjectMetaByRouteId(
      params.id,
      configuration
    )
    if (projectPathData) {
      const { project_name } = projectPathData
      const { settings: s } = await loadAndValidateSettings(project_name || undefined)
      settings = s
    }
  }

  return settings
}

// Redirect users to the appropriate onboarding page if they haven't completed it
export const onboardingRedirectLoader: ActionFunction = async (args) => {
  const { settings } = await loadAndValidateSettings()
  const onboardingStatus = settings.app.onboardingStatus.current || ''
  const notEnRouteToOnboarding = !args.request.url.includes(
    paths.ONBOARDING.INDEX
  )
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

  return settingsLoader(args)
}

export const fileLoader: LoaderFunction = async ({
  params,
}): Promise<FileLoaderData | Response> => {
  let { configuration } = await loadAndValidateSettings()

  const projectPathData = await getProjectMetaByRouteId(
    params.id,
    configuration
  )
  const isBrowserProject = params.id === decodeURIComponent(BROWSER_PATH)

  if (!isBrowserProject && projectPathData) {
    const { project_name, project_path, current_file_name, current_file_path } =
      projectPathData

    if (!current_file_name || !current_file_path || !project_name) {
      return redirect(
        `${paths.FILE}/${encodeURIComponent(
          `${params.id}${isTauri() ? sep() : '/'}${PROJECT_ENTRYPOINT}`
        )}`
      )
    }

    // TODO: PROJECT_ENTRYPOINT is hardcoded
    // until we support setting a project's entrypoint file
    const code = await readTextFile(current_file_path)

    // Update both the state and the editor's code.
    // We explicitly do not write to the file here since we are loading from
    // the file system and not the editor.
    codeManager.updateCurrentFilePath(current_file_path)
    codeManager.updateCodeStateEditor(code)
    kclManager.executeCode(true)

    // Set the file system manager to the project path
    // So that WASM gets an updated path for operations
    fileSystemManager.dir = project_path

    const projectData: IndexLoaderData = {
      code,
      project: isTauri()
        ? await getProjectInfo(project_path, configuration)
        : {
            name: project_name,
            path: project_path,
            children: [],
            kcl_file_count: 0,
            directory_count: 0,
            metadata: null,
          },
      file: {
        name: current_file_name,
        path: current_file_path,
        children: [],
      },
    }

    return {
      ...projectData,
    }
  }

  return {
    code: '',
    project: {
      name: BROWSER_PROJECT_NAME,
      path: '/' + BROWSER_PROJECT_NAME,
      children: [],
    },
    file: {
      name: BROWSER_FILE_NAME,
      path: decodeURIComponent(BROWSER_PATH),
      children: [],
    },
  }
}

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred
export const homeLoader: LoaderFunction = async (): Promise<
  HomeLoaderData | Response
> => {
  if (!isTauri()) {
    return redirect(paths.FILE + '/%2F' + BROWSER_PROJECT_NAME)
  }
  const { configuration } = await loadAndValidateSettings()

  const projectDir = await initializeProjectDirectory(configuration)

  if (projectDir) {
    const projects = await listProjects(configuration)

    return {
      projects,
    }
  } else {
    return {
      projects: [],
    }
  }
}
