import { projectSkeletonCreate } from '@src/lang/project'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import {
  getInitialDefaultDir,
  getProjectInfo,
  isPathNotFoundError,
} from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  getParentAbsolutePath,
  getRouterSearchFromRequestUrl,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import {
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import {
  loadHomeProjects,
  webHomeRouteEnabled,
} from '@src/lib/routeLoaderUtils'
import {
  getOnboardingChildRoute,
  isRequestedFileLoaded,
} from '@src/lib/routeLoaderNavigation'
import {
  type AppSettings,
  loadAndValidateSettings,
} from '@src/lib/settings/settingsUtils'
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

type FileLoaderDiagnosticStage =
  | 'loader'
  | 'wasm'
  | 'application-settings'
  | 'library-ownership'
  | 'project-settings'
  | 'fallback-project-info'
  | 'file-stat'
  | 'project-info'
  | 'settings-idle-before-load'
  | 'settings-idle-after-load'
  | 'open-project'
  | 'open-editor'

let fileLoaderDiagnosticInvocation = 0

// Temporary never-merge diagnostic. Keep awaits in the loader itself so the
// capture adds no promise turns and never receives project data or errors.
function fileLoaderDiagnostic() {
  const invocationId = ++fileLoaderDiagnosticInvocation
  let pending: FileLoaderDiagnosticStage | undefined
  const emit = (
    stage: FileLoaderDiagnosticStage,
    phase: 'start' | 'end' | 'returned' | 'redirected' | 'rejected'
  ) => {
    if (import.meta.env.VITE_FILE_LOADER_DIAGNOSTIC !== '1') return
    console.info(
      '__FILE_LOADER_DIAG__' +
        JSON.stringify({
          stage,
          invocationId,
          pageMs: performance.now(),
          phase,
        })
    )
  }
  return {
    start(stage: FileLoaderDiagnosticStage) {
      pending = stage
      emit(stage, 'start')
    },
    end(stage: FileLoaderDiagnosticStage) {
      pending = undefined
      emit(stage, 'end')
    },
    reject(stage: FileLoaderDiagnosticStage) {
      pending = undefined
      emit(stage, 'rejected')
    },
    finish(phase: 'returned' | 'redirected' | 'rejected') {
      if (pending && pending !== 'loader') emit(pending, 'rejected')
      emit('loader', phase)
    },
  }
}

type CanonicalWebProjectLibrary = {
  library: ProjectLibrarySetting
  projectPath: string
  defaultFilePath: string
}

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

async function getCanonicalWebProjectLibrary(
  settings: AppSettings['settings']
): Promise<CanonicalWebProjectLibrary> {
  const fallbackLibraryPath =
    settings.app.projectDirectory.current.trim() ||
    (await getInitialDefaultDir())
  const configuredLibrary = getDefaultDirectoryProjectLibrarySetting(
    settings.app.libraries?.current
  )
  const libraryPath = configuredLibrary?.path.trim()
    ? configuredLibrary.path
    : fallbackLibraryPath
  const library = {
    title: configuredLibrary?.title || DEFAULT_PROJECT_LIBRARY_TITLE,
    path: libraryPath,
    type: configuredLibrary?.type || DIRECTORY_PROJECT_LIBRARY_TYPE,
  }

  return {
    library,
    projectPath: fsZds.resolve(library.path, DEFAULT_WEB_PROJECT_NAME),
    defaultFilePath: fsZds.resolve(
      library.path,
      DEFAULT_WEB_PROJECT_NAME,
      PROJECT_ENTRYPOINT
    ),
  }
}

async function maybeGetExistingDefaultFilePath(
  app: App,
  projectPath: string,
  wasmInstance: Awaited<App['wasmPromise']>
) {
  try {
    const project = await getProjectInfo(
      app.registry.get(fileOperationsService),
      projectPath,
      wasmInstance
    )
    return project.default_file
  } catch {
    return undefined
  }
}

async function fileExists(app: App, filePath: string) {
  return app.registry.get(fileOperationsService).exists(filePath)
}

function redirectToFile(filePath: string, routerSearch: string) {
  return redirect(
    `${PATHS.FILE}/${encodeURIComponent(filePath)}${routerSearch}`
  )
}

/**
 * The base loader is used to reroute `/` root path requests,
 * to the home route on desktop, and to a constrained single project view on web.
 *
 * The OPFS cloud feature flag enables the home, multi-project view on web.
 */
export const baseLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)
    const routerSearch = getRouterSearchFromRequestUrl(
      request.url,
      Boolean(window.electron)
    )

    // Desktop, redirect and return early
    if (window.electron) {
      return redirect(PATHS.HOME + routerSearch)
    }

    // Let another part of the system handle the "open with web/desktop"...
    if (url.searchParams.has('ask-open-desktop')) {
      return
    }

    if (await webHomeRouteEnabled(app)) {
      return redirect(PATHS.HOME + routerSearch)
    }

    // Web, make a default project and redirect to it.
    const wasmInstance = await app.singletons.kclManager.wasmInstancePromise

    const { settings } = await loadRouteSettings(app, wasmInstance)
    const canonicalLibrary = await getCanonicalWebProjectLibrary(settings)
    let defaultFilePath =
      (await maybeGetExistingDefaultFilePath(
        app,
        canonicalLibrary.projectPath,
        wasmInstance
      )) ?? canonicalLibrary.defaultFilePath

    if (!(await fileExists(app, defaultFilePath))) {
      await projectSkeletonCreate(
        app.fileOperations,
        canonicalLibrary.defaultFilePath,
        settings.modeling.defaultUnit.current ?? DEFAULT_DEFAULT_LENGTH_UNIT,
        wasmInstance
      )
      defaultFilePath = canonicalLibrary.defaultFilePath
    }

    return redirectToFile(defaultFilePath, routerSearch)
  }

export const fileLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (routerData): Promise<FileLoaderData | Response> => {
    const diagnostic = fileLoaderDiagnostic()
    diagnostic.start('loader')
    let terminalPhase: 'returned' | 'redirected' | 'rejected' = 'rejected'
    try {
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
        const response = redirect(PATHS.HOME)
        terminalPhase = 'redirected'
        return response
      }

      diagnostic.start('wasm')
      const wasmInstance = await kclManager.wasmInstancePromise
      diagnostic.end('wasm')
      assertCurrent()

      // Resolve the project root before loading project settings. Loading project
      // settings from a selected file's parent folder creates project.toml in
      // nested folders and makes them look like project roots.
      diagnostic.start('application-settings')
      const appSettings = await loadRouteSettings(app, wasmInstance)
      diagnostic.end('application-settings')
      assertCurrent()
      const currentProjectPath = app.project?.projectIORefSignal.value.path
      if (params.id) diagnostic.start('library-ownership')
      const targetLibraryPath = params.id
        ? (
            await getProjectLibraryOwnership(
              appSettings.settings.app.libraries?.current ?? [],
              params.id
            )
          )?.libraryPath
        : undefined
      if (params.id) diagnostic.end('library-ownership')
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

      diagnostic.start('project-settings')
      await loadRouteSettings(app, wasmInstance, projectPathData.projectPath)
      diagnostic.end('project-settings')
      assertCurrent()

      const { projectName, projectPath, currentFileName, currentFilePath } =
        projectPathData

      const urlObj = new URL(routerData.request.url)

      if (!urlObj.pathname.endsWith('/settings')) {
        diagnostic.start('fallback-project-info')
        const fallbackFile = (
          await getProjectInfo(
            app.registry.get(fileOperationsService),
            projectPath,
            wasmInstance
          )
        ).default_file
        diagnostic.end('fallback-project-info')
        let fileExists = true
        if (currentFilePath && fileExists) {
          diagnostic.start('file-stat')
          try {
            await app.registry.get(fileOperationsService).stat(currentFilePath)
            diagnostic.end('file-stat')
          } catch (e) {
            diagnostic.reject('file-stat')
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
          const response = redirect(requestUrlWithDefaultFile)
          terminalPhase = 'redirected'
          return response
        }

        if (
          !fileExists ||
          !currentFileName ||
          !currentFilePath ||
          !projectName
        ) {
          const routerSearch = getRouterSearchFromRequestUrl(
            routerData.request.url,
            Boolean(window.electron)
          )
          const onboardingChildRoute = params.id
            ? getOnboardingChildRoute(routerData.request.url, params.id)
            : ''
          const response = redirect(
            `${PATHS.FILE}/${encodeURIComponent(
              fallbackFile
            )}${onboardingChildRoute}${routerSearch}`
          )
          terminalPhase = 'redirected'
          return response
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

      diagnostic.start('project-info')
      const maybeProjectInfo = await getProjectInfo(
        app.registry.get(fileOperationsService),
        projectPath,
        wasmInstance
      )
      diagnostic.end('project-info')
      assertCurrent()

      const project = maybeProjectInfo ?? defaultProjectData

      // Fire off the event to load the project settings
      // once we know it's idle.
      diagnostic.start('settings-idle-before-load')
      await waitFor(settingsActor, (state) => state.matches('idle'))
      diagnostic.end('settings-idle-before-load')
      assertCurrent()
      settingsActor.send({
        type: 'load.project',
        project,
      })
      diagnostic.start('settings-idle-after-load')
      await waitFor(settingsActor, (state) => state.matches('idle'))
      diagnostic.end('settings-idle-after-load')
      assertCurrent()

      diagnostic.start('open-project')
      const projectRef = await app.openProject(project, assertCurrent)
      diagnostic.end('open-project')
      diagnostic.start('open-editor')
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
      diagnostic.end('open-editor')
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

      terminalPhase = 'returned'
      return {
        ...projectData,
      }
    } finally {
      diagnostic.finish(terminalPhase)
    }
  }

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred

// Should also clear currently loaded projects in SystemIO. They may be stale.
export const homeLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (): Promise<HomeLoaderData | Response> => {
    // If on unflagged web, bump out to root, which will redirect to a project.
    if (!window.electron && !(await webHomeRouteEnabled(app))) {
      return redirect(PATHS.INDEX)
    }

    return loadHomeProjects(app)
  }
