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

async function openResolvedProject(
  app: App,
  resolution: ResolvedProjectOpen,
  assertCurrent: () => void
) {
  const settingsActor = app.settings.actor
  await waitFor(settingsActor, (state) => state.matches('idle'))
  assertCurrent()
  settingsActor.send({
    type: 'load.project',
    project: resolution.project,
  })
  await waitFor(settingsActor, (state) => state.matches('idle'))
  assertCurrent()

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

export function createAppNavigationDependencies(
  app: App
): AppNavigationDependencies {
  const fileOperations = app.registry.get(fileOperationsService)

  return {
    resolveProjectOpen: (request, assertCurrent) =>
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
          isDesktop: () => Boolean(window.electron),
        },
        request,
        assertCurrent
      ),
    openResolvedProject: (resolution, assertCurrent) =>
      openResolvedProject(app, resolution, assertCurrent),
    projectOpened: (outcome, request) => {
      const openedFilePath = outcome.data.file?.path
      if (openedFilePath && !request.requestUrl) {
        void app.registry
          .get(appUrlService)
          .navigate(`${PATHS.FILE}/${encodeURIComponent(openedFilePath)}`)
      }
    },
    showHome: async (openProject) => {
      if (!window.electron && !(await webHomeRouteEnabled(app))) {
        const appUrl = app.registry.get(appUrlService)
        const { initIndexRoute } = await import('@src/lib/routeInit')
        const result = await initIndexRoute(app, {
          requestUrl: new URL(PATHS.INDEX, window.location.href).href,
        })
        if (result.kind === 'redirect') {
          const requestUrl = new URL(result.to, window.location.href).href
          const intent = appUrl.readInitialUrl({
            requestUrl,
            usesHashRouter: false,
          })
          if (
            intent.type === 'launch' &&
            intent.destination.type === 'project'
          ) {
            await openProject({ target: intent.destination.target })
          }
        }
        return
      }

      loadHomeProjects(app)
      void app.registry.get(appUrlService).navigate(PATHS.HOME)
    },
  }
}
