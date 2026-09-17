/**
 * Resolve an OpenProject application intent.
 *
 * This used to be the body of the `/file/:id` route loader, which made a URL
 * navigation the only thing in the app able to enter a project: everything
 * else did so by calling `navigate('/file/<encoded>')` and letting the loader
 * do the work. That is the wrong way round once application state is
 * authoritative, so the whole of it moves out here — resolution included.
 *
 * `requestUrl` is what makes this usable from both sides. Pass it and you may
 * get a `redirect` outcome back, because a URL can name a project root or a
 * file that is not usable, and the canonical URL then has to change. Omit it
 * and there is no URL to correct, so the same cases simply open the project's
 * default file instead. Callers that are not a route take the second form.
 *
 * The ordering here is load-bearing and preserved exactly as the loader had it:
 *
 * - the project root is resolved *before* project settings are loaded, because
 *   `loadRouteSettings` writes, and pointing it at a nested folder creates a
 *   `project.toml` that makes that folder look like a project root.
 * - `projectFsManager.dir` is a global the WASM layer reads, and must be set
 *   before anything touches the project.
 * - the settings actor is waited to `idle` on *both* sides of `load.project`.
 * - `shouldSyncProjectDirectory` exists so that navigating between files in one
 *   directory does not restart SystemIO's own post-mutation folder refresh.
 */

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import {
  getParentAbsolutePath,
  getRouterSearchFromRequestUrl,
  getStringAfterLastSeparator,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import {
  getOnboardingChildRoute,
  isRequestedFileLoaded,
} from '@src/lib/routeLoaderNavigation'
import { loadRouteSettings } from '@src/lib/routeSettings'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { SystemIOMachineStates } from '@src/machines/systemIO/states'
import type {
  AppNavigationService,
  OpenProjectOutcome,
  OpenProjectRequest,
} from '@src/registry/contracts/appNavigation'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { waitFor } from 'xstate'

async function openProjectFromRequest(
  app: App,
  { target, requestUrl }: OpenProjectRequest,
  assertCurrent: () => void
): Promise<OpenProjectOutcome> {
  const {
    settings: { actor: settingsActor },
  } = app
  const { kclManager } = app.singletons

  const wasmInstance = await kclManager.wasmInstancePromise
  assertCurrent()

  // Resolve the project root before loading project settings. Loading project
  // settings from a selected file's parent folder creates project.toml in
  // nested folders and makes them look like project roots.
  const appSettings = await loadRouteSettings(app, wasmInstance)
  assertCurrent()
  const currentProjectPath = app.project?.projectIORefSignal.value.path
  const targetLibraryPath = target
    ? (
        await getProjectLibraryOwnership(
          appSettings.settings.app.libraries?.current ?? [],
          target
        )
      )?.libraryPath
    : undefined
  assertCurrent()
  const projectPathData = target
    ? parseProjectRoute(appSettings.configuration, target, {
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

  const { projectName, projectPath } = projectPathData
  let { currentFileName, currentFilePath } = projectPathData

  // Settings is reachable on a project root, so a `/settings` URL must not be
  // rewritten to the default file.
  const isSettingsUrl = requestUrl
    ? new URL(requestUrl).pathname.endsWith('/settings')
    : false

  if (!isSettingsUrl) {
    const fallbackFile = (
      await getProjectInfo(
        app.registry.get(fileOperationsService),
        projectPath,
        wasmInstance
      )
    ).default_file
    assertCurrent()
    let fileExists = true
    if (currentFilePath && fileExists) {
      try {
        await app.registry.get(fileOperationsService).stat(currentFilePath)
        assertCurrent()
      } catch (e) {
        if (isPathNotFoundError(e)) {
          fileExists = false
        }
      }
    }

    // Asked for the project rather than a file in it: its default file is what
    // was meant.
    const wantsProjectDefault =
      Boolean(projectPath) && !currentFileName && fileExists && Boolean(target)
    // Nothing usable was named, so fall back to the project default.
    const targetUnusable =
      !fileExists || !currentFileName || !currentFilePath || !projectName

    if (wantsProjectDefault) {
      if (requestUrl && target) {
        // Substituted into the whole request URL rather than rebuilt, so the
        // origin, any child route and the query string all survive untouched.
        return {
          kind: 'redirect',
          to: requestUrl.replace(
            safeEncodeForRouterPaths(target),
            safeEncodeForRouterPaths(fallbackFile)
          ),
        }
      }
      currentFilePath = fallbackFile
      currentFileName = getStringAfterLastSeparator(fallbackFile)
    } else if (targetUnusable) {
      if (requestUrl) {
        const routerSearch = getRouterSearchFromRequestUrl(
          requestUrl,
          Boolean(window.electron)
        )
        const onboardingChildRoute = target
          ? getOnboardingChildRoute(requestUrl, target)
          : ''
        return {
          kind: 'redirect',
          to: `${PATHS.FILE}/${encodeURIComponent(
            fallbackFile
          )}${onboardingChildRoute}${routerSearch}`,
        }
      }
      currentFilePath = fallbackFile
      currentFileName = getStringAfterLastSeparator(fallbackFile)
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

  const { project: projectRef, editor } = await app.registry
    .get(projectSession)
    .openProject({
      project,
      initialEditor: {
        path: currentFilePath || PROJECT_ENTRYPOINT,
        providedEditor: app.singletons.kclManager,
        // If persistCode in localStorage is present, it'll persist that code
        // through *anything*. INTENDED FOR TESTS.
        providedCode:
          window.electron?.process.env.NODE_ENV === 'test'
            ? kclManager.localStoragePersistCode()
            : undefined,
        isExecuting: true,
      },
      assertCurrent,
    })
  assertCurrent()
  if (!editor) {
    return Promise.reject(new Error('Project opened without an initial editor'))
  }

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

  return {
    kind: 'opened',
    data: {
      code: editor.code,
      project,
      file: {
        name: currentFileName || '',
        path: currentFilePath || '',
        children: [],
      },
    },
  }
}

/** Build the application-intent coordinator around one App runtime. */
export function createAppNavigationService(app: App): AppNavigationService {
  let projectOpenGeneration = 0

  const beginProjectOpen = (signal = new AbortController().signal) => {
    const generation = ++projectOpenGeneration
    return () => {
      if (signal.aborted || generation !== projectOpenGeneration) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new DOMException('Superseded project open', 'AbortError')
      }
    }
  }

  return {
    openProject: (request) =>
      openProjectFromRequest(app, request, beginProjectOpen(request.signal)),
    supersedeProjectOpen: (signal) => {
      beginProjectOpen(signal)()
    },
  }
}
