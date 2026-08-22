import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import type { ZDSProject, ZDSProjectRuntime } from '@src/lang/KclManager'
import fsZds from '@src/lib/fs-zds'
import { projectWithLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import {
  PATHS,
  joinRouterPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import { reportRejection } from '@src/lib/trap'
import {
  buildZookeeperHistoryExtension,
  type PreparedZookeeperPatchFileReplay,
} from '@src/lib/zookeeper/editorPlugin'
import { SystemIOMachineStates } from '@src/machines/systemIO/utils'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { commandSystemService } from '@src/registry/contracts/commands'
import { engineConnectionService } from '@src/registry/contracts/engineConnection'
import {
  type FsOperationBatch,
  fsOperationQueue,
} from '@src/registry/contracts/fsOperationQueue'
import { keymapService } from '@src/registry/contracts/keymap'
import {
  type ProjectSessionApplyFilePatchInput,
  type ProjectSessionEntryCopyMoveInput,
  type ProjectSessionEntryPathInput,
  type ProjectSessionEntryRenameInput,
  type ProjectSessionFileWriteInput,
  type ProjectSessionMutationOperation,
  type ProjectSessionMutationState,
  type ProjectSessionOpenEditorInput,
  type ProjectSessionService,
  projectSession,
} from '@src/registry/contracts/projectSession'
import {
  type ProjectLibraryRealization,
  projectLibraryRealizationsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { routerService } from '@src/registry/contracts/router'
import { settingsService } from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import fsOperationQueueRegistryItem from '@src/registry/extensions/fsOperationQueue'

function zookeeperReplayChangesProjectFileSet(
  replayFiles: readonly PreparedZookeeperPatchFileReplay[]
) {
  return replayFiles.some(
    (replayFile) =>
      replayFile.previousContent === null || replayFile.nextContent === null
  )
}

function getZookeeperReplayFallbackFilePath(
  project: ZDSProject,
  deletedPaths: Set<string>
) {
  const defaultFile = project.projectIORefSignal.value.default_file
  const candidates = [
    defaultFile,
    ...project.files.map((file) => file.path),
  ].filter((path, index, paths) => paths.indexOf(path) === index)

  return candidates.find((path) => path && !deletedPaths.has(path))
}

export const projectSessionExtension = defineRegistryItemFactory((ctx) => {
  const project = signal<ZDSProject | undefined>(undefined)
  const projectTree = signal(project.value?.projectIORefSignal.value)
  const projectLibraryRealizations = ctx.valueSpecs.signal(
    projectLibraryRealizationsValueSpec
  )
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  const mutation = signal<ProjectSessionMutationState>({ pending: false })
  let disposeProjectTreeSync: (() => void) | undefined
  let disposeProjectHistoryExtensions: (() => void) | undefined
  let disposeProjectLibraryRealizationSync: (() => void) | undefined
  let disposeSystemIOProjectTreeRefresh: (() => void) | undefined
  let lastProjectLibraryRedirectPath: string | undefined
  let seededCloudSyncOpenedProject = false

  const setMutation = ({
    pending,
    operation,
    targetPath,
    lastTargetPath,
  }: ProjectSessionMutationState) => {
    mutation.value = {
      pending,
      ...(operation ? { operation } : {}),
      ...(targetPath ? { targetPath } : {}),
      ...(lastTargetPath ? { lastTargetPath } : {}),
    }
  }

  const getRequiredProject = () => {
    const currentProject = project.value
    if (!currentProject) {
      return new Error('No project is currently open.')
    }
    return currentProject
  }

  const setCloudSyncOpenedProject = (nextProject?: Project) => {
    ctx.services.get(cloudSyncService).setOpenedProject(
      nextProject
        ? {
            projectPath: nextProject.path,
            ...(nextProject.libraryPath
              ? { libraryPath: nextProject.libraryPath }
              : {}),
            ...(nextProject.libraryType
              ? { libraryType: nextProject.libraryType }
              : {}),
          }
        : undefined
    )
    seededCloudSyncOpenedProject = Boolean(nextProject)
  }

  const clearCloudSyncOpenedProject = () => {
    if (!seededCloudSyncOpenedProject) {
      return
    }
    setCloudSyncOpenedProject(undefined)
  }

  const createProjectRuntime = (): ZDSProjectRuntime => {
    const wasmPromise =
      ctx.valueSpecs.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const settings = ctx.services.get(settingsService)
    const commands = ctx.services.get(commandSystemService)

    return {
      wasmPromise,
      settings: settings.actor,
      commandBar: commands.actor,
      engineCommandManager: ctx.services.get(engineConnectionService).manager,
      rustContext: ctx.services.get(rustContextService).context,
      userFeatures: ctx.services.get(userFeaturesService),
      keymap: ctx.services.get(keymapService),
    }
  }

  const syncProjectTree = () => {
    projectTree.value = project.value?.projectIORefSignal.value
    return projectTree.value
  }

  const sameProjectPath = (left: string, right: string) =>
    left.replaceAll('\\', '/') === right.replaceAll('\\', '/')

  const updateOpenedProjectTree = (
    openedProject: ZDSProject,
    nextProjectTree: Project
  ) => {
    const currentProjectTree = openedProject.projectIORefSignal.value
    const libraryPath =
      nextProjectTree.libraryPath ?? currentProjectTree.libraryPath
    const libraryType =
      nextProjectTree.libraryType ?? currentProjectTree.libraryType
    openedProject.projectIORefSignal.value = {
      ...nextProjectTree,
      ...(libraryPath ? { libraryPath } : {}),
      ...(libraryType ? { libraryType } : {}),
    }
    syncProjectTree()
  }

  const projectFromRealizationMetadata = (
    currentProjectTree: Project,
    realization: ProjectLibraryRealization
  ): Project => {
    const libraryRef =
      realization.libraryRefs.find(
        (ref) =>
          currentProjectTree.libraryPath &&
          sameProjectPath(ref.path, currentProjectTree.libraryPath)
      ) ?? realization.libraryRefs[0]

    return {
      ...currentProjectTree,
      name: realization.localProjectName,
      path: realization.localProjectPath,
      title: realization.title,
      default_file: realization.defaultFile ?? currentProjectTree.default_file,
      kcl_file_count:
        realization.kclFileCount ?? currentProjectTree.kcl_file_count,
      directory_count:
        realization.directoryCount ?? currentProjectTree.directory_count,
      readWriteAccess: realization.readWriteAccess,
      ...(libraryRef
        ? {
            libraryPath: libraryRef.path,
            libraryType: libraryRef.type,
          }
        : {}),
    }
  }

  const projectTreeMetadataMatches = (left: Project, right: Project) =>
    left.name === right.name &&
    sameProjectPath(left.path, right.path) &&
    left.title === right.title &&
    sameProjectPath(left.default_file, right.default_file) &&
    left.kcl_file_count === right.kcl_file_count &&
    left.directory_count === right.directory_count &&
    left.readWriteAccess === right.readWriteAccess &&
    left.libraryPath === right.libraryPath &&
    left.libraryType === right.libraryType

  const navigateToMovedProjectRealization = ({
    currentProject,
    realization,
  }: {
    currentProject: ZDSProject
    realization: ProjectLibraryRealization
  }) => {
    if (lastProjectLibraryRedirectPath === realization.localProjectPath) {
      return
    }

    const router = ctx.services.optional(routerService)
    if (!router?.isReady.value) {
      return
    }

    lastProjectLibraryRedirectPath = realization.localProjectPath
    const activeFilePath =
      currentProject.executingFileEntry?.value.path ??
      currentProject.projectIORefSignal.value.default_file
    const activeFileRelativePath = activeFilePath
      ? fsZds.relative(currentProject.path, activeFilePath)
      : ''
    const targetPath = activeFileRelativePath
      ? fsZds.join(realization.localProjectPath, activeFileRelativePath)
      : (realization.defaultFile ?? realization.localProjectPath)

    void router.navigate(
      joinRouterPaths(PATHS.FILE, safeEncodeForRouterPaths(targetPath))
    )
  }

  const findMovedProjectRealization = ({
    currentProjectTree,
    realizations,
  }: {
    currentProjectTree: Project
    realizations: readonly ProjectLibraryRealization[]
  }) => {
    const currentDisplayName = getProjectDisplayName(currentProjectTree)
    const candidates = realizations.filter(
      (realization) =>
        !sameProjectPath(
          realization.localProjectPath,
          currentProjectTree.path
        ) && realization.title === currentDisplayName
    )
    const sameLibraryCandidates = currentProjectTree.libraryPath
      ? candidates.filter((realization) =>
          realization.libraryRefs.some((ref) =>
            sameProjectPath(ref.path, currentProjectTree.libraryPath ?? '')
          )
        )
      : candidates

    return sameLibraryCandidates.length === 1
      ? sameLibraryCandidates[0]
      : undefined
  }

  const watchProjectLibraryRealizations = () => {
    disposeProjectLibraryRealizationSync?.()
    disposeProjectLibraryRealizationSync = effect(() => {
      const currentProject = project.value
      if (!currentProject) {
        return
      }

      const currentProjectTree = currentProject.projectIORefSignal.value
      const realization = projectLibraryRealizations.value.find(
        (candidate) =>
          candidate.localProjectPath &&
          sameProjectPath(candidate.localProjectPath, currentProjectTree.path)
      )
      if (realization) {
        lastProjectLibraryRedirectPath = undefined
        const nextProjectTree = projectFromRealizationMetadata(
          currentProjectTree,
          realization
        )
        if (projectTreeMetadataMatches(currentProjectTree, nextProjectTree)) {
          return
        }
        updateOpenedProjectTree(currentProject, nextProjectTree)
        return
      }

      const movedRealization = findMovedProjectRealization({
        currentProjectTree,
        realizations: projectLibraryRealizations.value,
      })
      if (movedRealization) {
        navigateToMovedProjectRealization({
          currentProject,
          realization: movedRealization,
        })
      }
    })
  }

  const watchProjectTree = (nextProject: ZDSProject | undefined) => {
    disposeProjectTreeSync?.()
    disposeProjectTreeSync = undefined
    if (!nextProject) {
      projectTree.value = undefined
      return
    }

    disposeProjectTreeSync = effect(() => {
      projectTree.value = nextProject.projectIORefSignal.value
    })
  }

  const refreshProjectTree = async () => {
    const currentProject = project.value
    if (!currentProject) {
      projectTree.value = undefined
      return undefined
    }

    setMutation({
      pending: true,
      operation: 'refresh-project-tree',
      targetPath: currentProject.path,
      lastTargetPath: mutation.value.lastTargetPath,
    })
    try {
      projectTree.value = await currentProject.refreshProjectTree()
      return projectTree.value
    } finally {
      setMutation({
        pending: false,
        operation: 'refresh-project-tree',
        lastTargetPath: currentProject.path,
      })
    }
  }

  const watchSystemIOProjectTreeRefresh = () => {
    disposeSystemIOProjectTreeRefresh?.()
    disposeSystemIOProjectTreeRefresh = effect(() => {
      const systemIO = ctx.services.optional(systemIOService)
      if (!systemIO) {
        return
      }

      let observedFolderRead = false
      const subscription = systemIO.actor.subscribe((snapshot) => {
        if (snapshot.matches(SystemIOMachineStates.readingFolders)) {
          observedFolderRead = true
          return
        }

        if (
          !observedFolderRead ||
          !snapshot.matches(SystemIOMachineStates.idle)
        ) {
          return
        }

        observedFolderRead = false
        const currentProject = project.value
        if (!currentProject) {
          return
        }

        if (
          snapshot.context.lastOperation ===
            SystemIOMachineStates.renamingProject &&
          snapshot.context.requestedProjectName.title
        ) {
          updateOpenedProjectTree(currentProject, {
            ...currentProject.projectIORefSignal.value,
            title: snapshot.context.requestedProjectName.title,
          })
        }

        const refreshedProjectFromFolderRead = snapshot.context.folders?.find(
          (candidate) => sameProjectPath(candidate.path, currentProject.path)
        )
        if (refreshedProjectFromFolderRead) {
          updateOpenedProjectTree(
            currentProject,
            refreshedProjectFromFolderRead
          )
          return
        }

        currentProject
          .refreshProjectTree()
          .then((refreshedProjectTree) => {
            if (project.value === currentProject) {
              updateOpenedProjectTree(currentProject, refreshedProjectTree)
            }
          })
          .catch(reportRejection)
      })

      return () => {
        observedFolderRead = false
        subscription.unsubscribe()
      }
    })
  }

  const watchProjectHistoryExtensions = () => {
    const systemIOActor = ctx.services.get(systemIOService).actor

    disposeProjectHistoryExtensions?.()
    disposeProjectHistoryExtensions = effect(() => {
      const currentProject = project.value
      const executingEditor = currentProject?.executingEditor.value
      if (!currentProject || !executingEditor) {
        return
      }

      const disposeFSHistory = buildFSHistoryExtension(
        systemIOActor,
        executingEditor
      )
      const disposeZookeeperHistory = buildZookeeperHistoryExtension({
        kclManager: executingEditor,
        onCurrentFileDelete: async (deletedPaths) => {
          const fallbackPath = getZookeeperReplayFallbackFilePath(
            currentProject,
            deletedPaths
          )
          if (!fallbackPath) {
            return Promise.reject(
              new Error(
                'Cannot replay this Zookeeper edit because no fallback KCL file is available.'
              )
            )
          }

          await currentProject.openEditor(fallbackPath, executingEditor)
        },
        onActiveFileRestore: async (restoredPath, restoredContents) => {
          await currentProject.openEditor(
            restoredPath,
            executingEditor,
            restoredContents
          )
        },
        onProjectFilesReplay: async (replayFiles) => {
          await currentProject.syncReplayedFilesToRust(replayFiles)
          if (zookeeperReplayChangesProjectFileSet(replayFiles)) {
            await serviceImpl.refreshProjectTree()
          }
        },
      })

      return () => {
        disposeFSHistory()
        disposeZookeeperHistory()
      }
    })
  }

  const openProject = async (projectIORef: Project) => {
    setMutation({
      pending: true,
      operation: 'open-project',
      targetPath: projectIORef.path,
      lastTargetPath: mutation.value.lastTargetPath,
    })

    try {
      const currentProject = project.value
      if (currentProject?.path === projectIORef.path) {
        updateOpenedProjectTree(currentProject, projectIORef)
        const reseededProject = currentProject.projectIORefSignal.value
        setCloudSyncOpenedProject(reseededProject)
        setMutation({
          pending: false,
          operation: 'open-project',
          lastTargetPath: currentProject.path,
        })
        return currentProject
      }

      serviceImpl.clearProject()
      const ownedProject = await projectWithLibraryOwnership(
        projectIORef,
        ctx.services.get(settingsService).get().app.libraries.current
      )
      const projectIORefSignal = signal(ownedProject)
      const { ZDSProject } = await import('@src/lang/KclManager')
      const openedProject = await ZDSProject.open(
        projectIORefSignal,
        createProjectRuntime(),
        serviceImpl
      )
      serviceImpl.setProject(openedProject)
      setCloudSyncOpenedProject(ownedProject)
      watchProjectHistoryExtensions()
      setMutation({
        pending: false,
        operation: 'open-project',
        lastTargetPath: openedProject.path,
      })
      return openedProject
    } catch (error) {
      serviceImpl.clearProject()
      setMutation({
        pending: false,
        operation: 'open-project',
        lastTargetPath: projectIORef.path,
      })
      return Promise.reject(error)
    }
  }

  const runProjectOperation = async <Result>(
    operation: ProjectSessionMutationOperation,
    targetPath: string | undefined,
    run: (currentProject: ZDSProject) => Promise<Result>,
    options: { refreshProjectTree?: boolean } = {}
  ) => {
    const currentProject = getRequiredProject()
    if (currentProject instanceof Error) {
      return Promise.reject(currentProject)
    }

    setMutation({
      pending: true,
      operation,
      targetPath,
      lastTargetPath: mutation.value.lastTargetPath,
    })
    try {
      const result = await run(currentProject)
      if (options.refreshProjectTree ?? true) {
        projectTree.value = await currentProject.refreshProjectTree()
      } else {
        syncProjectTree()
      }
      setMutation({
        pending: false,
        operation,
        lastTargetPath: targetPath,
      })
      return result
    } catch (error) {
      setMutation({
        pending: false,
        operation,
        lastTargetPath: targetPath,
      })
      return Promise.reject(error)
    }
  }

  const runProjectMutation = <Result>(
    operation: ProjectSessionMutationOperation,
    targetPath: string | undefined,
    run: (
      currentProject: ZDSProject,
      fileSystemOperations: FsOperationBatch
    ) => Promise<Result>,
    options: { refreshProjectTree?: boolean } = {}
  ) =>
    ctx.services.get(fsOperationQueue).batch(
      {
        kind: operation,
        targetPath,
        metadata: { service: 'projectSession' },
      },
      (fileSystemOperations) =>
        runProjectOperation(
          operation,
          targetPath,
          (currentProject) => run(currentProject, fileSystemOperations),
          options
        )
    )

  const serviceImpl: ProjectSessionService = {
    project,
    projectTree,
    currentProjectLibraryId,
    mutation,
    getProject: () => project.value,
    getFileSystemOperations: () => ctx.services.get(fsOperationQueue),
    openProject,
    setProject: (nextProject) => {
      project.value = nextProject
      watchProjectTree(nextProject)
      if (nextProject) {
        watchProjectLibraryRealizations()
        watchSystemIOProjectTreeRefresh()
      }
    },
    clearProject: () => {
      disposeProjectHistoryExtensions?.()
      disposeProjectHistoryExtensions = undefined
      disposeProjectLibraryRealizationSync?.()
      disposeProjectLibraryRealizationSync = undefined
      disposeSystemIOProjectTreeRefresh?.()
      disposeSystemIOProjectTreeRefresh = undefined
      lastProjectLibraryRedirectPath = undefined
      project.value?.close?.()
      project.value = undefined
      watchProjectTree(undefined)
      clearCloudSyncOpenedProject()
    },
    getProjectTree: () => projectTree.value,
    refreshProjectTree,
    openEditor: (input: ProjectSessionOpenEditorInput) =>
      runProjectOperation(
        'open-editor',
        input.path,
        (currentProject) =>
          currentProject.openEditor(
            input.path,
            input.editor,
            input.code,
            input.isExecuting
          ),
        { refreshProjectTree: false }
      ),
    closeEditor: (input: ProjectSessionEntryPathInput) => {
      setMutation({
        pending: true,
        operation: 'close-editor',
        targetPath: input.path,
        lastTargetPath: mutation.value.lastTargetPath,
      })
      try {
        const currentProject = getRequiredProject()
        if (!(currentProject instanceof Error)) {
          currentProject.closeEditor(input.path)
        }
      } finally {
        setMutation({
          pending: false,
          operation: 'close-editor',
          lastTargetPath: input.path,
        })
      }
    },
    closeAllEditors: () => {
      setMutation({
        pending: true,
        operation: 'close-all-editors',
        lastTargetPath: mutation.value.lastTargetPath,
      })
      try {
        const currentProject = getRequiredProject()
        if (!(currentProject instanceof Error)) {
          currentProject.closeAllEditors()
        }
      } finally {
        setMutation({
          pending: false,
          operation: 'close-all-editors',
          lastTargetPath: mutation.value.lastTargetPath,
        })
      }
    },
    createFile: (input: ProjectSessionFileWriteInput) =>
      runProjectMutation('create-file', input.path, (currentProject, batch) =>
        currentProject.createFile(input, batch)
      ),
    writeFile: (input: ProjectSessionFileWriteInput) =>
      runProjectMutation('write-file', input.path, (currentProject, batch) =>
        currentProject.writeFile(input, batch)
      ),
    createFolder: (input: ProjectSessionEntryPathInput) =>
      runProjectMutation('create-folder', input.path, (currentProject, batch) =>
        currentProject.createFolder(input, batch)
      ),
    renameEntry: (input: ProjectSessionEntryRenameInput) =>
      runProjectMutation(
        'rename-entry',
        input.newPath,
        (currentProject, batch) => currentProject.renameEntry(input, batch)
      ),
    deleteEntry: (input: ProjectSessionEntryPathInput) =>
      runProjectMutation('delete-entry', input.path, (currentProject, batch) =>
        currentProject.deleteEntry(input, batch)
      ),
    copyEntry: (input: ProjectSessionEntryCopyMoveInput) =>
      runProjectMutation(
        'copy-entry',
        input.targetPath,
        (currentProject, batch) => currentProject.copyEntry(input, batch)
      ),
    moveEntry: (input: ProjectSessionEntryCopyMoveInput) =>
      runProjectMutation(
        'move-entry',
        input.targetPath,
        (currentProject, batch) => currentProject.moveEntry(input, batch)
      ),
    archiveEntry: (input: ProjectSessionEntryPathInput) =>
      runProjectMutation('archive-entry', input.path, (currentProject, batch) =>
        currentProject.archiveEntry(input, batch)
      ),
    applyFilePatch: (input: ProjectSessionApplyFilePatchInput) =>
      runProjectMutation(
        'apply-file-patch',
        input.files.at(-1)?.path,
        (currentProject, batch) => currentProject.applyFilePatch(input, batch)
      ),
    getCurrentProjectLibraryId: () => currentProjectLibraryId.value,
    setCurrentProjectLibraryId: (libraryId) => {
      currentProjectLibraryId.value = libraryId
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'project-session-extension',
      providesServices: [provideService(projectSession, serviceImpl)],
      dispose: () => {
        serviceImpl.clearProject()
      },
    }),
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [fsOperationQueueRegistryItem, projectSessionExtension],
})
