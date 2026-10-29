import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import { DEFAULT_PROJECT_NAME } from '@src/lib/constants'
import { workflowActions as actions } from '@src/lib/fileSystem/workflows/actions'
import { FileWorkflowEvents as Events } from '@src/lib/fileSystem/workflows/events'
import type { FileWorkflowRequest } from '@src/lib/fileSystem/workflows/requests'
import {
  FileWorkflowOperations as Ops,
  FileWorkflowStates as States,
  type FileWorkflowContext,
  type FileWorkflowHost,
} from '@src/lib/fileSystem/workflows/utils'
import { reportSystemIOError } from '@src/lib/fileSystem/workflows/errorReporting'
import fsZds from '@src/lib/fs-zds'
import toast from 'react-hot-toast'

type Inputs = {
  [K in keyof typeof Events as K extends `done_${string}` ? never : K]: Extract<
    FileWorkflowRequest,
    { type: (typeof Events)[K] }
  > extends { data: infer D }
    ? D
    : undefined
}
type Snapshot = {
  context: FileWorkflowContext
  value: States
  matches: (state: string) => boolean
}
export type FileWorkflowService = {
  [K in keyof Inputs]: undefined extends Inputs[K]
    ? (data?: Inputs[K]) => Promise<unknown>
    : (data: Inputs[K]) => Promise<unknown>
} & {
  readonly run: (request: FileWorkflowRequest) => Promise<unknown>
  readonly state: ReadonlySignal<FileWorkflowContext>
  readonly status: ReadonlySignal<States>
  readonly snapshot: ReadonlySignal<Snapshot>
  readonly getSnapshot: () => Snapshot
  readonly whenIdle: () => Promise<void>
}

/** Promise completion replaces actor events; signals expose only observable state. */
export function createFileWorkflows(
  host: Omit<FileWorkflowHost, 'fileWorkflows'>
): FileWorkflowService {
  let queue: Promise<unknown> = Promise.resolve()
  const status = signal(States.idle)
  const state = signal<FileWorkflowContext>({
    host: {
      get fileOperations() {
        return host.fileOperations
      },
      get project() {
        return host.project
      },
      wasmPromise: host.wasmPromise,
      get fileWorkflows() {
        return service
      },
    },
    wasmInstancePromise: host.wasmPromise,
    defaultProjectFolderName: DEFAULT_PROJECT_NAME,
    projectDirectoryPath: '',
    folders: undefined,
    hasListedProjects: false,
    requestedProjectName: { name: '' },
    requestedFileName: { project: '', file: '' },
    canReadWriteProjectDirectory: { value: true, error: undefined },
    clearURLParams: { value: false },
    requestedZookeeperGeneration: {
      requestedPrompt: '',
      requestedProjectName: '',
      isProjectNew: true,
    },
    lastProjectDeleteRequest: { project: '' },
    lastOperation: States.idle,
  })
  const update = (patch: Partial<FileWorkflowContext>) => {
    state.value = { ...state.peek(), ...patch }
  }
  const snapshot = computed(() => ({
    context: state.value,
    value: status.value,
    matches: (expected: string) => status.value === expected,
  }))
  const refresh = async (context: FileWorkflowContext) => {
    // Cloud project roots are memory mounts, not library directories to scan.
    const current = context.host.project
    const cloud = context.projectDirectoryPath.includes('__zoo_cloud__')
    const folders =
      cloud && current
        ? [
            await (await import('@src/lib/desktop')).getProjectInfo(
              context.host.fileOperations,
              current.path,
              await host.wasmPromise
            ),
          ]
        : await actions[Ops.readFoldersFromProjectDirectory]({ input: context })
    if (state.peek().projectDirectoryPath === context.projectDirectoryPath)
      update({ folders, hasListedProjects: true })
    return folders
  }
  const perform = <T>(
    operation: States,
    run: (context: FileWorkflowContext) => Promise<T>,
    complete?: (result: T) => void
  ): Promise<T> => {
    // Capture identity at submission, before waiting for earlier operations.
    const submitted = state.peek()
    const project = host.project
    const context: FileWorkflowContext = {
      ...submitted,
      host: {
        ...host,
        project,
        get fileWorkflows() {
          return service
        },
      },
    }
    const result = queue
      .catch(() => undefined)
      .then(async () => {
        status.value = operation
        try {
          const result =
            project &&
            host.batch &&
            context.projectDirectoryPath.includes('__zoo_cloud__') &&
            operation !== States.readingFolders
              ? await host.batch(project.path, (operations) =>
                  run({
                    ...context,
                    host: { ...context.host, fileOperations: operations },
                  })
                )
              : await run(context)
          await refresh(context)
          update({ lastOperation: operation })
          complete?.(result)
          return result
        } catch (error) {
          reportSystemIOError({
            error,
            operation,
            risk: 'write',
            source: 'fileOperations',
          })
          toast.error(
            error instanceof Error ? error.message : 'File operation failed.'
          )
          return Promise.reject(error)
        } finally {
          status.value = States.idle
        }
      })
    queue = result
    return result
  }
  const projectNavigation = (name: string, path?: string, subRoute?: string) =>
    update({ requestedProjectName: { name, path, subRoute } })
  const fileNavigation = (
    project: string,
    file: string,
    subRoute?: string,
    onProjectLoaderComplete?: () => void
  ) =>
    update({
      requestedFileName: { project, file, subRoute, onProjectLoaderComplete },
    })
  const input = (context: FileWorkflowContext) => ({
    context,
    host: context.host,
    wasmInstancePromise: context.wasmInstancePromise,
  })
  const success = (result: { message?: string; toastId?: string }) => {
    if (result.message)
      toast.success(
        result.message,
        result.toastId ? { id: result.toastId } : undefined
      )
  }
  const bulkFileComplete = (result: {
    projectName: string
    fileName: string
    subRoute?: string
    onProjectLoaderComplete?: () => void
  }) =>
    fileNavigation(
      result.projectName,
      result.fileName,
      result.subRoute,
      result.onProjectLoaderComplete
    )
  const service: FileWorkflowService = {
    run: (request) => {
      switch (request.type) {
        case Events.readFoldersFromProjectDirectory:
          return service.readFoldersFromProjectDirectory()
        case Events.setFolders:
          return service.setFolders(request.data)
        case Events.setProjectDirectoryPath:
          return service.setProjectDirectoryPath(request.data)
        case Events.navigateToProject:
          return service.navigateToProject(request.data)
        case Events.navigateToFile:
          return service.navigateToFile(request.data)
        case Events.createProject:
          return service.createProject(request.data)
        case Events.duplicateProject:
          return service.duplicateProject(request.data)
        case Events.renameProject:
          return service.renameProject(request.data)
        case Events.deleteProject:
          return service.deleteProject(request.data)
        case Events.createKCLFile:
          return service.createKCLFile(request.data)
        case Events.setDefaultProjectFolderName:
          return service.setDefaultProjectFolderName(request.data)
        case Events.importFileFromURL:
          return service.importFileFromURL(request.data)
        case Events.generateZookeeper:
          return service.generateZookeeper(request.data)
        case Events.deleteKCLFile:
          return service.deleteKCLFile(request.data)
        case Events.bulkCreateKCLFiles:
          return service.bulkCreateKCLFiles(request.data)
        case Events.bulkCreateKCLFilesAndNavigateToProject:
          return service.bulkCreateKCLFilesAndNavigateToProject(request.data)
        case Events.bulkImportProjectFilesAndNavigateToFile:
          return service.bulkImportProjectFilesAndNavigateToFile(request.data)
        case Events.bulkCreateKCLFilesAndNavigateToFile:
          return service.bulkCreateKCLFilesAndNavigateToFile(request.data)
        case Events.bulkCreateAndDeleteKCLFilesAndNavigateToFile:
          return service.bulkCreateAndDeleteKCLFilesAndNavigateToFile(
            request.data
          )
        case Events.renameFolder:
          return service.renameFolder(request.data)
        case Events.renameFile:
          return service.renameFile(request.data)
        case Events.deleteFileOrFolder:
          return service.deleteFileOrFolder(request.data)
        case Events.createBlankFile:
          return service.createBlankFile(request.data)
        case Events.createBlankFolder:
          return service.createBlankFolder(request.data)
        case Events.renameFileAndNavigateToFile:
          return service.renameFileAndNavigateToFile(request.data)
        case Events.renameFolderAndNavigateToFile:
          return service.renameFolderAndNavigateToFile(request.data)
        case Events.deleteFileOrFolderAndNavigate:
          return service.deleteFileOrFolderAndNavigate(request.data)
        case Events.copyRecursive:
          return service.copyRecursive(request.data)
        case Events.moveRecursive:
          return service.moveRecursive(request.data)
        case Events.moveRecursiveAndNavigate:
          return service.moveRecursiveAndNavigate(request.data)
        default:
          return Promise.reject(new Error('Unknown file workflow.'))
      }
    },
    state,
    status,
    snapshot,
    getSnapshot: () => snapshot.peek(),
    whenIdle: async () => {
      let pending = queue
      do {
        pending = queue
        await pending.catch(() => undefined)
      } while (pending !== queue)
    },
    setFolders: async ({ folders }) => {
      update({ folders })
    },
    setProjectDirectoryPath: async ({ requestedProjectDirectoryPath }) => {
      if (
        state.peek().projectDirectoryPath === requestedProjectDirectoryPath &&
        state.peek().hasListedProjects
      )
        return
      update({
        projectDirectoryPath: requestedProjectDirectoryPath,
        folders: undefined,
        hasListedProjects: false,
      })
      await perform(States.readingFolders, async (context) => {
        if (!context.projectDirectoryPath.includes('__zoo_cloud__')) {
          const access = await actions[Ops.checkReadWrite]({
            input: { context, requestedProjectDirectoryPath },
          })
          if (
            state.peek().projectDirectoryPath === requestedProjectDirectoryPath
          )
            update({ canReadWriteProjectDirectory: access })
        }
      })
    },
    readFoldersFromProjectDirectory: () =>
      perform(States.readingFolders, async () => {}),
    setDefaultProjectFolderName: async ({
      requestedDefaultProjectFolderName,
    }) => {
      update({ defaultProjectFolderName: requestedDefaultProjectFolderName })
    },
    navigateToProject: async ({ requestedProjectName }) => {
      projectNavigation(requestedProjectName)
    },
    navigateToFile: async ({
      requestedProjectName,
      requestedFileName,
      requestedSubRoute,
      onProjectLoaderComplete,
    }) => {
      fileNavigation(
        requestedProjectName,
        requestedFileName,
        requestedSubRoute,
        onProjectLoaderComplete
      )
    },
    generateZookeeper: async (data) => {
      update({ requestedZookeeperGeneration: data })
    },
    createProject: (data) =>
      perform(
        States.creatingProject,
        (context) =>
          actions[Ops.createProject]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          projectNavigation(result.name)
        }
      ),
    duplicateProject: (data) =>
      perform(
        States.duplicatingProject,
        (context) =>
          actions[Ops.duplicateProject]({
            input: { ...input(context), ...data },
          }),
        (result) => {
          success(result)
          projectNavigation(result.name, result.projectPath)
        }
      ),
    renameProject: (data) =>
      perform(
        States.renamingProject,
        (context) =>
          actions[Ops.renameProject]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          if (result.redirect) projectNavigation(result.newName)
        }
      ),
    deleteProject: (data) =>
      perform(
        States.deletingProject,
        (context) =>
          actions[Ops.deleteProject]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          update({ lastProjectDeleteRequest: { project: result.name } })
        }
      ),
    createKCLFile: (data) =>
      perform(States.creatingKCLFile, (context) =>
        actions[Ops.createKCLFile]({ input: { ...input(context), ...data } })
      ),
    importFileFromURL: (data) =>
      perform(
        States.importFileFromURL,
        (context) =>
          actions[Ops.createKCLFile]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          bulkFileComplete(result)
        }
      ),
    deleteKCLFile: (data) =>
      perform(
        States.deletingKCLFile,
        (context) =>
          actions[Ops.deleteKCLFile]({ input: { ...input(context), ...data } }),
        success
      ),
    bulkCreateKCLFiles: (data) =>
      perform(
        States.bulkCreatingKCLFiles,
        (context) =>
          actions[Ops.bulkCreateKCLFiles]({
            input: { ...input(context), ...data },
          }),
        success
      ),
    bulkCreateKCLFilesAndNavigateToProject: (data) =>
      perform(
        States.bulkCreatingKCLFilesAndNavigateToProject,
        (context) =>
          actions[Ops.bulkCreateKCLFilesAndNavigateToProject]({
            input: { ...input(context), ...data },
          }),
        (result) => {
          success(result)
          projectNavigation(result.projectName, undefined, result.subRoute)
        }
      ),
    bulkImportProjectFilesAndNavigateToFile: (data) =>
      perform(
        States.bulkImportingProjectFilesAndNavigateToFile,
        (context) =>
          actions[Ops.bulkImportProjectFilesAndNavigateToFile]({
            input: { ...input(context), ...data },
          }),
        bulkFileComplete
      ),
    bulkCreateKCLFilesAndNavigateToFile: (data) =>
      perform(
        States.bulkCreatingKCLFilesAndNavigateToFile,
        (context) =>
          actions[Ops.bulkCreateKCLFilesAndNavigateToFile]({
            input: { ...input(context), ...data },
          }),
        bulkFileComplete
      ),
    bulkCreateAndDeleteKCLFilesAndNavigateToFile: (data) =>
      perform(
        States.bulkCreateAndDeletingKCLFilesAndNavigateToFile,
        (context) =>
          actions[Ops.bulkCreateAndDeleteKCLFilesAndNavigateToFile]({
            input: { ...input(context), ...data },
          }),
        (result) => {
          success(result)
          data.onFileSystemSuccess?.()
          if (result.shouldNavigate) bulkFileComplete(result)
          else data.onSuccess?.()
        }
      ).catch((error: unknown) => {
        data.onFileSystemError?.()
        return Promise.reject(error)
      }),
    renameFile: (data) =>
      perform(
        States.renamingFile,
        (context) =>
          actions[Ops.renameFile]({ input: { ...input(context), ...data } }),
        success
      ),
    renameFileAndNavigateToFile: (data) =>
      perform(
        States.renamingFileAndNavigateToFile,
        (context) =>
          actions[Ops.renameFile]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          fileNavigation(
            result.projectName,
            result.filePathWithExtensionRelativeToProject
          )
        }
      ),
    renameFolder: (data) =>
      perform(
        States.renamingFolder,
        (context) =>
          actions[Ops.renameFolder]({ input: { ...input(context), ...data } }),
        success
      ),
    renameFolderAndNavigateToFile: (data) =>
      perform(
        States.renamingFolderAndNavigateToFile,
        (context) =>
          actions[Ops.renameFolder]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          fileNavigation(
            result.requestedProjectName,
            result.requestedFileNameWithExtension
          )
        }
      ),
    deleteFileOrFolder: (data) =>
      perform(
        States.deletingFileOrFolder,
        (context) =>
          actions[Ops.deleteFileOrFolder]({
            input: { ...input(context), ...data },
          }),
        success
      ),
    deleteFileOrFolderAndNavigate: (data) =>
      perform(
        States.deletingFileOrFolderAndNavigate,
        (context) =>
          actions[Ops.deleteFileOrFolder]({
            input: { ...input(context), ...data },
          }),
        (result) => {
          success(result)
          projectNavigation(result.requestedProjectName)
        }
      ),
    createBlankFile: (data) =>
      perform(
        States.creatingBlankFile,
        (context) =>
          actions[Ops.createBlankFile]({
            input: { ...input(context), ...data },
          }),
        success
      ),
    createBlankFolder: (data) =>
      perform(
        States.creatingBlankFolder,
        (context) =>
          actions[Ops.createBlankFolder]({
            input: { ...input(context), ...data },
          }),
        success
      ),
    copyRecursive: (data) =>
      perform(
        States.copyingRecursive,
        (context) =>
          actions[Ops.copyRecursive]({ input: { ...input(context), ...data } }),
        success
      ),
    moveRecursive: (data) =>
      perform(
        States.movingRecursive,
        (context) =>
          actions[Ops.moveRecursive]({ input: { ...input(context), ...data } }),
        success
      ),
    moveRecursiveAndNavigate: (data) =>
      perform(
        States.movingRecursiveAndNavigate,
        (context) =>
          actions[Ops.moveRecursive]({ input: { ...input(context), ...data } }),
        (result) => {
          success(result)
          update({ lastRecursiveMoveTarget: result.target })
          if (result.requestedFileName)
            fileNavigation(
              result.requestedProjectName,
              result.requestedFileName
            )
          else projectNavigation(result.requestedProjectName)
        }
      ),
  }
  return service
}
