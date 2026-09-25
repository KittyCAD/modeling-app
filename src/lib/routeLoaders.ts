import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import {
  getParentAbsolutePath,
  getRouterSearchFromRequestUrl,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import {
  getOnboardingChildRoute,
  isRequestedFileLoaded,
} from '@src/lib/routeLoaderNavigation'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import type {
  FileLoaderData,
  HomeLoaderData,
  IndexLoaderData,
} from '@src/lib/types'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

function loadRouteSettings(
  app: App,
  wasmInstance: Awaited<App['wasmPromise']>,
  projectPath?: string
) {
  return loadAndValidateSettings(
    app.registry.get(fileOperationsService),
    wasmInstance,
    {
      defaultProjectLibraries: app.registry.get(
        projectLibrarySettingDefaultsValueSpec
      ),
      projectLibrarySettingDefaultPolicies: app.registry.get(
        projectLibrarySettingDefaultPoliciesValueSpec
      ),
      extensionSettings: app.registry.get(settingsValueSpec),
      projectPath,
    }
  )
}

/**
 * The base loader reroutes `/` to the home route.
 */
export const baseLoader =
  (_: { app: App }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)
    const routerSearch = getRouterSearchFromRequestUrl(
      request.url,
      Boolean(window.electron)
    )

    // Let another part of the system handle the "open with web/desktop"...
    if (!window.electron && url.searchParams.has('ask-open-desktop')) {
      return
    }

    return redirect(PATHS.HOME + routerSearch)
  }

export const fileLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (routerData): Promise<FileLoaderData | Response> => {
    const assertCurrent = app.beginFileRouteLoad(routerData.request.signal)
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

    const wasmInstance = await kclManager.wasmInstancePromise
    assertCurrent()

    // Resolve the project root before loading project settings. Loading project
    // settings from a selected file's parent folder creates project.toml in
    // nested folders and makes them look like project roots.
    const appSettings = await loadRouteSettings(app, wasmInstance)
    assertCurrent()
    const currentProjectPath = app.project?.projectIORefSignal.value.path
    const targetLibraryPath = params.id
      ? (
          await getProjectLibraryOwnership(
            appSettings.settings.app.libraries?.current ?? [],
            params.id
          )
        )?.libraryPath
      : undefined
    const projectPathData = params.id
      ? parseProjectRoute(appSettings.configuration, params.id, {
          activeProjectPath: currentProjectPath,
          candidateProjectDirectories: targetLibraryPath
            ? [targetLibraryPath]
            : [],
        })
      : undefined

    if (!projectPathData) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

    await loadRouteSettings(app, wasmInstance, projectPathData.projectPath)
    assertCurrent()

    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    const urlObj = new URL(routerData.request.url)

    if (!urlObj.pathname.endsWith('/settings')) {
      const fallbackFile = (
        await getProjectInfo(
          app.registry.get(fileOperationsService),
          projectPath,
          wasmInstance
        )
      ).default_file
      let fileExists = true
      if (currentFilePath && fileExists) {
        try {
          await app.registry.get(fileOperationsService).stat(currentFilePath)
        } catch (e) {
          if (isPathNotFoundError(e)) {
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
        const onboardingChildRoute = params.id
          ? getOnboardingChildRoute(routerData.request.url, params.id)
          : ''
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(
            fallbackFile
          )}${onboardingChildRoute}${routerSearch}`
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

    const maybeProjectInfo = await getProjectInfo(
      app.registry.get(fileOperationsService),
      projectPath,
      wasmInstance
    )
    assertCurrent()

    const project = maybeProjectInfo ?? defaultProjectData

    // Fire off the event to load the project settings
    // once we know it's idle.
    await waitFor(settingsActor, (state) => state.matches('idle'))
    assertCurrent()
    settingsActor.send({
      type: 'load.project',
      project,
    })
    await waitFor(settingsActor, (state) => state.matches('idle'))
    assertCurrent()

    const projectRef = await app.openProject(project, assertCurrent)
    const editor = await projectRef.openEditor(
      currentFilePath || PROJECT_ENTRYPOINT,
      app.singletons.kclManager,
      // If persistCode in localStorage is present, it'll persist that code
      // through *anything*. INTENDED FOR TESTS.
      window.electron?.process.env.NODE_ENV === 'test'
        ? kclManager.localStoragePersistCode()
        : undefined,
      true,
      assertCurrent
    )
    assertCurrent()

    const requestedFileName =
      app.systemIOActor.getSnapshot().context.requestedFileName
    if (
      isRequestedFileLoaded({
        requestedFileName,
        projectName,
        projectPath,
        currentFilePath,
      })
    ) {
      requestedFileName.onProjectLoaderComplete?.()
    }

    const requestedProjectDirectoryPath =
      projectRef.projectIORefSignal.value.libraryPath ??
      getParentAbsolutePath(project.path)
    const systemIOSnapshot = app.systemIOActor.getSnapshot()
    // Same-directory file navigation should not restart SystemIO's own
    // post-mutation folder refresh.
    const shouldSyncProjectDirectory =
      requestedProjectDirectoryPath !==
        systemIOSnapshot.context.projectDirectoryPath ||
      (systemIOSnapshot.matches(SystemIOMachineStates.idle) &&
        systemIOSnapshot.context.folders === undefined)
    if (shouldSyncProjectDirectory) {
      app.systemIOActor.send({
        type: SystemIOMachineEvents.setProjectDirectoryPath,
        data: {
          requestedProjectDirectoryPath,
        },
      })
    }

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
    return loadHomeProjects(app)
  }
