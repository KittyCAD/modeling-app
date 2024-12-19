import { ActionFunction, LoaderFunction, redirect } from 'react-router-dom'
import { FileLoaderData, HomeLoaderData, IndexLoaderData } from './types'
import { getProjectMetaByRouteId, PATHS } from './paths'
import { isDesktop } from './isDesktop'
import { BROWSER_PATH } from 'lib/paths'
import {
  BROWSER_FILE_NAME,
  BROWSER_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
} from 'lib/constants'
import { loadAndValidateSettings } from './settings/settingsUtils'
import makeUrlPathRelative from './makeUrlPathRelative'
import { codeManager } from 'lib/singletons'
import { fileSystemManager } from 'lang/std/fileSystemManager'
import { getProjectInfo } from './desktop'
import { createSettings } from './settings/initialSettings'
import { normalizeLineEndings } from 'lib/codeEditor'
import { OnboardingStatus } from 'wasm-lib/kcl/bindings/OnboardingStatus'

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

export const telemetryLoader: LoaderFunction = async ({
  params,
}): Promise<null> => {
  return null
}

// Redirect users to the appropriate onboarding page if they haven't completed it
export const onboardingRedirectLoader: ActionFunction = async (args) => {
  const { settings } = await loadAndValidateSettings()
  const onboardingStatus: OnboardingStatus =
    settings.app.onboardingStatus.current || ''
  const notEnRouteToOnboarding = !args.request.url.includes(
    PATHS.ONBOARDING.INDEX
  )
  // '' is the initial state, 'completed' and 'dismissed' are the final states
  const hasValidOnboardingStatus =
    onboardingStatus.length === 0 ||
    !(onboardingStatus === 'completed' || onboardingStatus === 'dismissed')
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
          )}`
        )
      }

      code = await window.electron.readFile(currentFilePath, {
        encoding: 'utf-8',
      })
      code = normalizeLineEndings(code)

      // If persistCode in localStorage is present, it'll persist that code
      // through *anything*. INTENDED FOR TESTS.
      code = codeManager.localStoragePersistCode() || code

      // Update both the state and the editor's code.
      // We explicitly do not write to the file here since we are loading from
      // the file system and not the editor.
      codeManager.updateCurrentFilePath(currentFilePath)
      // We pass true on the end here to clear the code editor history.
      // This way undo and redo are not super weird when opening new files.
      codeManager.updateCodeStateEditor(code, true)
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
    }

    const maybeProjectInfo = isDesktop()
      ? await getProjectInfo(projectPath)
      : null

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
    code,
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
  if (!isDesktop()) {
    return redirect(PATHS.FILE + '/%2F' + BROWSER_PROJECT_NAME)
  }
  return {}
}
