import { newKclFile } from '@src/lang/project'
import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
} from '@src/lib/cloudSync'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  FILE_EXT,
  ZOOKEEPER_FILE_WRITE_TOAST_ID,
} from '@src/lib/constants'
import {
  canReadWriteDirectory,
  createNewProjectDirectory,
  ensureProjectDirectoryExists,
  getProjectInfo,
  mkdirOrNOOP,
  readAppSettingsFile,
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
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { err, isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type {
  RequestedKCLFile,
  RequestedKCLFileDelete,
  RequestedProjectFile,
  SystemIOContext,
} from '@src/machines/systemIO/utils'
import {
  collectProjectFiles,
  NO_PROJECT_DIRECTORY,
  normalizeKCLFileDeletePath,
  SystemIOMachineActors,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import { fromPromise } from 'xstate'

async function getProjectDirectoryEntryNames(projectDirectoryPath?: string) {
  if (!projectDirectoryPath) {
    return []
  }

  try {
    return await fsZds.readdir(projectDirectoryPath)
  } catch (error) {
    if (error === 'ENOENT') {
      return []
    }
    return Promise.reject(error)
  }
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
      // Fall back to copy/remove for cases like cross-device moves.
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

async function getUniqueProjectNameForCreate({
  context,
  requestedProjectName,
  projectDirectoryPath,
}: {
  context: SystemIOContext
  requestedProjectName: string
  projectDirectoryPath?: string
}) {
  const knownProjectNames = new Set<string>()
  for (const folder of context.folders ?? []) {
    knownProjectNames.add(folder.name)
  }
  for (const entryName of await getProjectDirectoryEntryNames(
    projectDirectoryPath
  )) {
    knownProjectNames.add(entryName)
  }

  const existingEntries: FileEntry[] = Array.from(
    knownProjectNames,
    (name) => ({
      name,
      path: projectDirectoryPath
        ? fsZds.join(projectDirectoryPath, name)
        : name,
      children: [],
    })
  )
  return getUniqueProjectName(requestedProjectName, existingEntries)
}

export function shouldSendProjectFolderReadProgress(
  folders: SystemIOContext['folders']
) {
  return !folders?.length
}

type ProjectDirectoryEntry = {
  name: string
  path: string
  modified: number
}

export function sortProjectDirectoryEntriesByModifiedDesc(
  entries: ProjectDirectoryEntry[]
) {
  return entries.toSorted(
    (a, b) => b.modified - a.modified || a.name.localeCompare(b.name)
  )
}

function normalizeProjectPathForCloudMetadata(projectPath: string) {
  return projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
}

const prepareBulkProjectWrite = async ({
  context,
  requestedProjectName,
  wasmInstance,
  useReservedProjectName = false,
  useSettingsProjectDirectoryFallback = false,
}: {
  context: SystemIOContext
  requestedProjectName?: string
  wasmInstance: ModuleType
  useReservedProjectName?: boolean
  useSettingsProjectDirectoryFallback?: boolean
}) => {
  const configuration = await readAppSettingsFile(wasmInstance)
  const projectDirectoryPath =
    context.projectDirectoryPath ||
    (useSettingsProjectDirectoryFallback
      ? await ensureProjectDirectoryExists(configuration)
      : '')

  if (!projectDirectoryPath) {
    return Promise.reject(
      new Error('Unable to determine the project directory.')
    )
  }

  const targetProjectName =
    requestedProjectName || context.defaultProjectFolderName
  let projectName =
    useReservedProjectName || requestedProjectName
      ? targetProjectName
      : getUniqueProjectName(targetProjectName, context.folders ?? [])

  if (!useReservedProjectName && doesProjectNameNeedInterpolated(projectName)) {
    const nextIndex = getNextProjectIndex(projectName, context.folders ?? [])
    projectName = interpolateProjectNameWithIndex(projectName, nextIndex)
  }

  const projectRoot = fsZds.join(projectDirectoryPath, projectName)

  return {
    configuration,
    projectDirectoryPath,
    projectName,
    projectRoot,
  }
}

const sharedBulkCreateWorkflow = async ({
  input,
}: {
  input: {
    context: SystemIOContext
    files: RequestedKCLFile[]
    wasmInstance: ModuleType
    override?: boolean
  }
}) => {
  const {
    configuration,
    projectDirectoryPath,
    projectName: newProjectName,
    projectRoot,
  } = await prepareBulkProjectWrite({
    context: input.context,
    requestedProjectName: input.files[0]?.requestedProjectName,
    wasmInstance: input.wasmInstance,
  })

  for (let fileIndex = 0; fileIndex < input.files.length; fileIndex++) {
    const file = input.files[fileIndex]
    const requestedFileName = file.requestedFileName
    const requestedCode = file.requestedCode

    // If override is true, use the requested filename directly
    const fileName = input.override
      ? requestedFileName
      : (
          await getNextFileName({
            entryName: requestedFileName,
            baseDir: projectRoot,
            wasmInstance: input.wasmInstance,
          })
        ).name

    // Create the project around the file if newProject
    await createNewProjectDirectory(
      newProjectName,
      input.wasmInstance,
      requestedCode,
      configuration,
      fileName,
      projectDirectoryPath
    )
  }
  const numberOfFiles = input.files.length
  const fileText = numberOfFiles > 1 ? 'files' : 'file'
  const message = input.override
    ? `Successfully overwrote ${numberOfFiles} ${fileText}`
    : `Successfully created ${numberOfFiles} ${fileText}`
  return {
    message,
    fileName: '',
    projectName: newProjectName,
    subRoute: 'subRoute' in input ? input.subRoute : '',
  }
}

const sharedBulkWriteImportedProjectFilesWorkflow = async ({
  input,
}: {
  input: {
    context: SystemIOContext
    files: RequestedProjectFile[]
    requestedProjectName: string
    requestedFileNameWithExtension?: string
  }
}) => {
  try {
    if (input.files.length === 0) {
      return Promise.reject(
        new Error(
          'The shared project import did not include any files to write.'
        )
      )
    }

    const wasmInstance = await input.context.wasmInstancePromise
    const { projectName, projectRoot } = await prepareBulkProjectWrite({
      context: input.context,
      requestedProjectName: input.requestedProjectName,
      wasmInstance,
      useReservedProjectName: true,
      useSettingsProjectDirectoryFallback: true,
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

    if (requestedFileNameWithExtension) {
      const entrypointPath = fsZds.join(
        projectRoot,
        requestedFileNameWithExtension
      )
      try {
        await fsZds.stat(entrypointPath)
      } catch (error) {
        return Promise.reject(
          new Error(
            `The shared project entry file "${requestedFileNameWithExtension}" was not written successfully.`,
            { cause: error }
          )
        )
      }
    }

    return {
      message: `Successfully imported project within "${projectName}"`,
      fileName: requestedFileNameWithExtension,
      projectName,
      subRoute: '',
    }
  } catch (error) {
    return Promise.reject(
      isErr(error)
        ? error
        : new Error('Failed while writing the imported shared project.')
    )
  }
}

const sharedBulkDeleteWorkflow = async ({
  input,
}: {
  input: {
    requestedProjectName: string
    context: SystemIOContext
    files: RequestedKCLFile[]
    filesToDelete?: RequestedKCLFileDelete[]
    wasmInstance: ModuleType
  }
}) => {
  if (!input.context.folders) {
    console.warn('no folders')
    return
  }

  const project = input.context.folders.find(
    (f) => f.name === input.requestedProjectName
  )

  if (!project) {
    return Promise.reject(new Error("Couldn't find project"))
  }

  const filesInProject = await collectProjectFiles({
    selectedFileContents: '',
    fileNames: [],
    projectContext: project,
  })

  const requestedFilesToDelete = new Set(
    (input.filesToDelete ?? []).map((file) =>
      normalizeKCLFileDeletePath(file.requestedFileName)
    )
  )

  // requestedFileName is the relative path too.
  const filesToDelete = filesInProject.filter(
    (file) =>
      requestedFilesToDelete.has(normalizeKCLFileDeletePath(file.relPath)) ===
      true
  )

  let totalDeleted = 0
  for (const file of filesToDelete) {
    // 'kcl' files carry an absolute path; 'other' files (e.g. Markdown) only
    // carry a project-relative path, so reconstruct the absolute path from the
    // project root. Both kinds are deletable when explicitly requested.
    const absPath =
      file.type === 'kcl'
        ? file.absPath
        : fsZds.join(project.path, file.relPath)
    await fsZds.rm(absPath)
    totalDeleted += 1
  }

  // How many files we deleted successfully
  return totalDeleted
}

export const systemIOMachineImpl = systemIOMachine.provide({
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(
      async ({ input: context, signal }) => {
        const PROJECT_FOLDER_PROGRESS_CHUNK_SIZE = 12
        const projects: Project[] = []
        const projectDirectoryPath = context.projectDirectoryPath
        const canSendProgress = shouldSendProjectFolderReadProgress(
          context.folders
        )
        if (projectDirectoryPath === NO_PROJECT_DIRECTORY) {
          return []
        }
        const sendFoldersProgress = (folders: Project[]) => {
          if (signal.aborted) {
            return
          }
          context.app.systemIOActor.send({
            type: SystemIOMachineEvents.setFolders,
            data: { folders },
          })
        }

        await mkdirOrNOOP(projectDirectoryPath)
        const cloudProjectMetadataByPath = cloudSyncStatus.value.enabled
          ? await getCloudSyncProjectMetadataIndex().catch(() => new Map())
          : new Map()
        // Gotcha: readdir will list all folders at this project directory even if you do not have readwrite access on the directory path
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
        const { value: canReadWriteProjectDirectory } =
          await canReadWriteDirectory(projectDirectoryPath)

        for (const entry of sortProjectDirectoryEntriesByModifiedDesc(
          entries
        )) {
          if (signal.aborted) {
            return projects
          }
          const project: Project = await getProjectInfo(
            entry.path,
            await context.wasmInstancePromise
          )
          const cloudMetadata = cloudProjectMetadataByPath.get(
            normalizeProjectPathForCloudMetadata(entry.path)
          )
          project.cloudProjectId ??= cloudMetadata?.remoteProjectId
          project.cloudConflict = cloudMetadata?.conflict
          if (project.metadata) {
            project.metadata.modified = getCloudSyncProjectModifiedTime(
              cloudMetadata,
              project.metadata.modified
            )
          }
          if (
            project.kcl_file_count === 0 &&
            project.readWriteAccess &&
            canReadWriteProjectDirectory
          ) {
            continue
          }
          projects.push(project)
          if (
            canSendProgress &&
            projects.length % PROJECT_FOLDER_PROGRESS_CHUNK_SIZE === 0
          ) {
            sendFoldersProgress([...projects])
          }
        }
        sendFoldersProgress(projects)
        return projects
      }
    ),
    [SystemIOMachineActors.createProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedProjectTitle?: string
        }
      }) => {
        const requestedProjectName = input.requestedProjectName
        const requestedProjectTitle =
          input.requestedProjectTitle ?? requestedProjectName
        const projectDirectoryPath =
          input.context.projectDirectoryPath &&
          input.context.projectDirectoryPath !== NO_PROJECT_DIRECTORY
            ? input.context.projectDirectoryPath
            : undefined
        const uniqueName = await getUniqueProjectNameForCreate({
          context: input.context,
          requestedProjectName,
          projectDirectoryPath,
        })
        await createNewProjectDirectory(
          uniqueName,
          await input.context.wasmInstancePromise,
          undefined,
          undefined,
          undefined,
          projectDirectoryPath,
          requestedProjectTitle
        )
        return {
          message: `Successfully created "${requestedProjectTitle}"`,
          name: uniqueName,
        }
      }
    ),
    [SystemIOMachineActors.renameProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          projectName: string
          redirect: boolean
        }
      }) => {
        const folders = input.context.folders
        if (!folders) {
          return Promise.reject(new Error('no folders'))
        }

        const requestedProjectTitle = input.requestedProjectName
        const projectDirectoryName = input.projectName
        const project = folders.find((p) => p.name === projectDirectoryName)
        if (!project) {
          return Promise.reject(
            new Error(`Project "${projectDirectoryName}" does not exist`)
          )
        }

        const existingDisplayName = getProjectDisplayName(project)
        const projectPath = fsZds.join(
          input.context.projectDirectoryPath,
          projectDirectoryName
        )

        if (
          folders.some(
            (folder) =>
              folder.name !== projectDirectoryName &&
              getProjectDisplayName(folder) === requestedProjectTitle
          )
        ) {
          return Promise.reject(
            new Error(
              `Project with title "${requestedProjectTitle}" already exists`
            )
          )
        }

        await writeProjectTitleToProjectToml(projectPath, requestedProjectTitle)

        return {
          message: `Successfully renamed "${existingDisplayName}" to "${requestedProjectTitle}"`,
          oldName: projectDirectoryName,
          newName: projectDirectoryName,
          redirect: input.redirect,
        }
      }
    ),
    [SystemIOMachineActors.deleteProject]: fromPromise(
      async ({
        input,
      }: {
        input: { context: SystemIOContext; requestedProjectName: string }
      }) => {
        if (!input.requestedProjectName) {
          return Promise.reject(
            new Error('Cannot delete a project without a project name')
          )
        }

        await fsZds.rm(
          fsZds.join(
            input.context.projectDirectoryPath,
            input.requestedProjectName
          ),
          {
            recursive: true,
          }
        )

        return {
          message: `Successfully deleted "${input.requestedProjectName}"`,
          name: input.requestedProjectName,
        }
      }
    ),
    [SystemIOMachineActors.createKCLFile]: fromPromise(async ({ input }) => {
      const requestedProjectName = input.requestedProjectName
      const requestedFileNameWithExtension =
        input.requestedFileNameWithExtension
      const requestedCode = input.requestedCode
      const folders = input.context.folders

      if (!folders) {
        return Promise.reject(new Error('no folders'))
      }

      let newProjectName = requestedProjectName

      if (!newProjectName) {
        newProjectName = getUniqueProjectName(
          input.context.defaultProjectFolderName,
          folders
        )
      }

      const needsInterpolated = doesProjectNameNeedInterpolated(newProjectName)
      if (needsInterpolated) {
        const nextIndex = getNextProjectIndex(newProjectName, folders)
        newProjectName = interpolateProjectNameWithIndex(
          newProjectName,
          nextIndex
        )
      }

      const wasmInstance = await input.app.wasmPromise

      const baseDir = fsZds.join(
        input.context.projectDirectoryPath,
        newProjectName
      )
      const { name: newFileName } = await getNextFileName({
        entryName: requestedFileNameWithExtension,
        baseDir,
        wasmInstance,
      })

      const configuration = await readAppSettingsFile(wasmInstance)

      // Create the project around the file if newProject
      await createNewProjectDirectory(
        newProjectName,
        wasmInstance,
        requestedCode,
        configuration,
        newFileName,
        input.context.projectDirectoryPath
      )

      return {
        message: 'Successfully created file.',
        fileName: newFileName,
        projectName: newProjectName,
        subRoute: input.requestedSubRoute || '',
      }
    }),
    [SystemIOMachineActors.checkReadWrite]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectDirectoryPath: string
        }
      }) => {
        const requestProjectDirectoryPath = input.requestedProjectDirectoryPath
        if (!requestProjectDirectoryPath) {
          return { value: true, error: undefined }
        }
        const result = await canReadWriteDirectory(requestProjectDirectoryPath)
        return result
      }
    ),
    [SystemIOMachineActors.deleteKCLFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedFileName: string
        }
      }) => {
        const path = fsZds.join(
          input.context.projectDirectoryPath,
          input.requestedProjectName,
          input.requestedFileName
        )
        await fsZds.rm(path)
        return {
          message: 'File deleted successfully',
          projectName: input.requestedProjectName,
          fileName: input.requestedFileName,
        }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFiles]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          wasmInstancePromise: Promise<ModuleType>
        }
      }) => {
        const { wasmInstancePromise, ...otherInput } = input
        const wasmInstance = await wasmInstancePromise
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...otherInput,
            wasmInstance,
          },
        })
        return {
          ...message,
          subRoute: '',
        }
      }
    ),
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          requestedProjectName: string
          override?: boolean
          requestedSubRoute?: string
          wasmInstancePromise: Promise<ModuleType>
        }
      }) => {
        const { wasmInstancePromise, ...otherInput } = input
        const wasmInstance = await wasmInstancePromise
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...otherInput,
            wasmInstance,
            override: input.override,
          },
        })
        return {
          ...message,
          projectName: input.requestedProjectName,
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
    [SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile]:
      fromPromise(
        async ({
          input,
        }: {
          input: {
            context: SystemIOContext
            files: RequestedProjectFile[]
            requestedProjectName: string
            requestedFileNameWithExtension?: string
            requestedSubRoute?: string
          }
        }) => {
          const message = await sharedBulkWriteImportedProjectFilesWorkflow({
            input,
          })
          return {
            ...message,
            subRoute: input.requestedSubRoute || '',
          }
        }
      ),
    [SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile]:
      fromPromise(
        async ({
          input,
        }: {
          input: {
            context: SystemIOContext
            files: RequestedKCLFile[]
            filesToDelete?: RequestedKCLFileDelete[]
            requestedProjectName: string
            override?: boolean
            requestedFileNameWithExtension: string
            requestedSubRoute?: string
            onFileSystemError?: () => void
            onFileSystemSuccess?: () => void
            onSuccess?: () => void
          }
        }) => {
          try {
            const wasmInstance = await input.context.wasmInstancePromise
            const message = await sharedBulkCreateWorkflow({
              input: {
                ...input,
                wasmInstance,
                override: input.override,
              },
            })
            // We won't delete until everything's created / updated first.
            const totalDeleted = await sharedBulkDeleteWorkflow({
              input: {
                ...input,
                wasmInstance,
              },
            })

            message.message += `, ${totalDeleted} deleted`
            input.onFileSystemSuccess?.()

            const project = input.context.app.project
            const requestedRelativePath = normalizeKCLFileDeletePath(
              input.requestedFileNameWithExtension
            )
            const deletesRequestedFile = (input.filesToDelete ?? []).some(
              (file) =>
                normalizeKCLFileDeletePath(file.requestedFileName) ===
                requestedRelativePath
            )
            const requestedAbsolutePath = project
              ? fsZds.join(project.path, input.requestedFileNameWithExtension)
              : ''
            const shouldNavigate =
              !project ||
              project.name !== input.requestedProjectName ||
              project.executingPath !== requestedAbsolutePath ||
              deletesRequestedFile

            if (!shouldNavigate) {
              input.onSuccess?.()
            }

            return {
              ...message,
              projectName: input.requestedProjectName,
              fileName: input.requestedFileNameWithExtension || '',
              subRoute: input.requestedSubRoute || '',
              shouldNavigate,
              // Zookeeper streams cumulative edit patches, so one edit triggers
              // several of these bulk writes back-to-back. Sharing a toast id
              // collapses the otherwise-identical success toasts into one.
              toastId: ZOOKEEPER_FILE_WRITE_TOAST_ID,
              ...(shouldNavigate && input.onSuccess
                ? { onProjectLoaderComplete: input.onSuccess }
                : {}),
            }
          } catch (error: unknown) {
            input.onFileSystemError?.()
            return Promise.reject(error)
          }
        }
      ),
    [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          files: RequestedKCLFile[]
          requestedProjectName: string
          override?: boolean
          requestedFileNameWithExtension: string
          requestedSubRoute?: string
        }
      }) => {
        const wasmInstance = await input.context.wasmInstancePromise
        const message = await sharedBulkCreateWorkflow({
          input: {
            ...input,
            wasmInstance,
            override: input.override,
          },
        })
        return {
          ...message,
          projectName: input.requestedProjectName,
          fileName: input.requestedFileNameWithExtension || '',
          subRoute: input.requestedSubRoute || '',
        }
      }
    ),
    [SystemIOMachineActors.renameFolder]: fromPromise(async ({ input }) => {
      const { folderName, requestedFolderName, absolutePathToParentDirectory } =
        input
      const oldPath = fsZds.join(absolutePathToParentDirectory, folderName)
      const newPath = fsZds.join(
        absolutePathToParentDirectory,
        requestedFolderName
      )

      const requestedProjectName = input.requestedProjectName || ''
      const requestedFileNameWithExtension =
        input.requestedFileNameWithExtension || ''

      // ignore the rename if the resulting paths are the same
      if (oldPath === newPath) {
        return {
          message: `Old folder is the same as new.`,
          folderName,
          requestedFolderName,
          requestedProjectName,
          requestedFileNameWithExtension,
        }
      }

      // if there are any siblings with the same name, report error.
      const entries = await fsZds.readdir(fsZds.dirname(newPath))

      for (const entry of entries) {
        if (entry === requestedFolderName) {
          return Promise.reject(new Error('Folder name already exists.'))
        }
      }

      await fsZds.rename(oldPath, newPath)

      // TODO: remove duplicate state, make `app.project` the source of truth,
      // migrate systemIOMachine into a system that operates on that.
      //
      // Replace the signal value for the currently-opened executing editor if its
      // parent directory was renamed
      if (
        input.app.project?.executingPathSignal.value?.value.includes(oldPath)
      ) {
        const v = input.app.project.executingPathSignal.value.value
        input.app.project.executingPathSignal.value.value = v.replace(
          oldPath,
          newPath
        )
      }

      return {
        message: `Successfully renamed folder "${folderName}" to "${requestedFolderName}"`,
        folderName,
        requestedFolderName,
        requestedProjectName,
        requestedFileNameWithExtension,
      }
    }),
    [SystemIOMachineActors.renameFile]: fromPromise(async ({ input }) => {
      const {
        fileNameWithExtension,
        requestedFileNameWithExtension,
        absolutePathToParentDirectory,
      } = input

      const oldPath = fsZds.join(
        absolutePathToParentDirectory,
        fileNameWithExtension
      )
      const newPath = fsZds.join(
        absolutePathToParentDirectory,
        requestedFileNameWithExtension
      )

      const projectDirectoryPath = input.context.projectDirectoryPath
      const projectName = getProjectDirectoryFromKCLFilePath(
        newPath,
        projectDirectoryPath
      )
      const filePathWithExtensionRelativeToProject =
        parentPathRelativeToProject(newPath, projectDirectoryPath)

      // no-op
      if (oldPath === newPath) {
        return {
          message: `Old file is the same as new.`,
          projectName: projectName,
          filePathWithExtensionRelativeToProject,
        }
      }

      // if there are any siblings with the same name, report error.
      const entries = await fsZds.readdir(fsZds.dirname(newPath))

      for (const entry of entries) {
        if (entry === requestedFileNameWithExtension) {
          return Promise.reject(new Error('Filename already exists.'))
        }
      }

      await fsZds.rename(oldPath, newPath)

      // TODO: remove duplicate state, make `app.project` the source of truth,
      // migrate systemIOMachine into a system that operates on that.
      //
      // Replace the signal value for the currently-opened executing editor if
      // it was renamed.
      if (
        input.app.project?.executingPathSignal.value &&
        input.app.project.executingPathSignal.value.value === oldPath
      ) {
        input.app.project.executingPathSignal.value.value = newPath
      }

      return {
        message: `Successfully renamed file "${fileNameWithExtension}" to "${requestedFileNameWithExtension}"`,
        projectName: projectName,
        filePathWithExtensionRelativeToProject,
      }
    }),
    [SystemIOMachineActors.deleteFileOrFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedPath: string
          requestedProjectName?: string | undefined
        }
      }) => {
        await fsZds.rm(input.requestedPath, { recursive: true })
        const response = {
          message: 'File deleted successfully',
          requestedPath: input.requestedPath,
          requestedProjectName: input.requestedProjectName || '',
        }
        return response
      }
    ),
    [SystemIOMachineActors.createBlankFile]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedAbsolutePath: string
        }
      }) => {
        const fileNameWithExtension = getStringAfterLastSeparator(
          input.requestedAbsolutePath
        )
        try {
          const result = await fsZds.stat(input.requestedAbsolutePath)
          if (result) {
            return Promise.reject(
              new Error(`File ${fileNameWithExtension} already exists`)
            )
          }
        } catch (e) {
          console.error(e)
        }
        let fileContents = new Uint8Array()
        if (fsZds.extname(input.requestedAbsolutePath) === FILE_EXT) {
          const wasmInstance = await input.context.wasmInstancePromise
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
        await fsZds.writeFile(input.requestedAbsolutePath, fileContents)
        return {
          message: `File ${fileNameWithExtension} written successfully`,
          requestedAbsolutePath: input.requestedAbsolutePath,
        }
      }
    ),
    [SystemIOMachineActors.createBlankFolder]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedAbsolutePath: string
        }
      }) => {
        const folderName = getStringAfterLastSeparator(
          input.requestedAbsolutePath
        )
        try {
          const result = await fsZds.stat(input.requestedAbsolutePath)
          if (result) {
            return Promise.reject(
              new Error(`Folder ${folderName} already exists`)
            )
          }
        } catch (e) {
          if (e === 'ENOENT') {
            console.warn(
              `checking if folder is created, ${input.requestedAbsolutePath}`
            )
            console.warn(e)
          } else {
            console.error(e)
          }
        }
        await fsZds.mkdir(input.requestedAbsolutePath, {
          recursive: true,
        })
        return {
          message: `Folder ${folderName} written successfully`,
          requestedAbsolutePath: input.requestedAbsolutePath,
        }
      }
    ),
    [SystemIOMachineActors.copyRecursive]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          src: string
          target: string
        }
      }) => {
        await fsZds.cp(input.src, input.target, {
          recursive: true,
          force: false,
        })
        return {
          message: 'Copied successfully',
          requestedAbsolutePath: '',
        }
      }
    ),
    [SystemIOMachineActors.moveRecursive]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          src: string
          target: string
          successMessage?: string
          requestedProjectName?: string
        }
      }) => {
        // TODO: this force deletion behavior assumes this move is only
        // really used in our archive/restore workflow. We should make
        // dedicated archive/restore code paths for that if we need cases
        // where we want to check with the user before going through with forcing.
        await moveRecursivePath({
          src: input.src,
          target: input.target,
        })
        return {
          message: input.successMessage || 'Moved successfully',
          requestedAbsolutePath: '',
          requestedProjectName: input.requestedProjectName || '',
          target: input.target,
        }
      }
    ),
  },
})
