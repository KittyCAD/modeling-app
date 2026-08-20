import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import { fsOperationQueue } from '@src/registry/contracts/fsOperationQueue'
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
import fsOperationQueueRegistryItem from '@src/registry/extensions/fsOperationQueue'

export const projectSessionExtension = defineRegistryItemFactory((ctx) => {
  const project = signal<ZDSProject | undefined>(undefined)
  const projectTree = signal(project.value?.projectIORefSignal.value)
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  const mutation = signal<ProjectSessionMutationState>({ pending: false })
  let disposeProjectTreeSync: (() => void) | undefined

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

  const runProjectMutation = async <Result>(
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

  const runQueuedProjectMutation = <Result>(
    operation: ProjectSessionMutationOperation,
    targetPath: string | undefined,
    run: (currentProject: ZDSProject) => Promise<Result>,
    options: { refreshProjectTree?: boolean } = {}
  ) =>
    ctx.services.get(fsOperationQueue).run(
      {
        kind: operation,
        targetPath,
        metadata: {
          service: 'projectSession',
        },
      },
      () => runProjectMutation(operation, targetPath, run, options)
    )

  const serviceImpl: ProjectSessionService = {
    project,
    projectTree,
    currentProjectLibraryId,
    mutation,
    getProject: () => project.value,
    setProject: (nextProject) => {
      project.value = nextProject
      watchProjectTree(nextProject)
    },
    clearProject: () => {
      project.value = undefined
      watchProjectTree(undefined)
    },
    getProjectTree: () => projectTree.value,
    refreshProjectTree,
    openEditor: (input: ProjectSessionOpenEditorInput) =>
      runProjectMutation(
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
      runQueuedProjectMutation('create-file', input.path, (currentProject) =>
        currentProject.createFile(input)
      ),
    writeFile: (input: ProjectSessionFileWriteInput) =>
      runQueuedProjectMutation('write-file', input.path, (currentProject) =>
        currentProject.writeFile(input)
      ),
    createFolder: (input: ProjectSessionEntryPathInput) =>
      runQueuedProjectMutation('create-folder', input.path, (currentProject) =>
        currentProject.createFolder(input)
      ),
    renameEntry: (input: ProjectSessionEntryRenameInput) =>
      runQueuedProjectMutation(
        'rename-entry',
        input.newPath,
        (currentProject) => currentProject.renameEntry(input)
      ),
    deleteEntry: (input: ProjectSessionEntryPathInput) =>
      runQueuedProjectMutation('delete-entry', input.path, (currentProject) =>
        currentProject.deleteEntry(input)
      ),
    copyEntry: (input: ProjectSessionEntryCopyMoveInput) =>
      runQueuedProjectMutation(
        'copy-entry',
        input.targetPath,
        (currentProject) => currentProject.copyEntry(input)
      ),
    moveEntry: (input: ProjectSessionEntryCopyMoveInput) =>
      runQueuedProjectMutation(
        'move-entry',
        input.targetPath,
        (currentProject) => currentProject.moveEntry(input)
      ),
    archiveEntry: (input: ProjectSessionEntryPathInput) =>
      runQueuedProjectMutation('archive-entry', input.path, (currentProject) =>
        currentProject.archiveEntry(input)
      ),
    applyFilePatch: (input: ProjectSessionApplyFilePatchInput) =>
      runQueuedProjectMutation(
        'apply-file-patch',
        input.files.at(-1)?.path,
        (currentProject) => currentProject.applyFilePatch(input)
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
        disposeProjectTreeSync?.()
        disposeProjectTreeSync = undefined
      },
    }),
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [fsOperationQueueRegistryItem, projectSessionExtension],
})
