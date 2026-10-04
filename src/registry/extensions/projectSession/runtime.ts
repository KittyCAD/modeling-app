/** Adapt the legacy App runtime to appNavigation's narrow operations. */

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import {
  downloadCloudProjectView,
  isValidProjectFilePath,
  resolveCloudProjectSource,
} from '@src/lib/cloudProjectOpen'
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
import fsZds, {
  createReadOnlyProjectSnapshot,
  disposeReadOnlyProjectSnapshot,
  isReadOnlyProjectPath,
} from '@src/lib/fs-zds'
import { isPersonalCloudProjectLibrarySetting } from '@src/lib/projectLibraries'
import type { OpenProjectRequest } from '@src/registry/contracts/projectSession'
import type { Project } from '@src/lib/project'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import { getParentAbsolutePath, PATHS } from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { isRequestedFileLoaded } from '@src/lib/routeLoaderNavigation'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { SystemIOMachineStates } from '@src/machines/systemIO/states'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { projectSession } from '@src/registry/contracts/projectSession'
import { settingsService } from '@src/registry/contracts/settings'
import { waitFor } from 'xstate'
import toast from 'react-hot-toast'
import {
  type ProjectNavigationDependencies,
  resolveProjectOpenRequest,
  type ResolvedProjectOpen,
} from './navigation'

async function resolveCloudOpen(
  app: App,
  request: OpenProjectRequest,
  assertCurrent: () => void
): Promise<ResolvedProjectOpen> {
  if (!app.auth.isLoggedIn.value || !request.cloudProjectId) {
    return Promise.reject(new Error('Sign in to open this project.'))
  }
  if (request.target && !isValidProjectFilePath(request.target)) {
    return Promise.reject(new Error('Invalid project file path.'))
  }
  const settings = app.registry.get(settingsService)
  const fileOperations = app.registry.get(fileOperationsService)
  const loadedSettings = await settings.loadOrCreate()
  assertCurrent()
  const config = { enabled: true, token: app.auth.token.value }
  const source = await resolveCloudProjectSource(config, request.cloudProjectId)
  assertCurrent()
  const wasm = await app.wasmPromise
  assertCurrent()
  let project: Project
  let entrypoint: string
  if (source.source.canEdit) {
    const library = loadedSettings.settings.app.libraries?.current?.find(
      isPersonalCloudProjectLibrarySetting
    )
    if (!library)
      return Promise.reject(
        new Error('Enable the Personal Cloud library to edit this project.')
      )
    const cloud = await app.registry
      .get(cloudSyncService)
      .ensureProjectLocallySynced(
        source.source.id,
        await getCloudProjectLibraryMaterializationDirectoryPath(library)
      )
    assertCurrent()
    if (!cloud)
      return Promise.reject(
        new Error('Enable Cloud Sync to edit this project.')
      )
    project = await getProjectInfo(fileOperations, cloud.projectPath, wasm)
    assertCurrent()
    entrypoint =
      source.entrypoint && isValidProjectFilePath(source.entrypoint)
        ? fsZds.join(project.path, source.entrypoint)
        : project.default_file
  } else {
    const snapshot = await downloadCloudProjectView(
      config,
      source,
      assertCurrent
    )
    const viewPath = await createReadOnlyProjectSnapshot(snapshot.files)
    try {
      assertCurrent()
      project = await getProjectInfo(fileOperations, viewPath, wasm)
      assertCurrent()
      entrypoint = fsZds.join(viewPath, snapshot.entrypoint)
    } catch (error) {
      await disposeReadOnlyProjectSnapshot(viewPath)
      return Promise.reject(error)
    }
  }
  project = {
    ...project,
    title: source.title,
    default_file: entrypoint,
    cloudSource: source.source,
  }
  try {
    let path = request.target
      ? fsZds.join(project.path, request.target)
      : entrypoint
    if (!path.endsWith('.kcl') || !(await fileOperations.exists(path)))
      path = entrypoint
    assertCurrent()
    return {
      ...projectResolution(project, path),
      disposeIfUnused: async () => {
        if (app.project?.path !== project.path)
          await disposeReadOnlyProjectSnapshot(project.path)
      },
    }
  } catch (error) {
    await disposeReadOnlyProjectSnapshot(project.path)
    return Promise.reject(error)
  }
}

function projectResolution(
  project: Project,
  path: string
): ResolvedProjectOpen {
  projectFsManager.dir = project.path
  return {
    kind: 'resolved',
    project,
    projectName: project.name,
    projectPath: project.path,
    initialEditorPath: path,
    file: { name: fsZds.basename(path), path },
    canonicalTarget: path,
  }
}

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
export function createProjectNavigationDependencies(
  app: App
): ProjectNavigationDependencies {
  const fileOperations = app.registry.get(fileOperationsService)
  const settings = app.registry.get(settingsService)

  return {
    resolveProjectOpen: async (request, throwIfSuperseded) => {
      if (request.cloudProjectId) {
        const session = app.registry.get(projectSession)
        session.setCloudOpenError(undefined)
        try {
          return await resolveCloudOpen(app, request, throwIfSuperseded)
        } catch (error) {
          throwIfSuperseded()
          session.setCloudOpenError({
            projectId: request.cloudProjectId,
            message:
              error instanceof Error
                ? error.message
                : 'Unable to open this project.',
          })
          return Promise.reject(error)
        }
      }
      const current = app.project?.projectIORefSignal.value
      if (
        current?.cloudSource &&
        isValidProjectFilePath(
          fsZds.relative(current.path, request.target).replaceAll('\\', '/')
        )
      ) {
        if (await fileOperations.exists(request.target)) {
          throwIfSuperseded()
          return projectResolution(current, request.target)
        }
      }
      // Cache filesystem paths are never a public way to reopen a viewer.
      if (isReadOnlyProjectPath(request.target))
        return Promise.reject(
          new Error('Open this project using its cloud URL.')
        )
      return resolveProjectOpenRequest(
        {
          wasmInstancePromise: app.singletons.kclManager.wasmInstancePromise,
          loadSettings: settings.loadOrCreate,
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
      )
    },
    openResolvedProject: async (resolution, throwIfSuperseded) => {
      try {
        return await openResolvedProject(app, resolution, throwIfSuperseded)
      } catch (error) {
        throwIfSuperseded()
        if (resolution.project.cloudSource) {
          app.registry.get(projectSession).setCloudOpenError({
            projectId: resolution.project.cloudSource.id,
            message:
              error instanceof Error
                ? error.message
                : 'Unable to open this project.',
          })
        }
        return Promise.reject(error)
      }
    },
    projectOpened: (outcome, resolution, request) => {
      const appUrl = app.registry.get(appUrlService)
      const source = resolution.project.cloudSource
      if (source) {
        const relative = fsZds
          .relative(resolution.project.path, resolution.initialEditorPath)
          .replaceAll('\\', '/')
        if (
          request.cloudProjectId &&
          request.target &&
          request.target !== relative
        ) {
          toast('That file is unavailable. Opened the default KCL file.')
        }
        void appUrl.navigate(
          appUrl.formatUrl({
            ...request.startup,
            destination: {
              type: 'cloud-project',
              projectId: source.id,
              ...(resolution.initialEditorPath !==
              resolution.project.default_file
                ? { file: relative }
                : {}),
            },
            search: request.startup?.search ?? '',
            hash: request.startup?.hash ?? '',
          }),
          { replace: Boolean(request.startup) }
        )
        return
      }
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
  }
}
