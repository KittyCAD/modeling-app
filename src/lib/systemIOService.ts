import { signal } from '@preact/signals-core'
import env, { getEnvironmentNameFromEnv } from '@src/env'
import { newKclFile } from '@src/lang/project'
import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
} from '@src/lib/cloudSync'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  FILE_EXT,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  canReadWriteDirectory,
  createNewProjectDirectory,
  ensureProjectDirectoryExists,
  getProjectInfo,
  mkdirOrNOOP,
  readAppSettingsFile,
  renameProjectDirectory,
  writeProjectTitleToProjectToml,
} from '@src/lib/desktop'
import {
  doesProjectNameNeedInterpolated,
  getNextFileName,
  getNextProjectIndex,
  getUniqueProjectName,
  interpolateProjectNameWithIndex,
} from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import {
  getProjectDirectoryFromKCLFilePath,
  getStringAfterLastSeparator,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { sanitizeProjectName } from '@src/lib/projectName'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  RequestedKCLFile,
  RequestedKCLFileDelete,
  RequestedProjectFile,
  SystemIOOperationSummary,
  SystemIORegistryService,
  SystemIORequest,
  SystemIORequestResult,
  SystemIOState,
} from '@src/registry/contracts/systemIO'
import type { HomeProjectEntryContribution } from '@src/registry/contracts/homeProjects'

const NO_PROJECT_DIRECTORY = ''

type OpenedProjectRef = {
  name: string
  path: string
  executingPath?: string | null
  executingPathSignal?: { value: { value: string } | null }
  projectIORefSignal?: { value: Project }
}

export type CreateSystemIOServiceOptions = {
  wasmPromise: Promise<ModuleType>
  getProjectDirectoryPath: () => string | undefined
  getDefaultProjectName: () => string | undefined
  getOpenedProject: () => OpenedProjectRef | undefined
}

type ProjectDirectoryEntry = {
  name: string
  path: string
  modified: number
}

function isPathNotFoundError(error: unknown) {
  return (
    error === 'ENOENT' ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT')
  )
}

async function pathExists(targetPath: string) {
  try {
    await fsZds.stat(targetPath)
    return true
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return false
    }
    return Promise.reject(error)
  }
}

async function moveRecursivePath({
  src,
  target,
}: {
  src: string
  target: string
}) {
  const statRes = await fsZds.stat(src)
  const isDirectory = Boolean(statRes.mode & fsZdsConstants.S_IFDIR)
  const targetAlreadyExists = await pathExists(target)

  if (!targetAlreadyExists) {
    await fsZds.mkdir(fsZds.dirname(target), { recursive: true })
    try {
      await fsZds.rename(src, target)
      return
    } catch {
      // Cross-device moves can fail; copy/remove preserves the old behavior.
    }
  }

  if (isDirectory) {
    await fsZds.mkdir(target, { recursive: true })
  } else {
    await fsZds.mkdir(fsZds.dirname(target), { recursive: true })
  }
  await fsZds.cp(src, target, { recursive: true })
  await fsZds.rm(src, { recursive: true })
}

function normalizeProjectPathForCloudMetadata(projectPath: string) {
  return projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
}

async function readProjectTomlMetadata(projectPath: string) {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  try {
    const projectToml = await fsZds.readFile(projectTomlPath, {
      encoding: 'utf-8',
    })
    const environmentName = getEnvironmentNameFromEnv(env())
    return {
      title: getProjectTitleFromProjectTomlContents(projectToml),
      cloudProjectId: getCloudProjectIdFromProjectTomlContents(
        projectToml,
        environmentName
      ),
    }
  } catch {
    return {
      title: undefined,
      cloudProjectId: undefined,
    }
  }
}

function sortProjectDirectoryEntriesByModifiedDesc(
  entries: ProjectDirectoryEntry[]
) {
  return entries.toSorted(
    (a, b) => b.modified - a.modified || a.name.localeCompare(b.name)
  )
}

async function getProjectDirectoryEntryNames(projectDirectoryPath?: string) {
  if (!projectDirectoryPath) {
    return []
  }

  try {
    return await fsZds.readdir(projectDirectoryPath)
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return []
    }
    return Promise.reject(error)
  }
}

function currentOperationsWith(
  state: SystemIOState,
  operation: SystemIOOperationSummary
) {
  const operations = [
    operation,
    ...state.operations.filter((item) => item.id !== operation.id),
  ].slice(0, 40)
  return operations
}

function buildStateFromOperations(
  state: SystemIOState,
  operations: readonly SystemIOOperationSummary[]
): SystemIOState {
  return {
    ...state,
    operations,
    runningCount: operations.filter((operation) =>
      ['pending', 'running'].includes(operation.status)
    ).length,
  }
}

function normalizeKCLFileDeletePath(filePath: string) {
  return filePath.replaceAll('\\', '/')
}

async function collectProjectFiles({
  projectContext,
}: {
  projectContext: Project
}) {
  const files: { relPath: string; absPath: string; type: 'kcl' | 'other' }[] =
    []

  const visit = (entry: FileEntry) => {
    if (entry.children) {
      entry.children.forEach(visit)
      return
    }

    const relPath = fsZds.relative(projectContext.path, entry.path)
    files.push({
      relPath,
      absPath: entry.path,
      type: entry.path.endsWith(FILE_EXT) ? 'kcl' : 'other',
    })
  }

  projectContext.children?.forEach(visit)
  return files
}

export function createSystemIOService({
  wasmPromise,
  getProjectDirectoryPath,
  getDefaultProjectName,
  getOpenedProject,
}: CreateSystemIOServiceOptions): SystemIORegistryService {
  let nextRequestId = 0
  let latestLocalProjectIndexRequestId = 0
  const resourceTails = new Map<string, Promise<unknown>>()
  const coalescedRequests = new Map<string, Promise<unknown>>()

  const stateSignal = signal<SystemIOState>({
    operations: [],
    runningCount: 0,
    localProjectsLoaded: false,
    localProjectIndexStatus: 'idle',
    canReadWriteProjectDirectory: { value: true, error: undefined },
    currentProjectTreeVersion: 0,
  })
  const localProjectEntriesSignal = signal<HomeProjectEntryContribution[]>([])

  const getKnownProjectEntries = () => localProjectEntriesSignal.value
  const getProjectDirectory = () =>
    getProjectDirectoryPath() || NO_PROJECT_DIRECTORY

  const updateOperation = (operation: SystemIOOperationSummary) => {
    stateSignal.value = buildStateFromOperations(
      stateSignal.value,
      currentOperationsWith(stateSignal.value, operation)
    )
  }

  const bumpCurrentProjectTreeVersion = () => {
    stateSignal.value = {
      ...stateSignal.value,
      currentProjectTreeVersion:
        stateSignal.value.currentProjectTreeVersion + 1,
    }
  }

  const runQueued = async <T>({
    request,
    resourceKeys,
    coalesceKey,
    run,
  }: {
    request: SystemIORequest
    resourceKeys: string[]
    coalesceKey?: string
    run: (requestId: number) => Promise<T>
  }): Promise<T> => {
    if (coalesceKey) {
      const existing = coalescedRequests.get(coalesceKey)
      if (existing) {
        return existing as Promise<T>
      }
    }

    const requestId = ++nextRequestId
    if (request.type === 'localProjects.index') {
      latestLocalProjectIndexRequestId = requestId
    }
    const summaryResourceKey = resourceKeys.join(',')
    const operation: SystemIOOperationSummary = {
      id: requestId,
      type: request.type,
      resourceKey: summaryResourceKey,
      status: 'pending',
    }
    updateOperation(operation)

    const previousTails = resourceKeys.map(
      (resourceKey) => resourceTails.get(resourceKey) ?? Promise.resolve()
    )
    const queued = Promise.all(
      previousTails.map((previousTail) => previousTail.catch(() => undefined))
    ).then(async () => {
      const startedAt = Date.now()
      updateOperation({
        ...operation,
        status: 'running',
        startedAt,
      })

      try {
        const result = await run(requestId)
        updateOperation({
          ...operation,
          status: 'succeeded',
          startedAt,
          completedAt: Date.now(),
        })
        return result
      } catch (error) {
        updateOperation({
          ...operation,
          status: 'failed',
          startedAt,
          completedAt: Date.now(),
          error,
        })
        return Promise.reject(error)
      }
    })

    for (const resourceKey of resourceKeys) {
      resourceTails.set(resourceKey, queued)
    }
    queued
      .finally(() => {
        for (const resourceKey of resourceKeys) {
          if (resourceTails.get(resourceKey) === queued) {
            resourceTails.delete(resourceKey)
          }
        }
        if (coalesceKey && coalescedRequests.get(coalesceKey) === queued) {
          coalescedRequests.delete(coalesceKey)
        }
      })
      .catch(() => undefined)
    if (coalesceKey) {
      coalescedRequests.set(coalesceKey, queued)
    }
    return queued
  }

  const refreshLocalProjects = async (
    projectDirectoryPath = getProjectDirectory()
  ) =>
    request({
      type: 'localProjects.index',
      projectDirectoryPath,
    })

  const refreshLocalProjectsAfterMutation = async () => {
    await refreshLocalProjects().catch(() => undefined)
  }

  const createExistingNameEntries = async (projectDirectoryPath: string) => {
    const names = new Set<string>()
    for (const entry of getKnownProjectEntries()) {
      if (entry.localProjectName) {
        names.add(entry.localProjectName)
      }
    }
    for (const entryName of await getProjectDirectoryEntryNames(
      projectDirectoryPath
    )) {
      names.add(entryName)
    }
    return Array.from(names, (name) => ({
      name,
      path: projectDirectoryPath
        ? fsZds.join(projectDirectoryPath, name)
        : name,
      children: [],
    }))
  }

  const getUniqueProjectNameForCreate = async (
    requestedProjectName: string,
    projectDirectoryPath: string
  ) =>
    getUniqueProjectName(
      requestedProjectName,
      await createExistingNameEntries(projectDirectoryPath)
    )

  const prepareBulkProjectWrite = async ({
    requestedProjectName,
    useReservedProjectName = false,
    useSettingsProjectDirectoryFallback = false,
  }: {
    requestedProjectName?: string
    useReservedProjectName?: boolean
    useSettingsProjectDirectoryFallback?: boolean
  }) => {
    const wasmInstance = await wasmPromise
    const configuration = await readAppSettingsFile(wasmInstance)
    if (err(configuration)) {
      return Promise.reject(configuration)
    }

    const projectDirectoryPath =
      getProjectDirectory() ||
      (useSettingsProjectDirectoryFallback
        ? await ensureProjectDirectoryExists(configuration)
        : '')

    if (!projectDirectoryPath) {
      return Promise.reject(
        new Error('Unable to determine the project directory.')
      )
    }

    const targetProjectName =
      requestedProjectName || getDefaultProjectName() || 'Project'
    let projectName =
      useReservedProjectName || requestedProjectName
        ? targetProjectName
        : getUniqueProjectName(
            targetProjectName,
            await createExistingNameEntries(projectDirectoryPath)
          )

    if (
      !useReservedProjectName &&
      doesProjectNameNeedInterpolated(projectName)
    ) {
      const nextIndex = getNextProjectIndex(
        projectName,
        await createExistingNameEntries(projectDirectoryPath)
      )
      projectName = interpolateProjectNameWithIndex(projectName, nextIndex)
    }

    return {
      configuration,
      projectDirectoryPath,
      projectName,
      projectRoot: fsZds.join(projectDirectoryPath, projectName),
      wasmInstance,
    }
  }

  const sharedBulkCreateWorkflow = async ({
    files,
    requestedProjectName,
    override,
  }: {
    files: RequestedKCLFile[]
    requestedProjectName?: string
    override?: boolean
  }) => {
    const {
      configuration,
      projectDirectoryPath,
      projectName: newProjectName,
      projectRoot,
      wasmInstance,
    } = await prepareBulkProjectWrite({
      requestedProjectName:
        requestedProjectName || files[0]?.requestedProjectName,
    })

    for (const file of files) {
      const fileName = override
        ? file.requestedFileName
        : (
            await getNextFileName({
              entryName: file.requestedFileName,
              baseDir: projectRoot,
              wasmInstance,
            })
          ).name

      await createNewProjectDirectory(
        newProjectName,
        wasmInstance,
        file.requestedCode,
        configuration,
        fileName,
        projectDirectoryPath
      )
    }

    const numberOfFiles = files.length
    const fileText = numberOfFiles > 1 ? 'files' : 'file'
    return {
      message: override
        ? `Successfully overwrote ${numberOfFiles} ${fileText}`
        : `Successfully created ${numberOfFiles} ${fileText}`,
      fileName: '',
      projectName: newProjectName,
    }
  }

  const sharedBulkWriteImportedProjectFilesWorkflow = async ({
    files,
    requestedProjectName,
    requestedFileNameWithExtension,
  }: {
    files: RequestedProjectFile[]
    requestedProjectName: string
    requestedFileNameWithExtension?: string
  }) => {
    if (files.length === 0) {
      return Promise.reject(
        new Error(
          'The shared project import did not include any files to write.'
        )
      )
    }

    const { projectName, projectRoot } = await prepareBulkProjectWrite({
      requestedProjectName,
      useReservedProjectName: true,
      useSettingsProjectDirectoryFallback: true,
    })
    const entryFile = requestedFileNameWithExtension || ''

    if (
      entryFile &&
      files.some((file) => file.requestedFileName === entryFile) === false
    ) {
      return Promise.reject(
        new Error(
          `The shared project entry file "${entryFile}" was not present in the imported files.`
        )
      )
    }

    await fsZds.mkdir(projectRoot, { recursive: true })
    for (const file of files) {
      const targetPath = fsZds.join(projectRoot, file.requestedFileName)
      await fsZds.mkdir(fsZds.dirname(targetPath), { recursive: true })
      await fsZds.writeFile(targetPath, Uint8Array.from(file.requestedData))
    }

    if (entryFile) {
      const entrypointPath = fsZds.join(projectRoot, entryFile)
      try {
        await fsZds.stat(entrypointPath)
      } catch (error) {
        return Promise.reject(
          new Error(
            `The shared project entry file "${entryFile}" was not written successfully.`,
            { cause: error }
          )
        )
      }
    }

    return {
      message: `Successfully imported project within "${projectName}"`,
      fileName: entryFile,
      projectName,
    }
  }

  const deleteRequestedProjectFiles = async ({
    requestedProjectName,
    filesToDelete,
  }: {
    requestedProjectName: string
    filesToDelete?: RequestedKCLFileDelete[]
  }) => {
    if (!filesToDelete?.length) {
      return 0
    }

    const projectDirectoryPath = getProjectDirectory()
    const openedProject = getOpenedProject()
    const project =
      openedProject?.name === requestedProjectName &&
      openedProject.projectIORefSignal?.value
        ? openedProject.projectIORefSignal.value
        : await getProjectInfo(
            fsZds.join(projectDirectoryPath, requestedProjectName),
            await wasmPromise
          )

    const filesInProject = await collectProjectFiles({
      projectContext: project,
    })
    const requestedFilesToDelete = new Set(
      filesToDelete.map((file) =>
        normalizeKCLFileDeletePath(file.requestedFileName)
      )
    )

    let totalDeleted = 0
    for (const file of filesInProject) {
      if (
        !requestedFilesToDelete.has(normalizeKCLFileDeletePath(file.relPath))
      ) {
        continue
      }
      await fsZds.rm(file.absPath)
      totalDeleted += 1
    }
    return totalDeleted
  }

  const request = async <TRequest extends SystemIORequest>(
    requestInput: TRequest
  ): Promise<SystemIORequestResult<TRequest>> => {
    const projectDirectoryPath = getProjectDirectory()
    const resourceKeys = resourceKeysForRequest(
      requestInput,
      projectDirectoryPath
    )
    const coalesceKey =
      requestInput.type === 'localProjects.index'
        ? `localProjects.index:${requestInput.projectDirectoryPath || projectDirectoryPath}`
        : undefined

    return runQueued({
      request: requestInput,
      resourceKeys,
      coalesceKey,
      run: async (requestId) => {
        switch (requestInput.type) {
          case 'localProjects.index': {
            const indexProjectDirectoryPath =
              requestInput.projectDirectoryPath || projectDirectoryPath
            stateSignal.value = {
              ...stateSignal.value,
              localProjectIndexStatus: 'running',
            }
            if (!indexProjectDirectoryPath) {
              localProjectEntriesSignal.value = []
              stateSignal.value = {
                ...stateSignal.value,
                localProjectsLoaded: true,
                localProjectIndexStatus: 'succeeded',
                canReadWriteProjectDirectory: {
                  value: true,
                  error: undefined,
                },
              }
              return [] as unknown as SystemIORequestResult<TRequest>
            }

            let entries: HomeProjectEntryContribution[]
            try {
              entries = await indexLocalProjectEntries(
                indexProjectDirectoryPath
              )
            } catch (error) {
              if (latestLocalProjectIndexRequestId === requestId) {
                stateSignal.value = {
                  ...stateSignal.value,
                  localProjectIndexStatus: 'failed',
                }
              }
              return Promise.reject(error)
            }

            if (latestLocalProjectIndexRequestId === requestId) {
              localProjectEntriesSignal.value = entries
              stateSignal.value = {
                ...stateSignal.value,
                localProjectsLoaded: true,
                localProjectIndexStatus: 'succeeded',
              }
            }
            return entries as SystemIORequestResult<TRequest>
          }

          case 'project.loadTree': {
            const project = await getProjectInfo(
              requestInput.projectPath,
              await wasmPromise
            )
            return project as SystemIORequestResult<TRequest>
          }

          case 'project.create': {
            const projectDirectoryPath = getProjectDirectory()
            const uniqueName = await getUniqueProjectNameForCreate(
              requestInput.requestedProjectName,
              projectDirectoryPath
            )
            await createNewProjectDirectory(
              uniqueName,
              await wasmPromise,
              undefined,
              undefined,
              undefined,
              projectDirectoryPath
            )
            await refreshLocalProjectsAfterMutation()
            return {
              message: `Successfully created "${uniqueName}"`,
              name: uniqueName,
              projectPath: fsZds.join(projectDirectoryPath, uniqueName),
            } as SystemIORequestResult<TRequest>
          }

          case 'project.rename': {
            const result = await renameProject(requestInput)
            await refreshLocalProjectsAfterMutation()
            bumpCurrentProjectTreeVersion()
            return result as SystemIORequestResult<TRequest>
          }

          case 'project.delete': {
            await fsZds.rm(
              fsZds.join(projectDirectoryPath, requestInput.projectName),
              { recursive: true }
            )
            await refreshLocalProjectsAfterMutation()
            return {
              message: `Successfully deleted "${requestInput.projectName}"`,
              name: requestInput.projectName,
            } as SystemIORequestResult<TRequest>
          }

          case 'file.createKCL': {
            const requestedProjectName = requestInput.requestedProjectName
            let newProjectName =
              requestedProjectName || getDefaultProjectName() || 'Project'
            const existingEntries =
              await createExistingNameEntries(projectDirectoryPath)
            if (!requestedProjectName) {
              newProjectName = getUniqueProjectName(
                newProjectName,
                existingEntries
              )
            }
            if (doesProjectNameNeedInterpolated(newProjectName)) {
              const nextIndex = getNextProjectIndex(
                newProjectName,
                existingEntries
              )
              newProjectName = interpolateProjectNameWithIndex(
                newProjectName,
                nextIndex
              )
            }

            const wasmInstance = await wasmPromise
            const baseDir = fsZds.join(projectDirectoryPath, newProjectName)
            const { name: newFileName } = await getNextFileName({
              entryName: requestInput.requestedSubDirectory
                ? fsZds.join(
                    requestInput.requestedSubDirectory,
                    requestInput.requestedFileNameWithExtension
                  )
                : requestInput.requestedFileNameWithExtension,
              baseDir,
              wasmInstance,
            })
            const configuration = await readAppSettingsFile(wasmInstance)
            await createNewProjectDirectory(
              newProjectName,
              wasmInstance,
              requestInput.requestedCode,
              configuration,
              newFileName,
              projectDirectoryPath
            )
            await refreshLocalProjectsAfterMutation()
            bumpCurrentProjectTreeVersion()
            return {
              message: 'Successfully created file.',
              fileName: newFileName,
              projectName: newProjectName,
            } as SystemIORequestResult<TRequest>
          }

          case 'files.bulkCreateKCL': {
            const message = await sharedBulkCreateWorkflow({
              files: requestInput.files,
              requestedProjectName: requestInput.requestedProjectName,
              override: requestInput.override,
            })
            await refreshLocalProjectsAfterMutation()
            bumpCurrentProjectTreeVersion()
            return {
              ...message,
              fileName: requestInput.requestedFileNameWithExtension || '',
              projectName:
                requestInput.requestedProjectName || message.projectName,
            } as SystemIORequestResult<TRequest>
          }

          case 'project.importFiles': {
            const result =
              await sharedBulkWriteImportedProjectFilesWorkflow(requestInput)
            await refreshLocalProjectsAfterMutation()
            bumpCurrentProjectTreeVersion()
            return result as SystemIORequestResult<TRequest>
          }

          case 'files.bulkCreateAndDeleteKCL': {
            const message = await sharedBulkCreateWorkflow({
              files: requestInput.files,
              requestedProjectName: requestInput.requestedProjectName,
              override: requestInput.override,
            })
            const totalDeleted = await deleteRequestedProjectFiles(requestInput)
            await refreshLocalProjectsAfterMutation()
            bumpCurrentProjectTreeVersion()

            const openedProject = getOpenedProject()
            const requestedRelativePath = normalizeKCLFileDeletePath(
              requestInput.requestedFileNameWithExtension
            )
            const deletesRequestedFile = (
              requestInput.filesToDelete ?? []
            ).some(
              (file) =>
                normalizeKCLFileDeletePath(file.requestedFileName) ===
                requestedRelativePath
            )
            const requestedAbsolutePath = openedProject
              ? fsZds.join(
                  openedProject.path,
                  requestInput.requestedFileNameWithExtension
                )
              : ''
            const shouldNavigate =
              !openedProject ||
              openedProject.name !== requestInput.requestedProjectName ||
              openedProject.executingPath !== requestedAbsolutePath ||
              deletesRequestedFile

            return {
              ...message,
              message: `${message.message}, ${totalDeleted} deleted`,
              projectName: requestInput.requestedProjectName,
              fileName: requestInput.requestedFileNameWithExtension,
              shouldNavigate,
            } as SystemIORequestResult<TRequest>
          }

          case 'file.deleteKCL': {
            const path = fsZds.join(
              projectDirectoryPath,
              requestInput.requestedProjectName,
              requestInput.requestedFileName
            )
            await fsZds.rm(path)
            bumpCurrentProjectTreeVersion()
            return {
              message: 'File deleted successfully',
              projectName: requestInput.requestedProjectName,
              fileName: requestInput.requestedFileName,
            } as SystemIORequestResult<TRequest>
          }

          case 'folder.rename': {
            const oldPath = fsZds.join(
              requestInput.absolutePathToParentDirectory,
              requestInput.folderName
            )
            const newPath = fsZds.join(
              requestInput.absolutePathToParentDirectory,
              requestInput.requestedFolderName
            )
            if (oldPath === newPath) {
              return {
                message: 'Old folder is the same as new.',
              } as SystemIORequestResult<TRequest>
            }
            const entries = await fsZds.readdir(fsZds.dirname(newPath))
            if (entries.includes(requestInput.requestedFolderName)) {
              return Promise.reject(new Error('Folder name already exists.'))
            }
            await fsZds.rename(oldPath, newPath)
            const openedProject = getOpenedProject()
            if (
              openedProject?.executingPathSignal?.value?.value.includes(oldPath)
            ) {
              openedProject.executingPathSignal.value.value =
                openedProject.executingPathSignal.value.value.replace(
                  oldPath,
                  newPath
                )
            }
            bumpCurrentProjectTreeVersion()
            return {
              message: `Successfully renamed folder "${requestInput.folderName}" to "${requestInput.requestedFolderName}"`,
            } as SystemIORequestResult<TRequest>
          }

          case 'file.rename': {
            const oldPath = fsZds.join(
              requestInput.absolutePathToParentDirectory,
              requestInput.fileNameWithExtension
            )
            const newPath = fsZds.join(
              requestInput.absolutePathToParentDirectory,
              requestInput.requestedFileNameWithExtension
            )
            if (oldPath === newPath) {
              return {
                message: 'Old file is the same as new.',
                projectName: getProjectDirectoryFromKCLFilePath(
                  newPath,
                  projectDirectoryPath
                ),
                fileName: parentPathRelativeToProject(
                  newPath,
                  projectDirectoryPath
                ),
              } as SystemIORequestResult<TRequest>
            }
            const entries = await fsZds.readdir(fsZds.dirname(newPath))
            if (entries.includes(requestInput.requestedFileNameWithExtension)) {
              return Promise.reject(new Error('Filename already exists.'))
            }
            await fsZds.rename(oldPath, newPath)
            const openedProject = getOpenedProject()
            if (
              openedProject?.executingPathSignal?.value &&
              openedProject.executingPathSignal.value.value === oldPath
            ) {
              openedProject.executingPathSignal.value.value = newPath
            }
            bumpCurrentProjectTreeVersion()
            return {
              message: `Successfully renamed file "${requestInput.fileNameWithExtension}" to "${requestInput.requestedFileNameWithExtension}"`,
              projectName: getProjectDirectoryFromKCLFilePath(
                newPath,
                projectDirectoryPath
              ),
              fileName: parentPathRelativeToProject(
                newPath,
                projectDirectoryPath
              ),
            } as SystemIORequestResult<TRequest>
          }

          case 'path.delete': {
            await fsZds.rm(requestInput.requestedPath, { recursive: true })
            bumpCurrentProjectTreeVersion()
            return {
              message: 'File deleted successfully',
              requestedPath: requestInput.requestedPath,
              projectName: requestInput.requestedProjectName || '',
            } as SystemIORequestResult<TRequest>
          }

          case 'file.createBlank': {
            const fileNameWithExtension = getStringAfterLastSeparator(
              requestInput.requestedAbsolutePath
            )
            if (await pathExists(requestInput.requestedAbsolutePath)) {
              return Promise.reject(
                new Error(`File ${fileNameWithExtension} already exists`)
              )
            }
            let fileContents = new Uint8Array()
            if (
              fsZds.extname(requestInput.requestedAbsolutePath) === FILE_EXT
            ) {
              const wasmInstance = await wasmPromise
              const configuration = await readAppSettingsFile(wasmInstance)
              if (err(configuration)) {
                return Promise.reject(configuration)
              }
              const codeToWrite = newKclFile(
                undefined,
                configuration?.settings?.modeling?.base_unit ??
                  DEFAULT_DEFAULT_LENGTH_UNIT,
                wasmInstance
              )
              if (err(codeToWrite)) {
                return Promise.reject(codeToWrite)
              }
              fileContents = new TextEncoder().encode(codeToWrite)
            }
            await fsZds.writeFile(
              requestInput.requestedAbsolutePath,
              fileContents
            )
            bumpCurrentProjectTreeVersion()
            return {
              message: `File ${fileNameWithExtension} written successfully`,
              requestedAbsolutePath: requestInput.requestedAbsolutePath,
            } as SystemIORequestResult<TRequest>
          }

          case 'folder.createBlank': {
            const folderName = getStringAfterLastSeparator(
              requestInput.requestedAbsolutePath
            )
            if (await pathExists(requestInput.requestedAbsolutePath)) {
              return Promise.reject(
                new Error(`Folder ${folderName} already exists`)
              )
            }
            await fsZds.mkdir(requestInput.requestedAbsolutePath, {
              recursive: true,
            })
            bumpCurrentProjectTreeVersion()
            return {
              message: `Folder ${folderName} written successfully`,
              requestedAbsolutePath: requestInput.requestedAbsolutePath,
            } as SystemIORequestResult<TRequest>
          }

          case 'path.copyRecursive': {
            await fsZds.cp(requestInput.src, requestInput.target, {
              recursive: true,
              force: false,
            })
            bumpCurrentProjectTreeVersion()
            return {
              message: 'Copied successfully',
              requestedAbsolutePath: '',
            } as SystemIORequestResult<TRequest>
          }

          case 'path.moveRecursive': {
            await moveRecursivePath({
              src: requestInput.src,
              target: requestInput.target,
            })
            bumpCurrentProjectTreeVersion()
            return {
              message: requestInput.successMessage || 'Moved successfully',
              requestedAbsolutePath: '',
              projectName: requestInput.requestedProjectName || '',
              target: requestInput.target,
            } as SystemIORequestResult<TRequest>
          }

          case 'directory.checkReadWrite': {
            const targetProjectDirectoryPath =
              requestInput.projectDirectoryPath || projectDirectoryPath
            const result = targetProjectDirectoryPath
              ? await canReadWriteDirectory(targetProjectDirectoryPath)
              : { value: true, error: undefined }
            stateSignal.value = {
              ...stateSignal.value,
              canReadWriteProjectDirectory: result,
            }
            return result as SystemIORequestResult<TRequest>
          }
        }
      },
    })
  }

  async function indexLocalProjectEntries(projectDirectoryPath: string) {
    await mkdirOrNOOP(projectDirectoryPath)
    const cloudProjectMetadataByPath = cloudSyncStatus.value.enabled
      ? await getCloudSyncProjectMetadataIndex().catch(() => new Map())
      : new Map()
    const projectDirectoryReadWrite =
      await canReadWriteDirectory(projectDirectoryPath)
    stateSignal.value = {
      ...stateSignal.value,
      canReadWriteProjectDirectory: projectDirectoryReadWrite,
    }

    const entries: ProjectDirectoryEntry[] = []
    for (const entry of await fsZds.readdir(projectDirectoryPath)) {
      if (entry.startsWith('.')) {
        continue
      }

      const projectPath = fsZds.join(projectDirectoryPath, entry)
      let stat: Awaited<ReturnType<typeof fsZds.stat>>
      try {
        stat = await fsZds.stat(projectPath)
      } catch {
        continue
      }
      if (!(stat.mode & fsZdsConstants.S_IFDIR)) {
        continue
      }

      entries.push({
        name: entry,
        path: projectPath,
        modified:
          getCloudSyncProjectModifiedTime(
            cloudProjectMetadataByPath.get(
              normalizeProjectPathForCloudMetadata(projectPath)
            ),
            stat.mtimeMs
          ) ?? stat.mtimeMs,
      })
    }

    const contributions: HomeProjectEntryContribution[] = []
    for (const entry of sortProjectDirectoryEntriesByModifiedDesc(entries)) {
      const cloudMetadata = cloudProjectMetadataByPath.get(
        normalizeProjectPathForCloudMetadata(entry.path)
      )
      const projectTomlMetadata = await readProjectTomlMetadata(entry.path)
      const readWriteAccess = (await canReadWriteDirectory(entry.path)).value
      const remoteProjectId =
        projectTomlMetadata.cloudProjectId ?? cloudMetadata?.remoteProjectId
      const conflict = cloudMetadata?.conflict

      contributions.push({
        source: 'local',
        status: conflict ? 'conflicted' : remoteProjectId ? 'synced' : 'local',
        name: entry.name,
        title: projectTomlMetadata.title,
        localProjectPath: entry.path,
        localProjectName: entry.name,
        remoteProjectId,
        modified:
          getCloudSyncProjectModifiedTime(cloudMetadata, entry.modified) ??
          entry.modified,
        readWriteAccess,
        thumbnail: {
          type: 'local',
          path: fsZds.join(entry.path, PROJECT_IMAGE_NAME),
        },
        conflict,
      })
    }
    return contributions
  }

  async function renameProject({
    projectName,
    requestedProjectName,
  }: Extract<SystemIORequest, { type: 'project.rename' }>) {
    const projectDirectoryPath = getProjectDirectory()
    const existingProject = getKnownProjectEntries().find(
      (project) => project.localProjectName === projectName
    )
    const existingDisplayName =
      existingProject?.title || existingProject?.name || projectName
    const currentProjectPath =
      existingProject?.localProjectPath ||
      fsZds.join(projectDirectoryPath, projectName)

    if (existingProject?.remoteProjectId) {
      await writeProjectTitleToProjectToml(
        currentProjectPath,
        requestedProjectName
      )
      const baseName = sanitizeProjectName(requestedProjectName, projectName)
      const existingNames = new Set(
        getKnownProjectEntries()
          .filter((folder) => folder.localProjectName !== projectName)
          .map((folder) => folder.localProjectName?.toLowerCase())
          .filter((name): name is string => Boolean(name))
      )
      let newProjectName = baseName
      let index = 2
      while (existingNames.has(newProjectName.toLowerCase())) {
        newProjectName = `${baseName}-${index}`
        index += 1
      }
      let renamedProjectName = projectName
      if (newProjectName !== projectName) {
        await renameProjectDirectory(currentProjectPath, newProjectName)
          .then(() => {
            renamedProjectName = newProjectName
          })
          .catch(() => undefined)
      }
      return {
        message: `Successfully renamed "${existingDisplayName}" to "${requestedProjectName}"`,
        oldName: projectName,
        newName: renamedProjectName,
      }
    }

    let newProjectName = requestedProjectName
    const existingEntries =
      await createExistingNameEntries(projectDirectoryPath)
    if (doesProjectNameNeedInterpolated(requestedProjectName)) {
      const nextIndex = getNextProjectIndex(
        requestedProjectName,
        existingEntries
      )
      newProjectName = interpolateProjectNameWithIndex(
        requestedProjectName,
        nextIndex
      )
    }

    if (
      existingEntries.some(
        (project) =>
          project.name !== projectName &&
          project.name.toLowerCase() === newProjectName.toLowerCase()
      )
    ) {
      return Promise.reject(
        new Error(`Project with name "${newProjectName}" already exists`)
      )
    }

    await renameProjectDirectory(currentProjectPath, newProjectName)
    return {
      message: `Successfully renamed "${existingDisplayName}" to "${newProjectName}"`,
      oldName: projectName,
      newName: newProjectName,
    }
  }

  const service: SystemIORegistryService = {
    request,
    stateSignal,
    localProjectEntriesSignal,
    refreshLocalProjects,
    markCurrentProjectTreeDirty: bumpCurrentProjectTreeVersion,
  }

  return service
}

function normalizePathKey(path: string) {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function projectResourceKeyForAbsolutePath(
  targetPath: string,
  projectDirectoryPath: string
) {
  const normalizedTargetPath = normalizePathKey(targetPath)
  const normalizedProjectDirectoryPath = normalizePathKey(projectDirectoryPath)

  if (!normalizedProjectDirectoryPath) {
    return `path:${normalizedTargetPath}`
  }

  const projectDirectoryPrefix = `${normalizedProjectDirectoryPath}/`
  if (!normalizedTargetPath.startsWith(projectDirectoryPrefix)) {
    return `path:${normalizedTargetPath}`
  }

  const projectPathFromDirectory = normalizedTargetPath.slice(
    projectDirectoryPrefix.length
  )
  const projectPathSeparatorIndex = projectPathFromDirectory.indexOf('/')
  const projectName =
    projectPathSeparatorIndex === -1
      ? projectPathFromDirectory
      : projectPathFromDirectory.slice(0, projectPathSeparatorIndex)

  return projectName
    ? `project:${normalizedProjectDirectoryPath}:${projectName}`
    : `path:${normalizedTargetPath}`
}

function uniqueResourceKeys(resourceKeys: string[]) {
  return Array.from(new Set(resourceKeys))
}

function resourceKeysForRequest(
  request: SystemIORequest,
  projectDirectoryPath: string
) {
  const projectDirectoryKey = normalizePathKey(projectDirectoryPath)
  const projectResourceKey = (projectName = '') =>
    `project:${projectDirectoryKey}:${projectName}`

  switch (request.type) {
    case 'localProjects.index':
      return [
        `local-projects:${request.projectDirectoryPath || projectDirectoryPath}`,
      ]
    case 'project.loadTree':
      return [
        projectResourceKeyForAbsolutePath(
          request.projectPath,
          projectDirectoryPath
        ),
      ]
    case 'project.create':
    case 'project.delete':
    case 'project.rename':
      return [
        projectResourceKey(
          'projectName' in request
            ? request.projectName
            : request.type === 'project.create'
              ? request.requestedProjectName
              : ''
        ),
      ]
    case 'file.createKCL':
      return [projectResourceKey(request.requestedProjectName || '')]
    case 'files.bulkCreateKCL':
      return [
        projectResourceKey(
          request.requestedProjectName ||
            request.files[0]?.requestedProjectName ||
            ''
        ),
      ]
    case 'project.importFiles':
    case 'files.bulkCreateAndDeleteKCL':
    case 'file.deleteKCL':
      return [projectResourceKey(request.requestedProjectName)]
    case 'folder.rename':
    case 'file.rename':
      return [
        projectResourceKeyForAbsolutePath(
          request.absolutePathToParentDirectory,
          projectDirectoryPath
        ),
      ]
    case 'path.delete':
      return [
        projectResourceKeyForAbsolutePath(
          request.requestedPath,
          projectDirectoryPath
        ),
      ]
    case 'file.createBlank':
    case 'folder.createBlank':
      return [
        projectResourceKeyForAbsolutePath(
          request.requestedAbsolutePath,
          projectDirectoryPath
        ),
      ]
    case 'path.copyRecursive':
    case 'path.moveRecursive':
      return uniqueResourceKeys([
        projectResourceKeyForAbsolutePath(request.src, projectDirectoryPath),
        projectResourceKeyForAbsolutePath(request.target, projectDirectoryPath),
      ])
    case 'directory.checkReadWrite':
      return [
        `readwrite:${request.projectDirectoryPath || projectDirectoryPath}`,
      ]
  }
}
