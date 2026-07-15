import { newKclFile } from '@src/lang/project'
import { flushActiveTextFileWrite } from '@src/lib/activeTextFile'
import {
  cloudSyncStatus,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
  resetCloudSyncProjectIdentityForRecovery,
  runCloudSyncWriteTransaction,
} from '@src/lib/cloudSync'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  DUPLICATE_RESERVATION_FILE_PREFIX,
  DUPLICATE_STAGING_NAME_REGEXP,
  DUPLICATE_STAGING_PREFIX,
  FILE_EXT,
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_SETTINGS_FILE_NAME,
  ZOOKEEPER_FILE_WRITE_TOAST_ID,
} from '@src/lib/constants'
import {
  canReadDirectory,
  canReadWriteDirectory,
  createNewProjectDirectory,
  ensureProjectDirectoryExists,
  getProjectInfo,
  mkdirOrNOOP,
  readAppSettingsFile,
  renameProjectDirectory,
  writeProjectSettingsFileUnlocked,
  writeProjectTitleToProjectTomlUnlocked,
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
  createDuplicatePublicationEvidence,
  DUPLICATE_ARTIFACT_STALE_MS,
  DUPLICATE_OWNERSHIP_VERSION,
  type DuplicateOwnershipEvidence,
  duplicateEvidenceMatches,
  getDuplicateReservationFileName,
  parseDuplicateOwnershipEvidence,
  serializeDuplicateOwnershipEvidence,
} from '@src/lib/fs-zds/duplicateReservations'
import { isProjectDirectoryQuarantined } from '@src/lib/fs-zds/duplicateQuarantine'
import { isPublishDirectoryDestinationExists } from '@src/lib/fs-zds/errors'
import {
  getProjectDirectoryFromKCLFilePath,
  getStringAfterLastSeparator,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import type { FileEntry, Project } from '@src/lib/project'
import {
  getProjectDirectoryNamespaceLockName,
  runWithProjectDirectoryNamespaceLock,
  runWithProjectFilesystemMutationLock,
} from '@src/lib/projectDirectoryNamespaceLock'
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

const OPFS_DIRECTORY_METADATA_FILE_NAME = '._meta'
const activeDuplicateStagingPaths = new Set<string>()

function getWebLockManager() {
  return typeof navigator !== 'undefined' ? navigator.locks : undefined
}

function duplicateWebLockName(kind: 'staging', targetPath: string) {
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

async function readDuplicateOwnershipEvidence(targetPath: string) {
  try {
    return parseDuplicateOwnershipEvidence(
      await fsZds.readFile(targetPath, { encoding: 'utf-8' })
    )
  } catch {
    return undefined
  }
}

async function removeDuplicateEvidenceFileIfOwned(
  targetPath: string,
  expected: Pick<DuplicateOwnershipEvidence, 'kind' | 'token'> & {
    phase?: DuplicateOwnershipEvidence['phase']
  }
) {
  if (
    duplicateEvidenceMatches(
      await readDuplicateOwnershipEvidence(targetPath),
      expected
    )
  ) {
    await fsZds.rm(targetPath, { force: true })
    return true
  }
  return false
}

async function finalizeDuplicateEvidenceFile(
  targetPath: string,
  expected: Pick<DuplicateOwnershipEvidence, 'kind' | 'token'> & {
    phase?: DuplicateOwnershipEvidence['phase']
  },
  ownershipErrorMessage: string
) {
  const evidence = await readDuplicateOwnershipEvidence(targetPath)
  if (duplicateEvidenceMatches(evidence, expected)) {
    await fsZds.rm(targetPath)
    if (await pathExists(targetPath)) {
      return Promise.reject(new Error(ownershipErrorMessage))
    }
    return
  }
  if (!(await pathExists(targetPath))) {
    // A previous recovery/finalization attempt already completed this step.
    return
  }
  return Promise.reject(new Error(ownershipErrorMessage))
}

async function finalizeDuplicateTargetMarker(
  targetPath: string,
  expected: Pick<DuplicateOwnershipEvidence, 'kind' | 'token'> & {
    phase?: DuplicateOwnershipEvidence['phase']
  }
) {
  return finalizeDuplicateEvidenceFile(
    targetPath,
    expected,
    'Duplicate target marker ownership could not be verified'
  )
}

async function finalizeDuplicateReservation(
  reservationPath: string,
  expected: Pick<DuplicateOwnershipEvidence, 'kind' | 'token'> & {
    phase?: DuplicateOwnershipEvidence['phase']
  }
) {
  return finalizeDuplicateEvidenceFile(
    reservationPath,
    expected,
    'Duplicate reservation ownership could not be verified'
  )
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
    if (
      projectDirectoryPath &&
      entryName.startsWith(DUPLICATE_RESERVATION_FILE_PREFIX)
    ) {
      const reservation = await readDuplicateOwnershipEvidence(
        fsZds.join(projectDirectoryPath, entryName)
      )
      if (
        reservation?.kind === 'reservation' &&
        entryName === getDuplicateReservationFileName(reservation.targetName)
      ) {
        knownProjectNames.add(reservation.targetName)
      }
    }
  }

  const existingEntries: FileEntry[] = Array.from(
    knownProjectNames,
    (name) => ({
      name: name.normalize('NFC'),
      path: projectDirectoryPath
        ? fsZds.join(projectDirectoryPath, name)
        : name,
      children: [],
    })
  )
  return getUniqueProjectName(
    requestedProjectName.normalize('NFC'),
    existingEntries
  )
}

async function getUniqueDuplicateProjectName({
  context,
  requestedProjectName,
  fallbackProjectName,
  projectDirectoryPath,
  rejectedNames,
}: {
  context: SystemIOContext
  requestedProjectName: string
  fallbackProjectName: string
  projectDirectoryPath: string
  rejectedNames?: ReadonlySet<string>
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
    Array.from(reservedNames, normalizeProjectNameCollisionKey)
  )
  for (const rejectedName of rejectedNames ?? []) {
    normalizedReservedNames.add(normalizeProjectNameCollisionKey(rejectedName))
  }
  const sanitizedBaseName = sanitizeProjectName(
    requestedProjectName,
    fallbackProjectName
  )
  const safeBaseName = truncateProjectNameWithoutSplittingCodePoint(
    sanitizedBaseName,
    MAX_PROJECT_NAME_LENGTH
  ).replace(/[. ]+$/g, '')
  if (
    !normalizedReservedNames.has(normalizeProjectNameCollisionKey(safeBaseName))
  ) {
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
    const candidate = `${truncateProjectNameWithoutSplittingCodePoint(
      stem,
      MAX_PROJECT_NAME_LENGTH - suffix.length
    )}${suffix}`
    if (
      !normalizedReservedNames.has(normalizeProjectNameCollisionKey(candidate))
    ) {
      return candidate
    }
    index += 1n
  }
}

export function normalizeProjectNameCollisionKey(name: string) {
  return name.normalize('NFC').toLowerCase().normalize('NFC')
}

export function truncateProjectNameWithoutSplittingCodePoint(
  name: string,
  maxLength: number
) {
  if (name.length <= maxLength) {
    return name
  }

  const truncated = name.slice(0, Math.max(0, maxLength))
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1)
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff
    ? truncated.slice(0, -1)
    : truncated
}

function isStaleDuplicateEvidence(evidence: DuplicateOwnershipEvidence) {
  return Date.now() - evidence.createdAt >= DUPLICATE_ARTIFACT_STALE_MS
}

async function runDuplicateCleanupWithAvailableLock(
  lockName: string,
  cleanup: () => Promise<void>
) {
  const lockManager = getWebLockManager()
  if (!lockManager) return
  let cleanupStarted = false
  try {
    await lockManager.request(lockName, { ifAvailable: true }, async (lock) => {
      if (lock) {
        cleanupStarted = true
        await cleanup()
      }
    })
  } catch (error) {
    if (cleanupStarted) {
      return Promise.reject(error)
    }
    // A partial Web Locks implementation is not proof of cleanup ownership.
  }
}

async function removeOwnedDuplicateStage(
  projectDirectoryPath: string,
  token: string
) {
  const stagingPath = fsZds.join(
    projectDirectoryPath,
    `${DUPLICATE_STAGING_PREFIX}${token}`
  )
  if (activeDuplicateStagingPaths.has(stagingPath)) return
  await runDuplicateCleanupWithAvailableLock(
    duplicateWebLockName('staging', stagingPath),
    async () => {
      const markerPath = fsZds.join(
        stagingPath,
        DUPLICATE_IN_PROGRESS_FILE_NAME
      )
      const evidence = await readDuplicateOwnershipEvidence(markerPath)
      if (
        evidence?.kind !== 'stage' ||
        evidence.token !== token ||
        !isStaleDuplicateEvidence(evidence)
      ) {
        return
      }
      await fsZds.rm(stagingPath, { recursive: true, force: true })
    }
  )
}

async function recoverPublishedDuplicate(
  projectDirectoryPath: string,
  targetName: string,
  token: string
) {
  const targetPath = fsZds.resolve(projectDirectoryPath, targetName)
  if (fsZds.dirname(targetPath) !== projectDirectoryPath) return
  const markerPath = fsZds.join(targetPath, DUPLICATE_IN_PROGRESS_FILE_NAME)
  const reservationPath = fsZds.join(
    projectDirectoryPath,
    getDuplicateReservationFileName(targetName)
  )
  await runCloudSyncWriteTransaction(targetPath, async () => undefined, {
    freshProjectIdentity: true,
    afterFreshIdentityReset: async () => {
      await finalizeDuplicateTargetMarker(markerPath, {
        kind: 'target',
        phase: 'published',
        token,
      })
      await finalizeDuplicateReservation(reservationPath, {
        kind: 'reservation',
        token,
      })
    },
  })
  await removeOwnedDuplicateStage(projectDirectoryPath, token)
}

async function cleanStaleDuplicateReservation(
  projectDirectoryPath: string,
  reservationPath: string,
  reservation: DuplicateOwnershipEvidence & { kind: 'reservation' }
) {
  if (!isStaleDuplicateEvidence(reservation)) return
  const targetPath = fsZds.resolve(projectDirectoryPath, reservation.targetName)
  if (fsZds.dirname(targetPath) !== projectDirectoryPath) return
  const markerPath = fsZds.join(targetPath, DUPLICATE_IN_PROGRESS_FILE_NAME)
  const marker = await readDuplicateOwnershipEvidence(markerPath)

  if (
    duplicateEvidenceMatches(marker, {
      kind: 'target',
      phase: 'published',
      token: reservation.token,
    }) &&
    (await pathExists(targetPath))
  ) {
    await recoverPublishedDuplicate(
      projectDirectoryPath,
      reservation.targetName,
      reservation.token
    )
    return
  }

  if (reservation.phase === 'published' && !marker) {
    await removeDuplicateEvidenceFileIfOwned(reservationPath, {
      kind: 'reservation',
      phase: 'published',
      token: reservation.token,
    })
    await removeOwnedDuplicateStage(projectDirectoryPath, reservation.token)
    return
  }

  let targetSafelyRemoved = !(await pathExists(targetPath))
  if (
    (reservation.phase === 'prepared' || reservation.phase === 'reserved') &&
    duplicateEvidenceMatches(marker, {
      kind: 'target',
      phase: 'publishing',
      token: reservation.token,
    })
  ) {
    // The publisher only copies content after atomically reserving the name
    // and writing this token to the target. All in-app namespace writers use
    // the same directory lease as this cleanup, so the matching reservation
    // and marker prove that even a non-empty mid-copy target is ours.
    const [markerBeforeRemoval, reservationBeforeRemoval] = await Promise.all([
      readDuplicateOwnershipEvidence(markerPath),
      readDuplicateOwnershipEvidence(reservationPath),
    ])
    if (
      duplicateEvidenceMatches(markerBeforeRemoval, {
        kind: 'target',
        phase: 'publishing',
        token: reservation.token,
      }) &&
      duplicateEvidenceMatches(reservationBeforeRemoval, {
        kind: 'reservation',
        phase: reservation.phase,
        token: reservation.token,
      }) &&
      reservationBeforeRemoval?.kind === 'reservation' &&
      normalizeProjectNameCollisionKey(reservationBeforeRemoval.targetName) ===
        normalizeProjectNameCollisionKey(reservation.targetName)
    ) {
      await resetCloudSyncProjectIdentityForRecovery(targetPath)
      await fsZds.rm(targetPath, { recursive: true, force: true })
      targetSafelyRemoved = true
    }
  } else if (
    !marker &&
    (reservation.phase === 'prepared' || reservation.phase === 'reserved') &&
    !targetSafelyRemoved
  ) {
    const targetEntries = await fsZds.readdir(targetPath).catch(() => undefined)
    if (
      targetEntries?.every(
        (entryName) =>
          entryName === OPFS_DIRECTORY_METADATA_FILE_NAME ||
          entryName === DUPLICATE_IN_PROGRESS_FILE_NAME
      )
    ) {
      const reservationBeforeRemoval =
        await readDuplicateOwnershipEvidence(reservationPath)
      if (
        duplicateEvidenceMatches(reservationBeforeRemoval, {
          kind: 'reservation',
          phase: reservation.phase,
          token: reservation.token,
        })
      ) {
        await resetCloudSyncProjectIdentityForRecovery(targetPath)
        await fsZds.rm(targetPath, { recursive: true, force: true })
        targetSafelyRemoved = true
      }
    }
  }

  const markerFileStillPresent = await pathExists(markerPath)
  if (targetSafelyRemoved || !markerFileStillPresent) {
    await removeOwnedDuplicateStage(projectDirectoryPath, reservation.token)
    await finalizeDuplicateReservation(reservationPath, {
      kind: 'reservation',
      token: reservation.token,
      phase: reservation.phase,
    })
  }
}

async function cleanupStaleDuplicateArtifacts(projectDirectoryPath: string) {
  const entryNames = await getProjectDirectoryEntryNames(projectDirectoryPath)
  for (const entryName of entryNames) {
    try {
      if (DUPLICATE_STAGING_NAME_REGEXP.test(entryName)) {
        const token = entryName.slice(DUPLICATE_STAGING_PREFIX.length)
        const evidence = await readDuplicateOwnershipEvidence(
          fsZds.join(
            projectDirectoryPath,
            entryName,
            DUPLICATE_IN_PROGRESS_FILE_NAME
          )
        )
        if (
          evidence?.kind === 'stage' &&
          evidence.token === token &&
          isStaleDuplicateEvidence(evidence)
        ) {
          await removeOwnedDuplicateStage(projectDirectoryPath, token)
        }
        continue
      }

      if (entryName.startsWith(DUPLICATE_RESERVATION_FILE_PREFIX)) {
        const reservationPath = fsZds.join(projectDirectoryPath, entryName)
        const reservation =
          await readDuplicateOwnershipEvidence(reservationPath)
        if (
          reservation?.kind !== 'reservation' ||
          entryName !== getDuplicateReservationFileName(reservation.targetName)
        ) {
          continue
        }
        await runDuplicateCleanupWithAvailableLock(
          getProjectDirectoryNamespaceLockName(projectDirectoryPath),
          () =>
            runWithProjectFilesystemMutationLock(() =>
              cleanStaleDuplicateReservation(
                projectDirectoryPath,
                reservationPath,
                reservation
              )
            )
        )
        continue
      }

      if (entryName.startsWith('.')) continue
      const marker = await readDuplicateOwnershipEvidence(
        fsZds.join(
          projectDirectoryPath,
          entryName,
          DUPLICATE_IN_PROGRESS_FILE_NAME
        )
      )
      if (
        marker?.kind === 'target' &&
        marker.phase === 'published' &&
        isStaleDuplicateEvidence(marker)
      ) {
        await runDuplicateCleanupWithAvailableLock(
          getProjectDirectoryNamespaceLockName(projectDirectoryPath),
          () =>
            runWithProjectFilesystemMutationLock(() =>
              recoverPublishedDuplicate(
                projectDirectoryPath,
                entryName,
                marker.token
              )
            )
        )
      }
    } catch (error) {
      console.warn(
        `Unable to recover stale duplicate artifact "${entryName}"`,
        error
      )
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
  await writeProjectSettingsFileUnlocked(projectPath, duplicatedProjectToml)
}

async function copyProjectDirectoryContents(
  sourceProjectPath: string,
  stagingPath: string
) {
  for (const entryName of await fsZds.readdir(sourceProjectPath)) {
    // The staging directory already owns a valid marker at this path. A user
    // file with the reserved name is never duplicate payload, even when its
    // contents are not valid ownership evidence.
    if (entryName === DUPLICATE_IN_PROGRESS_FILE_NAME) {
      continue
    }
    await fsZds.cp(
      fsZds.join(sourceProjectPath, entryName),
      fsZds.join(stagingPath, entryName),
      {
        recursive: true,
        force: false,
        errorOnExist: true,
        // Following the top-level project directory through readdir supports a
        // symlinked project root. Each nested symlink is still copied verbatim.
        verbatimSymlinks: true,
      }
    )
  }
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
  let projectName = targetProjectName
  if (
    !useReservedProjectName &&
    (!requestedProjectName ||
      doesProjectNameNeedInterpolated(targetProjectName))
  ) {
    projectName = await getUniqueProjectNameForCreate({
      context,
      requestedProjectName: targetProjectName,
      projectDirectoryPath,
    })
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
  const preparedProjectWrite = await prepareBulkProjectWrite({
    context: input.context,
    requestedProjectName: input.files[0]?.requestedProjectName,
    wasmInstance: input.wasmInstance,
  })
  const namespacePath = fsZds.resolve(preparedProjectWrite.projectDirectoryPath)
  return runWithProjectDirectoryNamespaceLock(namespacePath, () =>
    runWithProjectFilesystemMutationLock(async () => {
      // Name allocation has to happen while holding the same namespace lease
      // as duplicate publication, project creation, and rename.
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
    })
  )
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
    const { projectDirectoryPath, projectName, projectRoot } =
      await prepareBulkProjectWrite({
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

    const namespacePath = fsZds.resolve(projectDirectoryPath)
    return runWithProjectDirectoryNamespaceLock(namespacePath, () =>
      runWithProjectFilesystemMutationLock(async () => {
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
      })
    )
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
    await runWithProjectFilesystemMutationLock(() => fsZds.rm(absPath), {
      ifAvailable: true,
      mode: 'shared',
    })
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
        const projectDirectoryPath =
          context.projectDirectoryPath === NO_PROJECT_DIRECTORY
            ? NO_PROJECT_DIRECTORY
            : fsZds.resolve(context.projectDirectoryPath)
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
        await cleanupStaleDuplicateArtifacts(projectDirectoryPath)
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
          if (await isProjectDirectoryQuarantined(entry.path)) {
            continue
          }
          let project: Project = await getProjectInfo(
            entry.path,
            await context.wasmInstancePromise
          )
          if (await isProjectDirectoryQuarantined(entry.path)) {
            continue
          }
          if (
            project.kcl_file_count === 0 &&
            project.readWriteAccess &&
            canReadWriteProjectDirectory
          ) {
            // getProjectInfo initializes a writable empty directory's default
            // file after its first tree walk. Refresh once so a legitimate
            // empty project appears immediately; ownership evidence above
            // keeps duplicate reservations out of this path.
            project = await getProjectInfo(
              entry.path,
              await context.wasmInstancePromise
            )
            if (project.kcl_file_count === 0) {
              continue
            }
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
        const configuredProjectDirectoryPath =
          input.context.projectDirectoryPath &&
          input.context.projectDirectoryPath !== NO_PROJECT_DIRECTORY
            ? input.context.projectDirectoryPath
            : undefined
        const wasmInstance = await input.context.wasmInstancePromise
        const configuration = await readAppSettingsFile(wasmInstance)
        const rawProjectDirectoryPath =
          configuredProjectDirectoryPath ??
          (await ensureProjectDirectoryExists(configuration))
        if (!rawProjectDirectoryPath) {
          return Promise.reject(
            new Error('Unable to determine the project directory.')
          )
        }
        const projectDirectoryPath = fsZds.resolve(rawProjectDirectoryPath)
        return runWithProjectDirectoryNamespaceLock(projectDirectoryPath, () =>
          runWithProjectFilesystemMutationLock(async () => {
            const uniqueName = await getUniqueProjectNameForCreate({
              context: input.context,
              requestedProjectName,
              projectDirectoryPath,
            })
            await createNewProjectDirectory(
              uniqueName,
              wasmInstance,
              undefined,
              configuration,
              undefined,
              projectDirectoryPath
            )
            return {
              message: `Successfully created "${uniqueName}"`,
              name: uniqueName,
            }
          })
        )
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
        const { value: canReadSourceProject } = await canReadDirectory(
          project.path
        )
        if (!canReadSourceProject) {
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
        const { value: canWriteProjectDirectory } =
          await canReadWriteDirectory(projectDirectoryPath)
        if (!canWriteProjectDirectory) {
          return Promise.reject(
            new Error('The project directory cannot be written to.')
          )
        }
        const duplicateToken = v4()
        const duplicateCreatedAt = Date.now()
        const stagingPath = fsZds.join(
          projectDirectoryPath,
          `${DUPLICATE_STAGING_PREFIX}${duplicateToken}`
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
                await fsZds.writeFile(
                  fsZds.join(stagingPath, DUPLICATE_IN_PROGRESS_FILE_NAME),
                  serializeDuplicateOwnershipEvidence({
                    version: DUPLICATE_OWNERSHIP_VERSION,
                    kind: 'stage',
                    phase: 'copying',
                    token: duplicateToken,
                    createdAt: duplicateCreatedAt,
                  })
                )
                await runWithProjectFilesystemMutationLock(async () => {
                  let snapshotFailed = false
                  let snapshotError: unknown
                  await runCloudSyncWriteTransaction(project.path, async () => {
                    if (
                      input.context.app.project &&
                      fsZds.resolve(input.context.app.project.path) ===
                        fsZds.resolve(project.path)
                    ) {
                      const flushes = Array.from(
                        input.context.app.project.editors.values(),
                        (editor) =>
                          Promise.resolve().then(() =>
                            editor.flushPendingWriteToFile({
                              mutationLockAlreadyHeld: true,
                            })
                          )
                      )
                      flushes.push(
                        Promise.resolve().then(() =>
                          flushActiveTextFileWrite({
                            mutationLockAlreadyHeld: true,
                          })
                        )
                      )
                      const rejectedFlushes = (
                        await Promise.allSettled(flushes)
                      ).filter(
                        (result): result is PromiseRejectedResult =>
                          result.status === 'rejected'
                      )
                      if (rejectedFlushes.length > 0) {
                        snapshotFailed = true
                        snapshotError =
                          rejectedFlushes.length === 1
                            ? rejectedFlushes[0].reason
                            : new AggregateError(
                                rejectedFlushes.map((result) => result.reason),
                                'Failed to flush project edits before duplicating'
                              )
                      }
                    }
                    if (!snapshotFailed) {
                      try {
                        await copyProjectDirectoryContents(
                          project.path,
                          stagingPath
                        )
                      } catch (error) {
                        snapshotFailed = true
                        snapshotError = error
                      }
                    }
                  })
                  if (snapshotFailed) {
                    return Promise.reject(snapshotError)
                  }
                })

                let duplicateName = ''
                const rejectedDuplicateNames = new Set<string>()
                await runWithProjectDirectoryNamespaceLock(
                  projectDirectoryPath,
                  async () => {
                    while (ownsStagingProject) {
                      duplicateName = await getUniqueDuplicateProjectName({
                        context: input.context,
                        requestedProjectName,
                        fallbackProjectName: project.name,
                        projectDirectoryPath,
                        rejectedNames: rejectedDuplicateNames,
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

                      const publicationEvidence =
                        createDuplicatePublicationEvidence({
                          token: duplicateToken,
                          targetName: duplicateName,
                          createdAt: duplicateCreatedAt,
                        })
                      const reservationPath = fsZds.join(
                        projectDirectoryPath,
                        publicationEvidence.reservationFileName
                      )

                      let published = false
                      try {
                        await runWithProjectFilesystemMutationLock(() =>
                          runCloudSyncWriteTransaction(
                            targetPath,
                            async () => {
                              await fsZds.publishDirectory(
                                stagingPath,
                                targetPath,
                                publicationEvidence
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
                                await finalizeDuplicateTargetMarker(
                                  fsZds.join(
                                    targetPath,
                                    DUPLICATE_IN_PROGRESS_FILE_NAME
                                  ),
                                  {
                                    kind: 'target',
                                    phase: 'publishing',
                                    token: duplicateToken,
                                  }
                                )
                                await finalizeDuplicateReservation(
                                  reservationPath,
                                  {
                                    kind: 'reservation',
                                    phase: 'prepared',
                                    token: duplicateToken,
                                  }
                                )
                              },
                            }
                          )
                        )
                      } catch (error) {
                        // A destination can appear after name selection. Its
                        // contents are never ours, so preserve it and retry
                        // with a freshly selected bounded name.
                        if (
                          !published &&
                          isPublishDirectoryDestinationExists(error)
                        ) {
                          rejectedDuplicateNames.add(duplicateName)
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

        const projectDirectoryPath = fsZds.resolve(
          input.context.projectDirectoryPath
        )
        return runWithProjectDirectoryNamespaceLock(projectDirectoryPath, () =>
          runWithProjectFilesystemMutationLock(async () => {
            const requestedProjectName = input.requestedProjectName
            const projectName = input.projectName
            const project = folders.find((p) => p.name === projectName)
            const existingDisplayName = project
              ? getProjectDisplayName(project)
              : projectName
            if (project?.cloudProjectId) {
              const currentProjectPath = fsZds.join(
                projectDirectoryPath,
                projectName
              )
              await writeProjectTitleToProjectTomlUnlocked(
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
              const nextIndex = getNextProjectIndex(
                requestedProjectName,
                folders
              )
              newProjectName = interpolateProjectNameWithIndex(
                requestedProjectName,
                nextIndex
              )
            }

            // Toast an error if the project name is taken
            if (folders.find((p) => p.name === newProjectName)) {
              return Promise.reject(
                new Error(
                  `Project with name "${newProjectName}" already exists`
                )
              )
            }

            await renameProjectDirectory(
              fsZds.join(projectDirectoryPath, projectName),
              newProjectName
            )

            return {
              message: `Successfully renamed "${existingDisplayName}" to "${newProjectName}"`,
              oldName: projectName,
              newName: newProjectName,
              redirect: input.redirect,
            }
          })
        )
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

        await runWithProjectFilesystemMutationLock(
          () =>
            fsZds.rm(
              fsZds.join(
                input.context.projectDirectoryPath,
                input.requestedProjectName
              ),
              {
                recursive: true,
              }
            ),
          { ifAvailable: true, mode: 'shared' }
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

      const projectDirectoryPath = fsZds.resolve(
        input.context.projectDirectoryPath
      )
      return runWithProjectDirectoryNamespaceLock(projectDirectoryPath, () =>
        runWithProjectFilesystemMutationLock(async () => {
          let newProjectName = requestedProjectName

          if (
            !newProjectName ||
            doesProjectNameNeedInterpolated(newProjectName)
          ) {
            newProjectName = await getUniqueProjectNameForCreate({
              context: input.context,
              requestedProjectName:
                newProjectName || input.context.defaultProjectFolderName,
              projectDirectoryPath,
            })
          }

          const wasmInstance = await input.app.wasmPromise

          const baseDir = fsZds.join(projectDirectoryPath, newProjectName)
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
            projectDirectoryPath
          )

          return {
            message: 'Successfully created file.',
            fileName: newFileName,
            projectName: newProjectName,
            subRoute: input.requestedSubRoute || '',
          }
        })
      )
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
        await runWithProjectFilesystemMutationLock(() => fsZds.rm(path), {
          ifAvailable: true,
          mode: 'shared',
        })
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

      await runWithProjectFilesystemMutationLock(
        () => fsZds.rename(oldPath, newPath),
        { ifAvailable: true, mode: 'shared' }
      )

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

      await runWithProjectFilesystemMutationLock(
        () => fsZds.rename(oldPath, newPath),
        { ifAvailable: true, mode: 'shared' }
      )

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
        await runWithProjectFilesystemMutationLock(
          () => fsZds.rm(input.requestedPath, { recursive: true }),
          { ifAvailable: true, mode: 'shared' }
        )
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
        await runWithProjectFilesystemMutationLock(
          () => fsZds.writeFile(input.requestedAbsolutePath, fileContents),
          { ifAvailable: true, mode: 'shared' }
        )
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
        await runWithProjectFilesystemMutationLock(
          () =>
            fsZds.mkdir(input.requestedAbsolutePath, {
              recursive: true,
            }),
          { ifAvailable: true, mode: 'shared' }
        )
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
        await runWithProjectFilesystemMutationLock(
          async () =>
            fsZds.cp(input.src, input.target, {
              recursive: true,
              force: false,
            }),
          { ifAvailable: true, mode: 'shared' }
        )
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
        await runWithProjectFilesystemMutationLock(
          () =>
            moveRecursivePath({
              src: input.src,
              target: input.target,
            }),
          { ifAvailable: true, mode: 'shared' }
        )
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
