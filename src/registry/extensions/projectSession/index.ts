import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal, type Signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import type { ZDSProject, ZDSProjectRuntime } from '@src/lang/KclManager'
import { projectWithLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import type { Project } from '@src/lib/project'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import {
  buildZookeeperHistoryExtension,
  type PreparedZookeeperPatchFileReplay,
} from '@src/lib/zookeeper/editorPlugin'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
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
import { settingsService } from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import fsOperationQueueRegistryItem from '@src/registry/extensions/fsOperationQueue'
import type { Subscription } from 'xstate'

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
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  const mutation = signal<ProjectSessionMutationState>({ pending: false })
  let disposeProjectTreeSync: (() => void) | undefined
  let disposeProjectHistoryExtensions: (() => void) | undefined
  let projectFoldersSubscription: Subscription | undefined
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

  const watchSystemIOProjectTree = (projectIORefSignal: Signal<Project>) => {
    projectFoldersSubscription?.unsubscribe()
    projectFoldersSubscription = ctx.services
      .get(systemIOService)
      .actor.subscribe(({ context }) => {
        const foundProject = (context.folders ?? []).find(
          (candidate) =>
            candidate.name === projectIORefSignal.value.name &&
            candidate.path === projectIORefSignal.value.path
        )
        if (foundProject && projectIORefSignal.value !== foundProject) {
          projectIORefSignal.value = {
            ...foundProject,
            ...(projectIORefSignal.value.libraryPath
              ? { libraryPath: projectIORefSignal.value.libraryPath }
              : {}),
            ...(projectIORefSignal.value.libraryType
              ? { libraryType: projectIORefSignal.value.libraryType }
              : {}),
          }
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
            systemIOActor.send({
              type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
            })
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
        const currentProjectIORef = currentProject.projectIORefSignal.value
        const reseededProject = {
          ...projectIORef,
          ...(currentProjectIORef.libraryPath
            ? { libraryPath: currentProjectIORef.libraryPath }
            : {}),
          ...(currentProjectIORef.libraryType
            ? { libraryType: currentProjectIORef.libraryType }
            : {}),
        }
        currentProject.projectIORefSignal.value = reseededProject
        syncProjectTree()
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
      watchSystemIOProjectTree(projectIORefSignal)
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
    },
    clearProject: () => {
      disposeProjectHistoryExtensions?.()
      disposeProjectHistoryExtensions = undefined
      projectFoldersSubscription?.unsubscribe()
      projectFoldersSubscription = undefined
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
