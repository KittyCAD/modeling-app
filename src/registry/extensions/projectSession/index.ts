import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import type { ZDSProject, ZDSProjectRuntime } from '@src/lang/KclManager'
import {
  createNewProjectDirectory,
  ensureProjectDirectoryExists,
  isPathNotFoundError,
  readAppSettingsFile,
} from '@src/lib/desktop'
import { getNextFileName, getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { getDefaultDirectoryProjectLibraryPath } from '@src/lib/projectLibraries'
import { invalidateProjectLibraryRealizations } from '@src/lib/projectLibraries/registry/invalidation'
import { projectWithLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import {
  buildZookeeperHistoryExtension,
  type PreparedZookeeperPatchFileReplay,
} from '@src/lib/zookeeper/editorPlugin'
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
  type ProjectSessionArchiveEntryInput,
  type ProjectSessionCreateKclFilesInput,
  type ProjectSessionEntryCopyMoveInput,
  type ProjectSessionEntryPathInput,
  type ProjectSessionEntryRenameInput,
  type ProjectSessionFileWriteInput,
  type ProjectSessionImportProjectFilesInput,
  type ProjectSessionMutationOperation,
  type ProjectSessionMutationState,
  type ProjectSessionOpenEditorInput,
  type ProjectSessionProjectFilesResult,
  type ProjectSessionRestoreEntryInput,
  type ProjectSessionService,
  type ProjectSessionWriteFileAtPathInput,
  projectSession,
} from '@src/registry/contracts/projectSession'
import { settingsService } from '@src/registry/contracts/settings'
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

function normalizePathForComparison(path: string) {
  const normalizedPath = fsZds.resolve(path).replace(/\\/g, '/')
  return fsZds.sep === '\\' ? normalizedPath.toLowerCase() : normalizedPath
}

function isPathAtOrUnder(path: string, parentPath: string) {
  const normalizedPath = normalizePathForComparison(path)
  const normalizedParentPath = normalizePathForComparison(parentPath)
  return (
    normalizedPath === normalizedParentPath ||
    normalizedPath.startsWith(`${normalizedParentPath}/`)
  )
}

async function getDirectoryEntryNames(path: string) {
  try {
    return await fsZds.readdir(path)
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return []
    }
    return Promise.reject(error)
  }
}

function projectEntriesFromNames(
  projectDirectoryPath: string,
  names: string[]
) {
  return names.map((name) => ({
    name,
    path: fsZds.join(projectDirectoryPath, name),
    children: [],
  }))
}

function relativePathInsideParent(path: string, parentPath: string) {
  if (!isPathAtOrUnder(path, parentPath)) {
    return undefined
  }

  const relativePath = fsZds.relative(parentPath, path)
  return relativePath && relativePath !== '.' ? relativePath : undefined
}

export const projectSessionExtension = defineRegistryItemFactory((ctx) => {
  const settings = ctx.services.signal(settingsService)
  const project = signal<ZDSProject | undefined>(undefined)
  const projectTree = signal(project.value?.projectIORefSignal.value)
  const currentProjectLibraryId = signal<string | undefined>(undefined)
  const mutation = signal<ProjectSessionMutationState>({ pending: false })
  let disposeProjectHistoryExtensions: (() => void) | undefined
  let seededCloudSyncOpenedProject = false
  let disposeProjectTreeEffect: (() => void) | undefined

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

  const getWasmPromise = () => {
    const wasmPromise = ctx.valueSpecs.get(wasmPromiseValueSpec)
    if (!wasmPromise) {
      return Promise.reject(new Error('Missing WASM promise registry value.'))
    }
    return wasmPromise
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

  const attachProjectTree = (nextProject: ZDSProject | undefined) => {
    disposeProjectTreeEffect?.()
    disposeProjectTreeEffect = undefined
    project.value = nextProject

    if (!nextProject) {
      projectTree.value = undefined
      return
    }

    disposeProjectTreeEffect = effect(() => {
      projectTree.value = nextProject.projectIORefSignal.value
    })
  }

  const refreshOpenProjectTreeForPath = async (targetPath: string) => {
    const currentProject = project.value
    if (
      currentProject &&
      (isPathAtOrUnder(targetPath, currentProject.path) ||
        isPathAtOrUnder(currentProject.path, targetPath))
    ) {
      projectTree.value = await currentProject.refreshProjectTree()
    } else {
      syncProjectTree()
    }
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

  const watchProjectHistoryExtensions = () => {
    disposeProjectHistoryExtensions?.()
    disposeProjectHistoryExtensions = effect(() => {
      const currentProject = project.value
      const executingEditor = currentProject?.executingEditor.value
      if (!currentProject || !executingEditor) {
        return
      }

      const disposeFSHistory = buildFSHistoryExtension(
        serviceImpl,
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

  const runQueuedMutation = <Result>(
    operation: ProjectSessionMutationOperation,
    targetPath: string | undefined,
    run: () => Promise<Result>
  ) =>
    ctx.services.get(fsOperationQueue).run(
      {
        kind: operation,
        targetPath,
        metadata: {
          service: 'projectSession',
        },
      },
      async () => {
        setMutation({
          pending: true,
          operation,
          targetPath,
          lastTargetPath: mutation.value.lastTargetPath,
        })
        try {
          const result = await run()
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
    )

  const getDefaultProjectDirectoryPath = async () => {
    const currentSettings = settings.value?.current.value
    const configuredProjectDirectoryPath = currentSettings
      ? getDefaultDirectoryProjectLibraryPath(
          currentSettings.app.libraries.current
        )
      : undefined
    if (configuredProjectDirectoryPath) {
      return configuredProjectDirectoryPath
    }

    const wasmInstance = await getWasmPromise()
    const configuration = await readAppSettingsFile(wasmInstance)
    if (configuration instanceof Error) {
      return Promise.reject(configuration)
    }

    const projectDirectoryPath =
      await ensureProjectDirectoryExists(configuration)
    if (!projectDirectoryPath) {
      return Promise.reject(
        new Error('Unable to determine the project directory.')
      )
    }

    return projectDirectoryPath
  }

  const getDefaultProjectName = () =>
    settings.value?.current.value.projects.defaultProjectName.current ||
    'project'

  const prepareProjectFileWrite = async ({
    projectDirectoryPath,
    requestedProjectName,
    useReservedProjectName,
  }: {
    projectDirectoryPath?: string
    requestedProjectName?: string
    useReservedProjectName?: boolean
  }) => {
    const resolvedProjectDirectoryPath =
      projectDirectoryPath ?? (await getDefaultProjectDirectoryPath())
    const targetProjectName = requestedProjectName || getDefaultProjectName()
    const projectName = useReservedProjectName
      ? targetProjectName
      : requestedProjectName
        ? targetProjectName
        : getUniqueProjectName(
            targetProjectName,
            projectEntriesFromNames(
              resolvedProjectDirectoryPath,
              await getDirectoryEntryNames(resolvedProjectDirectoryPath)
            )
          )
    const projectRoot = fsZds.join(resolvedProjectDirectoryPath, projectName)

    return {
      projectDirectoryPath: resolvedProjectDirectoryPath,
      projectName,
      projectRoot,
    }
  }

  const createKclFiles = (input: ProjectSessionCreateKclFilesInput) =>
    runQueuedMutation(
      'create-project-kcl-files',
      input.requestedProjectName,
      async (): Promise<ProjectSessionProjectFilesResult> => {
        if (input.files.length === 0) {
          return Promise.reject(
            new Error('Cannot create project files without any files.')
          )
        }

        const wasmInstance = await getWasmPromise()
        const writeProjectName =
          input.requestedProjectName ?? input.files[0]?.requestedProjectName
        const {
          projectDirectoryPath,
          projectName: resolvedWriteProjectName,
          projectRoot: writeProjectRoot,
        } = await prepareProjectFileWrite({
          projectDirectoryPath: input.projectDirectoryPath,
          requestedProjectName: writeProjectName,
          useReservedProjectName: input.useReservedProjectName,
        })
        let firstFileName: string | undefined
        let firstFilePath: string | undefined

        for (const file of input.files) {
          const fileRequestedProjectName =
            file.requestedProjectName ?? resolvedWriteProjectName
          const relativeFileDirectory = input.requestedProjectName
            ? relativePathInsideParent(
                fileRequestedProjectName,
                resolvedWriteProjectName
              )
            : undefined
          const targetProjectName = relativeFileDirectory
            ? resolvedWriteProjectName
            : fileRequestedProjectName
          const targetProjectRoot = fsZds.join(
            projectDirectoryPath,
            targetProjectName
          )
          const targetBaseDir = relativeFileDirectory
            ? fsZds.join(targetProjectRoot, relativeFileDirectory)
            : targetProjectRoot
          const fileName = input.override
            ? file.requestedFileName
            : (
                await getNextFileName({
                  entryName: file.requestedFileName,
                  baseDir: targetBaseDir,
                  wasmInstance,
                })
              ).name
          const projectRelativeFileName = relativeFileDirectory
            ? fsZds.join(relativeFileDirectory, fileName)
            : fileName

          await createNewProjectDirectory(
            targetProjectName,
            wasmInstance,
            file.requestedCode,
            undefined,
            projectRelativeFileName,
            projectDirectoryPath,
            input.requestedProjectTitle ?? targetProjectName
          )
          firstFileName ??= fileName
          firstFilePath ??= fsZds.join(
            targetProjectRoot,
            projectRelativeFileName
          )
        }

        invalidateProjectLibraryRealizations()
        await refreshOpenProjectTreeForPath(writeProjectRoot)

        const numberOfFiles = input.files.length
        const fileText = numberOfFiles > 1 ? 'files' : 'file'
        return {
          projectDirectoryPath,
          projectName: input.requestedProjectName ?? resolvedWriteProjectName,
          projectRoot: fsZds.join(
            projectDirectoryPath,
            input.requestedProjectName ?? resolvedWriteProjectName
          ),
          fileName: firstFileName,
          filePath: firstFilePath,
          message: input.override
            ? `Successfully overwrote ${numberOfFiles} ${fileText}`
            : `Successfully created ${numberOfFiles} ${fileText}`,
        }
      }
    )

  const importProjectFiles = (input: ProjectSessionImportProjectFilesInput) =>
    runQueuedMutation(
      'import-project-files',
      input.requestedProjectName,
      async (): Promise<ProjectSessionProjectFilesResult> => {
        if (input.files.length === 0) {
          return Promise.reject(
            new Error(
              'The shared project import did not include any files to write.'
            )
          )
        }

        const { projectDirectoryPath, projectName, projectRoot } =
          await prepareProjectFileWrite({
            projectDirectoryPath: input.projectDirectoryPath,
            requestedProjectName: input.requestedProjectName,
            useReservedProjectName: true,
          })
        const requestedFileNameWithExtension =
          input.requestedFileNameWithExtension || ''

        if (
          requestedFileNameWithExtension &&
          input.files.some(
            (file) => file.requestedFileName === requestedFileNameWithExtension
          ) === false
        ) {
          return Promise.reject(
            new Error(
              `The shared project entry file "${requestedFileNameWithExtension}" was not present in the imported files.`
            )
          )
        }

        await fsZds.mkdir(projectRoot, { recursive: true })
        for (const file of input.files) {
          const targetPath = fsZds.join(projectRoot, file.requestedFileName)
          await fsZds.mkdir(fsZds.dirname(targetPath), { recursive: true })
          await fsZds.writeFile(targetPath, Uint8Array.from(file.requestedData))
        }

        const filePath = requestedFileNameWithExtension
          ? fsZds.join(projectRoot, requestedFileNameWithExtension)
          : undefined
        if (filePath) {
          await fsZds.stat(filePath)
        }

        invalidateProjectLibraryRealizations()
        await refreshOpenProjectTreeForPath(projectRoot)

        return {
          projectDirectoryPath,
          projectName,
          projectRoot,
          fileName: requestedFileNameWithExtension,
          filePath,
          message: `Successfully imported project within "${projectName}"`,
        }
      }
    )

  const writeFileAtPath = (input: ProjectSessionWriteFileAtPathInput) =>
    runQueuedMutation('write-file-at-path', input.path, async () => {
      if (!input.overwrite) {
        try {
          await fsZds.stat(input.path)
          return Promise.reject(
            new Error(`File "${fsZds.basename(input.path)}" already exists.`)
          )
        } catch (error) {
          if (!isPathNotFoundError(error)) {
            return Promise.reject(error)
          }
        }
      }

      await fsZds.mkdir(fsZds.dirname(input.path), { recursive: true })
      await fsZds.writeFile(
        input.path,
        typeof input.contents === 'string'
          ? new TextEncoder().encode(input.contents)
          : input.contents
      )
      invalidateProjectLibraryRealizations()
      await refreshOpenProjectTreeForPath(input.path)
      return input.path
    })

  const openProjectFile = (input: ProjectSessionOpenEditorInput) =>
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
      attachProjectTree(nextProject)
    },
    clearProject: () => {
      disposeProjectHistoryExtensions?.()
      disposeProjectHistoryExtensions = undefined
      project.value?.close?.()
      attachProjectTree(undefined)
      clearCloudSyncOpenedProject()
    },
    getProjectTree: () => projectTree.value,
    getDefaultProjectDirectoryPath,
    waitForIdle: () => ctx.services.get(fsOperationQueue).waitForIdle(),
    refreshProjectTree,
    openEditor: openProjectFile,
    openFile: openProjectFile,
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
    createKclFiles,
    importProjectFiles,
    writeFileAtPath,
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
    archiveEntry: (input: ProjectSessionArchiveEntryInput) =>
      runProjectMutation('archive-entry', input.path, (currentProject, batch) =>
        currentProject.archiveEntry(input, batch)
      ),
    restoreEntry: (input: ProjectSessionRestoreEntryInput) =>
      runProjectMutation(
        'restore-entry',
        input.targetPath,
        (currentProject, batch) => currentProject.restoreEntry(input, batch)
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
