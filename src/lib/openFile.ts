/**
 * Opening a project and a file, as an application command.
 *
 * This used to live in the tail of the `/file/:id` route loader, which made a
 * URL navigation the only thing in the app that could open a file: everything
 * else "opened a file" by calling `navigate('/file/<encoded>')` and letting the
 * loader do the work. That is the wrong way round once application state is
 * meant to be authoritative, so it moves out here.
 *
 * The ordering below is load-bearing and is preserved exactly as the loader had
 * it. In particular:
 *
 * - `projectFsManager.dir` is a global the WASM layer reads, and it must be set
 *   before anything touches the project.
 * - the settings actor is waited to `idle` on *both* sides of `load.project`.
 * - `shouldSyncProjectDirectory` exists so that navigating between files in one
 *   directory does not restart SystemIO's own post-mutation folder refresh.
 */

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getProjectInfo } from '@src/lib/desktop'
import { getParentAbsolutePath } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { waitFor } from 'xstate'

/** The parts of a resolved route this needs; the shape `parseProjectRoute` returns. */
export type ResolvedProjectFile = {
  projectName: string | null | undefined
  projectPath: string
  currentFileName: string | null | undefined
  currentFilePath: string | null | undefined
}

export async function openProjectFile(
  app: App,
  {
    resolved,
    wasmInstance,
  }: {
    resolved: ResolvedProjectFile
    wasmInstance: Awaited<App['wasmPromise']>
  }
): Promise<IndexLoaderData> {
  const {
    settings: { actor: settingsActor },
  } = app
  const { kclManager } = app.singletons
  const { projectName, projectPath, currentFileName, currentFilePath } =
    resolved

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

  const maybeProjectInfo = await getProjectInfo(projectPath, wasmInstance)

  const project = maybeProjectInfo ?? defaultProjectData

  // Fire off the event to load the project settings
  // once we know it's idle.
  await waitFor(settingsActor, (state) => state.matches('idle'))
  settingsActor.send({
    type: 'load.project',
    project,
  })
  await waitFor(settingsActor, (state) => state.matches('idle'))

  const projectRef = await app.openProject(project)
  const editor = await projectRef.openEditor(
    currentFilePath || PROJECT_ENTRYPOINT,
    app.singletons.kclManager,
    // If persistCode in localStorage is present, it'll persist that code
    // through *anything*. INTENDED FOR TESTS.
    window.electron?.process.env.NODE_ENV === 'test'
      ? kclManager.localStoragePersistCode()
      : undefined
  )

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
    code: editor.code,
    project,
    file: {
      name: currentFileName || '',
      path: currentFilePath || '',
      children: [],
    },
  }
}
