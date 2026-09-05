/**
 * Opening a project and a file, as an application command.
 *
 * This used to be the body of the `/file/:id` route loader, which made a URL
 * navigation the only thing in the app able to open a file: everything else
 * "opened a file" by calling `navigate('/file/<encoded>')` and letting the
 * loader do the work. That is the wrong way round once application state is
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
import { getProjectInfo } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  getParentAbsolutePath,
  getRouterSearchFromRequestUrl,
  getStringAfterLastSeparator,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { loadRouteSettings } from '@src/lib/routeSettings'
import type { IndexLoaderData } from '@src/lib/types'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { SystemIOMachineStates } from '@src/machines/systemIO/states'
import { waitFor } from 'xstate'

export type OpenFileOutcome =
  | { kind: 'opened'; data: IndexLoaderData }
  /** Only ever returned when a `requestUrl` was supplied. */
  | { kind: 'redirect'; to: string }

export async function openProjectFile(
  app: App,
  { id, requestUrl }: { id: string | undefined; requestUrl?: string }
): Promise<OpenFileOutcome> {
  const {
    settings: { actor: settingsActor },
  } = app
  const { kclManager } = app.singletons

  const wasmInstance = await kclManager.wasmInstancePromise

  // Resolve the project root before loading project settings. Loading project
  // settings from a selected file's parent folder creates project.toml in
  // nested folders and makes them look like project roots.
  const appSettings = await loadRouteSettings(app, wasmInstance)
  const currentProjectPath = app.project?.projectIORefSignal.value.path
  const targetLibraryPath = id
    ? (
        await getProjectLibraryOwnership(
          appSettings.settings.app.libraries?.current ?? [],
          id
        )
      )?.libraryPath
    : undefined
  const projectPathData = id
    ? parseProjectRoute(appSettings.configuration, id, {
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

  const { projectName, projectPath } = projectPathData
  let { currentFileName, currentFilePath } = projectPathData

  // Settings is reachable on a project root, so a `/settings` URL must not be
  // rewritten to the default file.
  const isSettingsUrl = requestUrl
    ? new URL(requestUrl).pathname.endsWith('/settings')
    : false

  if (!isSettingsUrl) {
    const fallbackFile = (await getProjectInfo(projectPath, wasmInstance))
      .default_file
    // NOTE: this shadows nothing now, but the `catch` below compares an Error
    // to the string 'ENOENT', so it never matches and this stays true.
    // Preserved verbatim: fixing it changes behaviour and belongs in its own
    // change with its own Playwright run.
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

    // Asked for the project rather than a file in it: its default file is what
    // was meant.
    const wantsProjectDefault =
      Boolean(projectPath) && !currentFileName && fileExists && Boolean(id)
    // Nothing usable was named, so fall back to the project default.
    const targetUnusable =
      !fileExists || !currentFileName || !currentFilePath || !projectName

    if (wantsProjectDefault) {
      if (requestUrl && id) {
        // Substituted into the whole request URL rather than rebuilt, so the
        // origin, any child route and the query string all survive untouched.
        return {
          kind: 'redirect',
          to: requestUrl.replace(
            safeEncodeForRouterPaths(id),
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
        return {
          kind: 'redirect',
          to: `${PATHS.FILE}/${encodeURIComponent(fallbackFile)}${routerSearch}`,
        }
      }
      currentFilePath = fallbackFile
      currentFileName = getStringAfterLastSeparator(fallbackFile)
    }
  }

  /**
   * Asking for what is already open changes nothing.
   *
   * This is load-bearing rather than an optimisation. Re-opening reassigns
   * `projectSignal`, and once the URL is derived from that signal, a navigation
   * whose loader re-opens the project changes the very state the URL is
   * computed from — so the writer fires again, supersedes the navigation before
   * React Router can commit it, and the app livelocks with the URL pinned to
   * where it started. Making this a no-op is what breaks that loop.
   *
   * The notifications below still run: SystemIO is waiting to hear that its
   * requested file arrived, and it does not care whether work was needed.
   */
  const alreadyOpen =
    app.project?.projectIORefSignal.value.path === projectPath &&
    app.project?.executingPathSignal.value?.value === currentFilePath

  if (!alreadyOpen) {
    // Set the file system manager to the project path
    // So that WASM gets an updated path for operations
    projectFsManager.dir = projectPath
  }

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

  let code = kclManager.code
  let projectRef = app.project

  if (!alreadyOpen) {
    // Fire off the event to load the project settings
    // once we know it's idle.
    await waitFor(settingsActor, (state) => state.matches('idle'))
    settingsActor.send({
      type: 'load.project',
      project,
    })
    await waitFor(settingsActor, (state) => state.matches('idle'))

    projectRef = await app.openProject(project)
    const editor = await projectRef.openEditor(
      currentFilePath || PROJECT_ENTRYPOINT,
      app.singletons.kclManager,
      // If persistCode in localStorage is present, it'll persist that code
      // through *anything*. INTENDED FOR TESTS.
      window.electron?.process.env.NODE_ENV === 'test'
        ? kclManager.localStoragePersistCode()
        : undefined
    )
    code = editor.code
  }

  if (!projectRef) {
    return Promise.reject(new Error('bug: no project after opening one'))
  }

  const requestedFileName =
    app.systemIOActor.getSnapshot().context.requestedFileName
  if (requestedFileName.project === projectName) {
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
      code,
      project,
      file: {
        name: currentFileName || '',
        path: currentFilePath || '',
        children: [],
      },
    },
  }
}
