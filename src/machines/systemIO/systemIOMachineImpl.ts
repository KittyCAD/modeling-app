import { newKclFile } from '@src/lang/project'
import { DEFAULT_DEFAULT_LENGTH_UNIT, FILE_EXT } from '@src/lib/constants'
import {
  canReadWriteDirectory,
  createNewProjectDirectory,
  getAppSettingsFilePath,
  getInitialProjectDirectoryPath,
  getProjectInfo,
  listRecentProjectsForCurrentEnvironment,
  mkdirOrNOOP,
  readAppSettingsFile,
  removeRecentProjectPath,
  renameProjectDirectory,
  statIsDirectory,
  trackRecentProject,
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
  getOpfsCloudProjectMetadataIndex,
  getOpfsCloudProjectModifiedTime,
  opfsCloudSyncStatus,
} from '@src/lib/fs-zds/opfsCloud'
import {
  getProjectDirectoryFromKCLFilePath,
  getStringAfterLastSeparator,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { sanitizeProjectName } from '@src/lib/projectName'
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
  SystemIOMachineActors,
  SystemIOMachineEvents,
  collectProjectFiles,
  jsonToMlConversations,
  mlConversationsToJson,
  normalizeKCLFileDeletePath,
} from '@src/machines/systemIO/utils'
import { fromPromise } from 'xstate'

const ML_CONVERSATIONS_FILE_NAME = 'ml-conversations.json'

function isPathNotFoundError(error: unknown) {
  return (
    error === 'ENOENT' ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT')
  )
}

async function getProjectNamesInDirectory(projectDirectoryPath: string) {
  await mkdirOrNOOP(projectDirectoryPath)
  const entries = await fsZds.readdir(projectDirectoryPath)
  const projectNames: FileEntry[] = []

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }

    const projectPath = fsZds.join(projectDirectoryPath, entry)
    if (await statIsDirectory(projectPath)) {
      projectNames.push({ name: entry, path: projectPath, children: [] })
    }
  }

  return projectNames
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
  const knownProjects: FileEntry[] = []
  for (const folder of context.folders ?? []) {
    knownProjects.push(folder)
  }
  if (projectDirectoryPath) {
    knownProjects.push(
      ...(await getProjectNamesInDirectory(projectDirectoryPath))
    )
  }

  return getUniqueProjectName(requestedProjectName, knownProjects)
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

function getProjectParentPathForComparison(projectPath: string) {
  const normalizedPath = projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')
  if (lastSeparatorIndex <= 0) {
    return ''
  }

  return normalizedPath.slice(0, lastSeparatorIndex)
}

const prepareBulkProjectWrite = async ({
  context,
  requestedProjectName,
  requestedProjectDirectoryPath,
  wasmInstance,
  useReservedProjectName = false,
}: {
  context: SystemIOContext
  requestedProjectName?: string
  requestedProjectDirectoryPath?: string
  wasmInstance: ModuleType
  useReservedProjectName?: boolean
}) => {
  const configuration = await readAppSettingsFile(wasmInstance)
  const requestedProjectBaseName = requestedProjectName?.split(fsZds.sep)[0]
  const existingRequestedProject = context.folders?.find(
    (project) => project.name === requestedProjectBaseName
  )
  const projectDirectoryPath =
    (existingRequestedProject
      ? fsZds.dirname(existingRequestedProject.path)
      : '') ||
    requestedProjectDirectoryPath ||
    context.projectDirectoryPath ||
    (await mkdirOrNOOP(await getInitialProjectDirectoryPath(wasmInstance)))

  if (!projectDirectoryPath) {
    return Promise.reject(
      new Error('Unable to determine the project directory.')
    )
  }

  const projectsForNameCollision =
    requestedProjectDirectoryPath && !existingRequestedProject
      ? await getProjectNamesInDirectory(projectDirectoryPath)
      : (context.folders ?? [])
  const targetProjectName =
    requestedProjectName || context.defaultProjectFolderName
  let projectName =
    useReservedProjectName || existingRequestedProject
      ? targetProjectName
      : getUniqueProjectName(targetProjectName, projectsForNameCollision)

  if (
    !useReservedProjectName &&
    !existingRequestedProject &&
    doesProjectNameNeedInterpolated(projectName)
  ) {
    const nextIndex = getNextProjectIndex(projectName, projectsForNameCollision)
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
    requestedProjectDirectoryPath?: string
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
    requestedProjectDirectoryPath: input.requestedProjectDirectoryPath,
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
  const project = await getProjectInfo(projectRoot, input.wasmInstance)
  await trackRecentProject(project)
  const numberOfFiles = input.files.length
  const fileText = numberOfFiles > 1 ? 'files' : 'file'
  const message = input.override
    ? `Successfully overwrote ${numberOfFiles} ${fileText}`
    : `Successfully created ${numberOfFiles} ${fileText}`
  return {
    message,
    fileName: '',
    projectName: newProjectName,
    projectDirectoryPath,
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
    requestedProjectDirectoryPath?: string
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
      requestedProjectDirectoryPath: input.requestedProjectDirectoryPath,
      wasmInstance,
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

    const project = await getProjectInfo(projectRoot, wasmInstance)
    await trackRecentProject(project)

    return {
      message: `Successfully imported project within "${projectName}"`,
      fileName: requestedFileNameWithExtension,
      projectName,
      projectDirectoryPath: fsZds.dirname(projectRoot),
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

  if (!project) return Promise.reject(new Error("Couldn't find project"))

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
    if (file.type === 'other') continue
    await fsZds.rm(file.absPath)
    totalDeleted += 1
  }

  // How many files we deleted successfully
  return totalDeleted
}

export function getCloudProjectFolderRenameName({
  title,
  currentName,
  folders,
}: {
  title: string
  currentName: string
  folders: Project[]
}) {
  const baseName = sanitizeProjectName(title, currentName)
  const existingNames = new Set(
    folders
      .filter((folder) => folder.name !== currentName)
      .map((folder) => folder.name.toLowerCase())
  )
  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName
  }

  let index = 2
  let candidate = `${baseName}-${index}`
  while (existingNames.has(candidate.toLowerCase())) {
    index += 1
    candidate = `${baseName}-${index}`
  }

  return candidate
}

export function getProjectForRename({
  folders,
  projectName,
  projectPath,
}: {
  folders: Project[]
  projectName: string
  projectPath?: string
}) {
  return projectPath
    ? folders.find((p) => p.path === projectPath)
    : folders.find((p) => p.name === projectName)
}

export function getLocalProjectRenameName({
  folders,
  oldProjectPath,
  requestedProjectName,
}: {
  folders: Project[]
  oldProjectPath: string
  requestedProjectName: string
}) {
  const siblingProjects = folders.filter(
    (p) =>
      getProjectParentPathForComparison(p.path) ===
      getProjectParentPathForComparison(oldProjectPath)
  )

  let newProjectName: string = requestedProjectName
  if (doesProjectNameNeedInterpolated(requestedProjectName)) {
    const nextIndex = getNextProjectIndex(requestedProjectName, siblingProjects)
    newProjectName = interpolateProjectNameWithIndex(
      requestedProjectName,
      nextIndex
    )
  }

  if (
    siblingProjects.find(
      (p) => p.path !== oldProjectPath && p.name === newProjectName
    )
  ) {
    return new Error(`Project with name "${newProjectName}" already exists`)
  }

  return newProjectName
}

export const systemIOMachineImpl = systemIOMachine.provide({
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(
      async ({ input: context }: { input: SystemIOContext }) => {
        let projects: Project[]
        try {
          projects = await listRecentProjectsForCurrentEnvironment(
            await context.wasmInstancePromise
          )
        } catch {
          return []
        }
        const cloudProjectMetadataByPath = opfsCloudSyncStatus.value.enabled
          ? await getOpfsCloudProjectMetadataIndex().catch(() => new Map())
          : new Map()

        return projects.map((project): Project => {
          const cloudMetadata = cloudProjectMetadataByPath.get(
            normalizeProjectPathForCloudMetadata(project.path)
          )
          const nextProject: Project = {
            ...project,
            metadata: project.metadata
              ? {
                  ...project.metadata,
                  modified: getOpfsCloudProjectModifiedTime(
                    cloudMetadata,
                    project.metadata.modified
                  ),
                }
              : project.metadata,
          }
          nextProject.cloudProjectId ??= cloudMetadata?.remoteProjectId
          nextProject.cloudConflict = cloudMetadata?.conflict
          return nextProject
        })
      }
    ),
    [SystemIOMachineActors.createProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          requestedProjectDirectoryPath?: string
        }
      }) => {
        const requestedProjectName = input.requestedProjectName
        const wasmInstance = await input.context.wasmInstancePromise
        const projectDirectoryPath =
          input.requestedProjectDirectoryPath ||
          input.context.projectDirectoryPath ||
          (await getInitialProjectDirectoryPath(wasmInstance))
        const uniqueName = await getUniqueProjectNameForCreate({
          context: input.context,
          requestedProjectName,
          projectDirectoryPath,
        })
        const project = await createNewProjectDirectory(
          uniqueName,
          wasmInstance,
          undefined,
          undefined,
          undefined,
          projectDirectoryPath
        )
        await trackRecentProject(project)
        return {
          message: `Successfully created "${uniqueName}"`,
          name: uniqueName,
          path: project.path,
          projectDirectoryPath: fsZds.dirname(project.path),
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
          projectPath?: string
          redirect: boolean
        }
      }) => {
        const folders = input.context.folders
        if (!folders) {
          return Promise.reject(new Error('no folders'))
        }

        const requestedProjectName = input.requestedProjectName
        const projectName = input.projectName
        const project = getProjectForRename({
          folders,
          projectName,
          projectPath: input.projectPath,
        })
        const existingDisplayName = project
          ? getProjectDisplayName(project)
          : projectName
        if (project?.cloudProjectId) {
          const currentProjectPath = project.path
          await writeProjectTitleToProjectToml(
            currentProjectPath,
            requestedProjectName
          )

          const newProjectName = getCloudProjectFolderRenameName({
            title: requestedProjectName,
            currentName: projectName,
            folders,
          })
          let renamedProjectName = projectName
          let renamedProjectPath = currentProjectPath
          if (newProjectName !== projectName) {
            await renameProjectDirectory(currentProjectPath, newProjectName)
              .then((nextProjectPath) => {
                renamedProjectName = newProjectName
                renamedProjectPath = nextProjectPath
              })
              .catch(() => undefined)
          }
          const renamedProject = await getProjectInfo(
            renamedProjectPath,
            await input.context.wasmInstancePromise
          )
          if (renamedProjectPath !== currentProjectPath) {
            await removeRecentProjectPath(currentProjectPath)
          }
          await trackRecentProject(renamedProject, {
            lastOpenedAt: project.last_opened_at,
          })

          return {
            message: `Successfully renamed "${existingDisplayName}" to "${requestedProjectName}"`,
            oldName: projectName,
            newName: renamedProjectName,
            path: renamedProject.path,
            projectDirectoryPath: fsZds.dirname(renamedProject.path),
            redirect: input.redirect,
          }
        }

        const projectToRename = project
        const oldProjectPath =
          input.projectPath ||
          projectToRename?.path ||
          fsZds.join(input.context.projectDirectoryPath, projectName)
        const newProjectName = getLocalProjectRenameName({
          folders,
          oldProjectPath,
          requestedProjectName,
        })
        if (err(newProjectName)) {
          return Promise.reject(newProjectName)
        }

        const newProjectPath = await renameProjectDirectory(
          oldProjectPath,
          newProjectName
        )
        await removeRecentProjectPath(oldProjectPath)
        const renamedProject = await getProjectInfo(
          newProjectPath,
          await input.context.wasmInstancePromise
        )
        await trackRecentProject(renamedProject, {
          lastOpenedAt: projectToRename?.last_opened_at,
        })

        return {
          message: `Successfully renamed "${existingDisplayName}" to "${newProjectName}"`,
          oldName: projectName,
          newName: newProjectName,
          path: renamedProject.path,
          projectDirectoryPath: fsZds.dirname(renamedProject.path),
          redirect: input.redirect,
        }
      }
    ),
    [SystemIOMachineActors.deleteProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          requestedProjectName: string
          projectPath?: string
        }
      }) => {
        const projectToDelete = input.context.folders?.find(
          (p) =>
            p.path === input.projectPath ||
            p.name === input.requestedProjectName
        )
        const projectPath =
          input.projectPath ||
          projectToDelete?.path ||
          fsZds.join(
            input.context.projectDirectoryPath,
            input.requestedProjectName
          )
        await fsZds.rm(projectPath, {
          recursive: true,
        })
        await removeRecentProjectPath(projectPath)

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

      const wasmInstance = await input.app.wasmPromise
      const existingProject = folders.find(
        (project) => project.name === requestedProjectName
      )
      let projectDirectoryPath =
        (existingProject ? fsZds.dirname(existingProject.path) : '') ||
        input.requestedProjectDirectoryPath ||
        input.context.projectDirectoryPath
      if (!projectDirectoryPath) {
        projectDirectoryPath =
          await getInitialProjectDirectoryPath(wasmInstance)
      }
      const projectsForNameCollision =
        input.requestedProjectDirectoryPath && !existingProject
          ? await getProjectNamesInDirectory(projectDirectoryPath)
          : folders
      let newProjectName =
        existingProject && requestedProjectName
          ? requestedProjectName
          : getUniqueProjectName(
              requestedProjectName || input.context.defaultProjectFolderName,
              projectsForNameCollision
            )

      const needsInterpolated = doesProjectNameNeedInterpolated(newProjectName)
      if (needsInterpolated) {
        const nextIndex = getNextProjectIndex(
          newProjectName,
          projectsForNameCollision
        )
        newProjectName = interpolateProjectNameWithIndex(
          newProjectName,
          nextIndex
        )
      }

      const baseDir = fsZds.join(projectDirectoryPath, newProjectName)
      const { name: newFileName } = await getNextFileName({
        entryName: requestedFileNameWithExtension,
        baseDir,
        wasmInstance,
      })

      const configuration = await readAppSettingsFile(wasmInstance)

      // Create the project around the file if newProject
      const project = await createNewProjectDirectory(
        newProjectName,
        wasmInstance,
        requestedCode,
        configuration,
        newFileName,
        projectDirectoryPath
      )
      await trackRecentProject(project)

      return {
        message: 'Successfully created file.',
        fileName: newFileName,
        projectName: newProjectName,
        projectDirectoryPath: fsZds.dirname(project.path),
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
          requestedProjectDirectoryPath?: string
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
            requestedProjectDirectoryPath: input.requestedProjectDirectoryPath,
            override: input.override,
          },
        })
        return {
          ...message,
          projectName: message.projectName,
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
            requestedProjectDirectoryPath?: string
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
            requestedProjectDirectoryPath?: string
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
                requestedProjectDirectoryPath:
                  input.requestedProjectDirectoryPath,
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
              projectName: message.projectName,
              fileName: input.requestedFileNameWithExtension || '',
              subRoute: input.requestedSubRoute || '',
              shouldNavigate,
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
          requestedProjectDirectoryPath?: string
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
            requestedProjectDirectoryPath: input.requestedProjectDirectoryPath,
            override: input.override,
          },
        })
        return {
          ...message,
          projectName: message.projectName,
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

      for (let entry of entries) {
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

      for (let entry of entries) {
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
        let response = {
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
    [SystemIOMachineActors.getMlEphantConversations]: fromPromise(async () => {
      // In the future we can add cache behavior but it's really pointless
      // for the amount of data and frequency we're dealing with.

      // We need the settings path to find the sibling `ml-conversations.json`
      try {
        const json = await fsZds.readFile(
          fsZds.join(
            fsZds.dirname(await getAppSettingsFilePath()),
            ML_CONVERSATIONS_FILE_NAME
          ),
          { encoding: 'utf-8' }
        )
        return jsonToMlConversations(json ?? '')
      } catch (e) {
        console.warn('Cannot get conversations', e)
        return new Map()
      }
    }),
    [SystemIOMachineActors.saveMlEphantConversations]: fromPromise(
      async (args: {
        input: {
          context: SystemIOContext
          event:
            | {
                type: SystemIOMachineEvents.saveMlEphantConversations
                data: {
                  projectId: string
                  conversationId: string
                }
              }
            | {
                type: SystemIOMachineEvents.deleteMlEphantConversation
                data: {
                  projectId: string
                }
              }
        }
      }) => {
        const next = new Map<string, string>(
          args.input.context.mlEphantConversations
        )
        if (
          args.input.event.type ===
          SystemIOMachineEvents.deleteMlEphantConversation
        ) {
          next.delete(args.input.event.data.projectId)
        } else {
          next.set(
            args.input.event.data.projectId,
            args.input.event.data.conversationId
          )
        }
        const json = mlConversationsToJson(next)
        const te = new TextEncoder()
        await fsZds.writeFile(
          fsZds.join(
            fsZds.dirname(await getAppSettingsFilePath()),
            ML_CONVERSATIONS_FILE_NAME
          ),
          te.encode(json)
        )
        return next
      }
    ),
  },
})
