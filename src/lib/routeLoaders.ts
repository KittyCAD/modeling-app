import { ActionFunction, LoaderFunction, redirect } from 'react-router-dom'
import { FileLoaderData, HomeLoaderData, IndexLoaderData } from './types'
<<<<<<< HEAD
import { getProjectMetaByRouteId, PATHS } from './paths'
import { isDesktop } from './isDesktop'
||||||| parent of 1f27643b (Merge main)
import { isTauri } from './isTauri'
import { getProjectMetaByRouteId, paths } from './paths'
=======
import { isTauri } from './isTauri'
import { getProjectMetaByRouteId, PATHS } from './paths'
>>>>>>> 1f27643b (Merge main)
import { BROWSER_PATH } from 'lib/paths'
import {
  BROWSER_FILE_NAME,
  BROWSER_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
} from 'lib/constants'
import { loadAndValidateSettings } from './settings/settingsUtils'
import makeUrlPathRelative from './makeUrlPathRelative'
<<<<<<< HEAD
||||||| parent of 1f27643b (Merge main)
import { sep } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { codeManager, kclManager } from 'lib/singletons'
=======
import { sep } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'
>>>>>>> 1f27643b (Merge main)
import { codeManager } from 'lib/singletons'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import {
  getProjectInfo,
  ensureProjectDirectoryExists,
  listProjects,
} from './desktop'
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
      const { projectPath } = projectPathData
      const { settings: s } = await loadAndValidateSettings(
        projectPath || undefined
      )
      return s
    }
  }

  return settings
}

// Redirect users to the appropriate onboarding page if they haven't completed it
export const onboardingRedirectLoader: ActionFunction = async (args) => {
  const { settings } = await loadAndValidateSettings()
  const onboardingStatus = settings.app.onboardingStatus.current || ''
  const notEnRouteToOnboarding = !args.request.url.includes(
    PATHS.ONBOARDING.INDEX
  )
  // '' is the initial state, 'done' and 'dismissed' are the final states
  const hasValidOnboardingStatus =
    onboardingStatus.length === 0 ||
    !(onboardingStatus === 'done' || onboardingStatus === 'dismissed')
  const shouldRedirectToOnboarding =
    notEnRouteToOnboarding && hasValidOnboardingStatus

  if (shouldRedirectToOnboarding) {
    return redirect(
      makeUrlPathRelative(PATHS.ONBOARDING.INDEX) + onboardingStatus.slice(1)
    )
  }

  return settingsLoader(args)
}

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

  if (!isBrowserProject && projectPathData) {
    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

<<<<<<< HEAD
    const urlObj = new URL(routerData.request.url)
    let code = ''

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
          )}`
        )
      }

      code = await window.electron.readFile(currentFilePath)
      code = normalizeLineEndings(code)

      // Update both the state and the editor's code.
      // We explicitly do not write to the file here since we are loading from
      // the file system and not the editor.
      codeManager.updateCurrentFilePath(currentFilePath)
      codeManager.updateCodeStateEditor(code)
||||||| parent of 1f27643b (Merge main)
    if (!current_file_name || !current_file_path || !project_name) {
      return redirect(
        `${paths.FILE}/${encodeURIComponent(
          `${params.id}${isTauri() ? sep() : '/'}${PROJECT_ENTRYPOINT}`
        )}`
      )
=======
    if (!current_file_name || !current_file_path || !project_name) {
      return redirect(
        `${PATHS.FILE}/${encodeURIComponent(
          `${params.id}${isTauri() ? sep() : '/'}${PROJECT_ENTRYPOINT}`
        )}`
      )
>>>>>>> 1f27643b (Merge main)
    }

<<<<<<< HEAD
||||||| parent of 1f27643b (Merge main)
    // TODO: PROJECT_ENTRYPOINT is hardcoded
    // until we support setting a project's entrypoint file
    const code = await readTextFile(current_file_path)

    // Update both the state and the editor's code.
    // We explicitly do not write to the file here since we are loading from
    // the file system and not the editor.
    codeManager.updateCurrentFilePath(current_file_path)
    codeManager.updateCodeStateEditor(code)

    // We don't want to call await on execute code since we don't want to block the UI
    kclManager.executeCode(true)

=======
    // TODO: PROJECT_ENTRYPOINT is hardcoded
    // until we support setting a project's entrypoint file
    const code = await readTextFile(current_file_path)

    // Update both the state and the editor's code.
    // We explicitly do not write to the file here since we are loading from
    // the file system and not the editor.
    codeManager.updateCurrentFilePath(current_file_path)
    codeManager.updateCodeStateEditor(code)

>>>>>>> 1f27643b (Merge main)
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
    }

    const maybeProjectInfo = isDesktop()
      ? await getProjectInfo(projectPath)
      : null

    console.log('maybeProjectInfo', {
      maybeProjectInfo,
      defaultProjectData,
      projectPathData,
    })

    const projectData: IndexLoaderData = {
      code,
      project: maybeProjectInfo ?? defaultProjectData,
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
<<<<<<< HEAD
  if (!isDesktop()) {
||||||| parent of 1f27643b (Merge main)
  if (!isTauri()) {
    return redirect(paths.FILE + '/%2F' + BROWSER_PROJECT_NAME)
=======
  if (!isTauri()) {
>>>>>>> 1f27643b (Merge main)
    return redirect(PATHS.FILE + '/%2F' + BROWSER_PROJECT_NAME)
  }
  const { configuration } = await loadAndValidateSettings()

  const projectDir = await ensureProjectDirectoryExists(configuration)

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

const normalizeLineEndings = (str: string, normalized = '\n') => {
  return str.replace(/\r?\n/g, normalized)
}
