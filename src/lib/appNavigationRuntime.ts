/** Adapt the legacy App runtime to appNavigation's narrow operations. */

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import type { AppNavigationDependencies } from '@src/lib/appNavigation'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import { getParentAbsolutePath, PATHS } from '@src/lib/paths'
import {
  resolveProjectOpenRequest,
  type ResolvedProjectOpen,
} from '@src/lib/projectOpen'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { isRequestedFileLoaded } from '@src/lib/routeLoaderNavigation'
import {
  loadHomeProjects,
  webHomeRouteEnabled,
} from '@src/lib/routeLoaderUtils'
import { loadRouteSettings } from '@src/lib/routeSettings'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { SystemIOMachineStates } from '@src/machines/systemIO/states'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { waitFor } from 'xstate'

/**
 * Transitional App-backed implementation of opening a resolved project.
 *
 * Move these effects behind projectSession as ZDSProject, KclManager, settings,
 * and project I/O ownership leave the legacy App runtime.
 */
async function openResolvedProject(
  app: App,
  resolution: ResolvedProjectOpen,
  throwIfSuperseded: () => void
) {
  const settingsActor = app.settings.actor
  await waitFor(settingsActor, (state) => state.matches('idle'))
  throwIfSuperseded()
  settingsActor.send({
    type: 'load.project',
    project: resolution.project,
  })
  await waitFor(settingsActor, (state) => state.matches('idle'))
  throwIfSuperseded()

  const { project: projectRef, editor } = await app.registry
    .get(projectSession)
    .openProject({
      project: resolution.project,
      initialEditor: {
        path: resolution.initialEditorPath,
        providedEditor: app.singletons.kclManager,
        providedCode:
          window.electron?.process.env.NODE_ENV === 'test'
            ? app.singletons.kclManager.localStoragePersistCode()
            : undefined,
        isExecuting: true,
      },
      throwIfSuperseded,
    })
  throwIfSuperseded()
  if (!editor) {
    return Promise.reject(new Error('Project opened without an initial editor'))
  }

  const requestedFileName =
    app.systemIOActor.getSnapshot().context.requestedFileName
  if (
    isRequestedFileLoaded({
      requestedFileName,
      projectName: resolution.projectName,
      projectPath: resolution.projectPath,
      currentFilePath: resolution.file.path || null,
    })
  ) {
    requestedFileName.onProjectLoaderComplete?.()
  }

  const requestedProjectDirectoryPath =
    projectRef.projectIORefSignal.value.libraryPath ??
    getParentAbsolutePath(resolution.project.path)
  const systemIOSnapshot = app.systemIOActor.getSnapshot()
  const shouldSyncProjectDirectory =
    requestedProjectDirectoryPath !==
      systemIOSnapshot.context.projectDirectoryPath ||
    (systemIOSnapshot.matches(SystemIOMachineStates.idle) &&
      systemIOSnapshot.context.folders === undefined)
  if (shouldSyncProjectDirectory) {
    app.systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: { requestedProjectDirectoryPath },
    })
  }

  return {
    kind: 'opened' as const,
    data: {
      code: editor.code,
      project: resolution.project,
      file: { ...resolution.file, children: [] },
    },
  }
}

/**
 * Adapt the legacy App runtime to appNavigation's narrow dependency boundary.
 *
 * This is transitional strangler infrastructure. Replace the App parameter
 * with registry-owned capabilities as project opening and home navigation are
 * decoupled, then compose appNavigation directly from those capabilities.
 */
export function createAppNavigationDependencies(
  app: App
): AppNavigationDependencies {
  const fileOperations = app.registry.get(fileOperationsService)

  return {
    resolveProjectOpen: (request, throwIfSuperseded) =>
      resolveProjectOpenRequest(
        {
          wasmInstancePromise: app.singletons.kclManager.wasmInstancePromise,
          loadSettings: (wasmInstance, projectPath) =>
            loadRouteSettings(app, wasmInstance, projectPath),
          getCurrentProjectPath: () =>
            app.project?.projectIORefSignal.value.path,
          getProjectLibraryOwnership,
          getProjectInfo: (projectPath, wasmInstance) =>
            getProjectInfo(fileOperations, projectPath, wasmInstance),
          stat: fileOperations.stat,
          isPathNotFoundError,
          setProjectDirectory: (projectPath) => {
            projectFsManager.dir = projectPath
          },
        },
        request,
        throwIfSuperseded
      ),
    openResolvedProject: (resolution, throwIfSuperseded) =>
      openResolvedProject(app, resolution, throwIfSuperseded),
    projectOpened: (outcome, resolution, request) => {
      const appUrl = app.registry.get(appUrlService)
      if (request.startup) {
        void appUrl.navigate(
          appUrl.formatUrl({
            destination: {
              type: 'project',
              target: resolution.canonicalTarget,
            },
            ...request.startup,
          }),
          { replace: true }
        )
        return
      }

      const openedFilePath = outcome.data.file?.path
      if (openedFilePath) {
        void appUrl.navigate(
          `${PATHS.FILE}/${encodeURIComponent(openedFilePath)}`
        )
      }
    },
    showHome: async (openProject) => {
      if (!window.electron && !(await webHomeRouteEnabled(app))) {
        const { initIndexRoute } = await import('@src/lib/routeInit')
        const result = await initIndexRoute(app, {
          urlState: { search: '', hash: '' },
        })
        if (
          result.kind === 'transition' &&
          result.destination.type === 'project'
        ) {
          await openProject({ target: result.destination.target })
        }
        return
      }

      loadHomeProjects(app)
      void app.registry.get(appUrlService).navigate(PATHS.HOME)
    },
  }
}
