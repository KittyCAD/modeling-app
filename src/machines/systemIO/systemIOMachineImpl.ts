import { newKclFile } from '@src/lang/project'
import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
  runCloudSyncWriteTransaction,
} from '@src/lib/cloudSync'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  FILE_EXT,
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_SETTINGS_FILE_NAME,
  ZOOKEEPER_FILE_WRITE_TOAST_ID,
} from '@src/lib/constants'
import {
  canReadWriteDirectory,
  createNewProjectDirectory,
  ensureProjectDirectoryExists,
  getProjectInfo,
  mkdirOrNOOP,
  readAppSettingsFile,
  renameProjectDirectory,
  writeProjectSettingsFile,
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
import { isPublishDirectoryDestinationExists } from '@src/lib/fs-zds/errors'
import {
  getProjectDirectoryFromKCLFilePath,
  getStringAfterLastSeparator,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { sanitizeProjectName } from '@src/lib/projectName'
import { getProjectTomlContents } from '@src/lib/projectToml'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'
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
import { v4 } from 'uuid'
import { fromPromise } from 'xstate'

const DUPLICATE_STAGING_PREFIX = '.zds-duplicate-'
const DUPLICATE_STAGING_NAME_REGEXP =
  /^\.zds-duplicate-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPFS_DIRECTORY_METADATA_FILE_NAME = '._meta'
const activeDuplicateStagingPaths = new Set<string>()

function getWebLockManager() {
  return typeof navigator !== 'undefined' ? navigator.locks : undefined
}

function duplicateWebLockName(
  kind: 'directory' | 'staging',
  targetPath: string
) {
  return `zds:duplicate:${kind}:${targetPath.replaceAll('\\', '/')}`
}

async function runWithWebLock<T>(
  lockName: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockManager = getWebLockManager()
  if (!lockManager) {
    return operation()
  }
  let lockAcquired = false
  try {
    return await lockManager.request(lockName, async () => {
      lockAcquired = true
      return operation()
    })
  } catch (error) {
    if (lockAcquired) {
      return Promise.reject(error)
    }
    return operation()
  }
}

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

async function hasDuplicateInProgressMarker(projectPath: string) {
  try {
    await fsZds.stat(fsZds.join(projectPath, DUPLICATE_IN_PROGRESS_FILE_NAME))
    return true
  } catch (error) {
    // If the marker cannot be inspected, hiding the project is safer than
    // exposing a potentially partial copy.
    return !isPathNotFoundError(error)
  }
}

async function isProjectDirectoryQuarantined(projectPath: string) {
  try {
    const entries = await fsZds.readdir(projectPath)
    // The marker can appear after the stat in
    // hasDuplicateInProgressMarker. Treat the directory snapshot as a second
    // authoritative check before any project inspection can mutate it.
    if (entries.includes(DUPLICATE_IN_PROGRESS_FILE_NAME)) {
      return true
    }
    return entries.every(
      (entryName) => entryName === OPFS_DIRECTORY_METADATA_FILE_NAME
    )
  } catch {
    // Do not let project inspection mutate a directory whose contents cannot
    // be established safely.
    return true
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

async function getUniqueDuplicateProjectName({
  context,
  requestedProjectName,
  fallbackProjectName,
  projectDirectoryPath,
}: {
  context: SystemIOContext
  requestedProjectName: string
  fallbackProjectName: string
  projectDirectoryPath: string
}) {
  const reservedNames = new Set<string>()
  for (const folder of context.folders ?? []) {
    reservedNames.add(folder.name)
    reservedNames.add(getProjectDisplayName(folder))
  }
  for (const entryName of await getProjectDirectoryEntryNames(
    projectDirectoryPath
  )) {
    reservedNames.add(entryName)
  }
  if (cloudSyncStatus.value.enabled) {
    const normalizedProjectDirectoryPath =
      normalizeProjectPathForCloudMetadata(projectDirectoryPath)
    const projectPathPrefix = `${normalizedProjectDirectoryPath}/`
    const cloudProjectMetadataByPath =
      await getCloudSyncProjectMetadataIndex().catch(() => new Map())
    for (const metadataPath of cloudProjectMetadataByPath.keys()) {
      const normalizedMetadataPath =
        normalizeProjectPathForCloudMetadata(metadataPath)
      if (!normalizedMetadataPath.startsWith(projectPathPrefix)) {
        continue
      }
      const relativePath = normalizedMetadataPath.slice(
        projectPathPrefix.length
      )
      if (relativePath && !relativePath.includes('/')) {
        reservedNames.add(relativePath)
      }
    }
  }

  const normalizedReservedNames = new Set(
    Array.from(reservedNames, (name) => name.toLowerCase())
  )
  const sanitizedBaseName = sanitizeProjectName(
    requestedProjectName,
    fallbackProjectName
  )
  const safeBaseName = sanitizedBaseName
    .slice(0, MAX_PROJECT_NAME_LENGTH)
    .replace(/[. ]+$/g, '')
  if (!normalizedReservedNames.has(safeBaseName.toLowerCase())) {
    return safeBaseName
  }

  const endingNumber = safeBaseName.match(/^(.*?)([-_ ]?)(\d+)$/)
  let stem = endingNumber?.[1] ?? safeBaseName
  let numericSeparator = endingNumber?.[2] ?? '-'
  let index = endingNumber ? BigInt(endingNumber[3]) + 1n : 1n
  while (true) {
    let suffix = `${numericSeparator}${index}`
    if (suffix.length > MAX_PROJECT_NAME_LENGTH) {
      // A maximal all-9 suffix grows by one digit. Start a fresh bounded
      // sequence instead of slicing with a negative length or looping on an
      // imprecise Number.
      stem = safeBaseName
      numericSeparator = '-'
      index = 1n
      suffix = '-1'
    }
    const candidate = `${stem.slice(
      0,
      MAX_PROJECT_NAME_LENGTH - suffix.length
    )}${suffix}`
    if (!normalizedReservedNames.has(candidate.toLowerCase())) {
      return candidate
    }
    index += 1n
  }
}

async function cleanupStaleDuplicateStagingDirectories(
  projectDirectoryPath: string
) {
  const lockManager = getWebLockManager()
  for (const entryName of await getProjectDirectoryEntryNames(
    projectDirectoryPath
  )) {
    if (!DUPLICATE_STAGING_NAME_REGEXP.test(entryName)) {
      continue
    }

    const stagingPath = fsZds.join(projectDirectoryPath, entryName)
    if (activeDuplicateStagingPaths.has(stagingPath)) {
      continue
    }

    const cleanup = async () => {
      try {
        const stagingStat = await fsZds.stat(stagingPath)
        if (!(stagingStat.mode & fsZdsConstants.S_IFDIR)) {
          return
        }
        await fsZds.rm(stagingPath, { recursive: true, force: true })
      } catch (error) {
        if (!isPathNotFoundError(error)) {
          console.error('Failed to clean up stale duplicated project', error)
        }
      }
    }

    if (!lockManager) {
      // Without a cross-renderer lease there is no safe way to distinguish a
      // crashed stage from another renderer's active copy. Leave it alone.
      continue
    }

    const lockName = duplicateWebLockName('staging', stagingPath)
    try {
      await lockManager.request(
        lockName,
        { ifAvailable: true },
        async (lock) => {
          if (lock) {
            await cleanup()
          }
        }
      )
    } catch {
      // A partial Web Locks implementation is not sufficient proof that this
      // renderer owns cleanup rights, so preserve the staging directory.
    }
  }
}

async function resetDuplicatedProjectSettings({
  projectPath,
  projectTitle,
  wasmInstance,
}: {
  projectPath: string
  projectTitle: string
  wasmInstance: ModuleType
}) {
  const projectToml = await getProjectTomlContents({
    projectPath,
    wasmInstance,
  })
  if (isErr(projectToml)) {
    return Promise.reject(projectToml)
  }

  const duplicatedProjectToml = prepareProjectTomlForDuplication(
    projectToml,
    projectTitle,
    v4()
  )
  if (isErr(duplicatedProjectToml)) {
    return Promise.reject(duplicatedProjectToml)
  }

  // Desktop copies preserve symbolic links. Remove the copied project.toml
  // before writing so a symlink cannot mutate its source or an external file.
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  try {
    await fsZds.rm(projectTomlPath, { force: true })
  } catch (error) {
    if (!isPathNotFoundError(error)) {
      return Promise.reject(error)
    }
  }
  await writeProjectSettingsFile(projectPath, duplicatedProjectToml)
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
        await cleanupStaleDuplicateStagingDirectories(projectDirectoryPath)
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
          if (await hasDuplicateInProgressMarker(projectPath)) {
            continue
          }
          // getProjectInfo may initialize an empty writable directory with a
          // main.kcl. Skip empty reservations before calling it so a crash in
          // the mkdir-to-marker window remains quarantined and unmodified.
          if (await isProjectDirectoryQuarantined(projectPath)) {
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
          if (await hasDuplicateInProgressMarker(entry.path)) {
            continue
          }
          if (await isProjectDirectoryQuarantined(entry.path)) {
            continue
          }
          const project: Project = await getProjectInfo(
            entry.path,
            await context.wasmInstancePromise
          )
          if (await hasDuplicateInProgressMarker(entry.path)) {
            continue
          }
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
        input: { context: SystemIOContext; requestedProjectName: string }
      }) => {
        const requestedProjectName = input.requestedProjectName
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
          projectDirectoryPath
        )
        return {
          message: `Successfully created "${uniqueName}"`,
          name: uniqueName,
        }
      }
    ),
    [SystemIOMachineActors.duplicateProject]: fromPromise(
      async ({
        input,
      }: {
        input: {
          context: SystemIOContext
          projectName: string
          requestedProjectName: string
        }
      }) => {
        const folders = input.context.folders
        if (!folders) {
          return Promise.reject(new Error('Projects have not finished loading'))
        }
        if (input.context.projectDirectoryPath === NO_PROJECT_DIRECTORY) {
          return Promise.reject(
            new Error('Unable to determine the project directory.')
          )
        }

        const project = folders.find(
          (folder) => folder.name === input.projectName
        )
        if (!project) {
          return Promise.reject(
            new Error(`Project "${input.projectName}" does not exist`)
          )
        }
        if (!project.readWriteAccess) {
          return Promise.reject(
            new Error(
              `Project "${getProjectDisplayName(project)}" cannot be read`
            )
          )
        }

        const requestedProjectName =
          input.requestedProjectName.trim() || project.name
        const projectDirectoryPath = fsZds.resolve(
          input.context.projectDirectoryPath
        )
        const stagingPath = fsZds.join(
          projectDirectoryPath,
          `${DUPLICATE_STAGING_PREFIX}${v4()}`
        )
        activeDuplicateStagingPaths.add(stagingPath)
        try {
          return await runWithWebLock(
            duplicateWebLockName('staging', stagingPath),
            async () => {
              let ownsStagingProject = false
              try {
                await fsZds.mkdir(stagingPath)
                ownsStagingProject = true
                await fsZds.cp(project.path, stagingPath, {
                  recursive: true,
                  force: false,
                  verbatimSymlinks: true,
                })

                let duplicateName = ''
                await runWithWebLock(
                  duplicateWebLockName('directory', projectDirectoryPath),
                  async () => {
                    while (ownsStagingProject) {
                      duplicateName = await getUniqueDuplicateProjectName({
                        context: input.context,
                        requestedProjectName,
                        fallbackProjectName: project.name,
                        projectDirectoryPath,
                      })
                      if (duplicateName.length > MAX_PROJECT_NAME_LENGTH) {
                        return Promise.reject(
                          new Error(
                            `Project name "${duplicateName}" is too long, must be less than or equal to ${MAX_PROJECT_NAME_LENGTH} characters.`
                          )
                        )
                      }

                      const targetPath = fsZds.resolve(
                        projectDirectoryPath,
                        duplicateName
                      )
                      if (fsZds.dirname(targetPath) !== projectDirectoryPath) {
                        return Promise.reject(
                          new Error(
                            `Project name "${duplicateName}" is invalid.`
                          )
                        )
                      }

                      await resetDuplicatedProjectSettings({
                        projectPath: stagingPath,
                        projectTitle: duplicateName,
                        wasmInstance: await input.context.wasmInstancePromise,
                      })

                      let published = false
                      try {
                        await runCloudSyncWriteTransaction(
                          targetPath,
                          async () => {
                            await fsZds.publishDirectory(
                              stagingPath,
                              targetPath,
                              DUPLICATE_IN_PROGRESS_FILE_NAME
                            )
                            // Publication copies rather than renames so the
                            // destination can be reserved without clobbering
                            // an empty directory on Node/macOS. From here on,
                            // the complete target is independent of staging.
                            ownsStagingProject = false
                            published = true
                            await fsZds
                              .rm(stagingPath, {
                                recursive: true,
                                force: true,
                              })
                              .catch((cleanupError) => {
                                console.error(
                                  'Failed to clean up published duplicate staging directory',
                                  cleanupError
                                )
                              })
                          },
                          {
                            freshProjectIdentity: true,
                            // Keep the complete copy quarantined until stale
                            // path-keyed cloud identity has been cleared.
                            // This runs under the same project lock before
                            // the final cloud registration.
                            afterFreshIdentityReset: async () => {
                              await fsZds.rm(
                                fsZds.join(
                                  targetPath,
                                  DUPLICATE_IN_PROGRESS_FILE_NAME
                                )
                              )
                            },
                          }
                        )
                      } catch (error) {
                        // A destination can appear after name selection. Its
                        // contents are never ours, so preserve it and retry
                        // with a freshly selected bounded name.
                        if (
                          !published &&
                          isPublishDirectoryDestinationExists(error)
                        ) {
                          continue
                        }
                        return Promise.reject(error)
                      }
                    }
                  }
                )

                return {
                  message: `Successfully duplicated "${getProjectDisplayName(project)}" as "${duplicateName}"`,
                  name: duplicateName,
                }
              } catch (error) {
                if (ownsStagingProject) {
                  await fsZds
                    .rm(stagingPath, { recursive: true, force: true })
                    .catch((cleanupError) => {
                      console.error(
                        'Failed to clean up duplicated project',
                        cleanupError
                      )
                    })
                }
                return Promise.reject(error)
              }
            }
          )
        } finally {
          activeDuplicateStagingPaths.delete(stagingPath)
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

        const requestedProjectName = input.requestedProjectName
        const projectName = input.projectName
        const project = folders.find((p) => p.name === projectName)
        const existingDisplayName = project
          ? getProjectDisplayName(project)
          : projectName
        if (project?.cloudProjectId) {
          const currentProjectPath = fsZds.join(
            input.context.projectDirectoryPath,
            projectName
          )
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
            redirect: input.redirect,
          }
        }

        let newProjectName: string = requestedProjectName
        if (doesProjectNameNeedInterpolated(requestedProjectName)) {
          const nextIndex = getNextProjectIndex(requestedProjectName, folders)
          newProjectName = interpolateProjectNameWithIndex(
            requestedProjectName,
            nextIndex
          )
        }

        // Toast an error if the project name is taken
        if (folders.find((p) => p.name === newProjectName)) {
          return Promise.reject(
            new Error(`Project with name "${newProjectName}" already exists`)
          )
        }

        await renameProjectDirectory(
          fsZds.join(input.context.projectDirectoryPath, projectName),
          newProjectName
        )

        return {
          message: `Successfully renamed "${existingDisplayName}" to "${newProjectName}"`,
          oldName: projectName,
          newName: newProjectName,
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
  },
})
