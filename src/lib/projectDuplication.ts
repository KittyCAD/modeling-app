import { flushActiveTextFileWrite } from '@src/lib/activeTextFile'
import type { App } from '@src/lib/app'
import { getCloudSyncProjectMetadataIndex } from '@src/lib/cloudSync'
import {
  MAX_PROJECT_NAME_LENGTH,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { canReadWriteDirectory, isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import {
  getProjectDirectoryNameFromTitle,
  sanitizeProjectName,
} from '@src/lib/projectName'
import { getProjectTomlContents } from '@src/lib/projectToml'
import { prepareProjectTomlForDuplication } from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { v4 } from 'uuid'
import { waitFor } from 'xstate'

type DuplicateProjectSource = {
  directoryName: string
  displayName: string
  path: string
}

export type DuplicateProjectResult = {
  message: string
  name: string
  title: string
}

function normalizeProjectPath(projectPath: string) {
  return projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
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

async function runWithProjectTargetLock<T>(
  targetPath: string,
  operation: () => Promise<T>
) {
  const lockManager =
    typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!lockManager) {
    return operation()
  }

  return lockManager.request(
    `zds:project-target:${normalizeProjectPath(
      fsZds.resolve(targetPath)
    ).toLowerCase()}`,
    operation
  )
}

export function getDuplicateProjectBaseName(name: string, fallback: string) {
  let sanitized = sanitizeProjectName(name, fallback)
  if (fsZds.sep === '\\') {
    sanitized = Array.from(sanitized, (character) =>
      character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character)
        ? '-'
        : character
    )
      .join('')
      .replace(/[. ]+$/g, '')
  }
  const windowsDeviceName = sanitized.match(
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  )
  if (windowsDeviceName) {
    sanitized = `${windowsDeviceName[1]}-project${windowsDeviceName[2] ?? ''}`
  }
  return sanitized.startsWith('.') || !sanitized ? fallback : sanitized
}

async function getAvailableDuplicateProjectNames({
  requestedProjectTitle,
  fallbackProjectDirectoryName,
  projectDirectoryPath,
  unavailableProjectTitles,
}: {
  requestedProjectTitle: string
  fallbackProjectDirectoryName: string
  projectDirectoryPath: string
  unavailableProjectTitles: readonly string[]
}) {
  const unavailableTitles = new Set(
    unavailableProjectTitles.map((title) => title.toLowerCase())
  )
  const unavailableDirectoryNames = new Set(
    (await fsZds.readdir(projectDirectoryPath)).map((name) =>
      name.toLowerCase()
    )
  )

  const projectDirectoryPrefix = `${normalizeProjectPath(
    projectDirectoryPath
  )}/`
  const cloudProjectMetadataByPath =
    await getCloudSyncProjectMetadataIndex().catch(() => new Map())
  for (const metadataPath of cloudProjectMetadataByPath.keys()) {
    const normalizedPath = normalizeProjectPath(metadataPath)
    if (!normalizedPath.startsWith(projectDirectoryPrefix)) {
      continue
    }
    const relativePath = normalizedPath.slice(projectDirectoryPrefix.length)
    if (relativePath && !relativePath.includes('/')) {
      unavailableDirectoryNames.add(relativePath.toLowerCase())
    }
  }

  const requestedProjectDirectoryName = getDuplicateProjectBaseName(
    getProjectDirectoryNameFromTitle(
      requestedProjectTitle,
      fallbackProjectDirectoryName
    ),
    fallbackProjectDirectoryName
  )

  for (let index = 1; ; index += 1) {
    const suffix = `-${index}`
    const baseLength = MAX_PROJECT_NAME_LENGTH - suffix.length
    const title = `${requestedProjectTitle.slice(0, baseLength)}${suffix}`
    const name = `${requestedProjectDirectoryName.slice(0, baseLength)}${suffix}`
    if (
      !unavailableTitles.has(title.toLowerCase()) &&
      !unavailableDirectoryNames.has(name.toLowerCase())
    ) {
      return { name, title }
    }
  }
}

async function flushOpenProjectWrites(app: App, projectPath: string) {
  const currentProject = app.project
  if (
    !currentProject ||
    fsZds.resolve(currentProject.path) !== fsZds.resolve(projectPath)
  ) {
    return
  }

  await waitFor(app.settings.actor, (state) => state.matches('idle'))
  await Promise.all(
    Array.from(currentProject.editors.values(), (editor) =>
      editor.flushPendingWriteToFile()
    )
  )
  await flushActiveTextFileWrite({ throwOnError: true })
}

export async function duplicateProjectInDirectory({
  app,
  source,
  projectDirectoryPath,
  requestedProjectTitle,
  unavailableProjectTitles,
  wasmInstance,
}: {
  app: App
  source: DuplicateProjectSource
  projectDirectoryPath: string
  requestedProjectTitle: string
  unavailableProjectTitles: readonly string[]
  wasmInstance: ModuleType
}): Promise<DuplicateProjectResult> {
  const resolvedProjectDirectoryPath = fsZds.resolve(projectDirectoryPath)

  try {
    await fsZds.access(source.path, fsZdsConstants.R_OK | fsZdsConstants.X_OK)
  } catch {
    return Promise.reject(
      new Error(`Project "${source.displayName}" cannot be read`)
    )
  }

  const { value: canWriteProjectDirectory } = await canReadWriteDirectory(
    resolvedProjectDirectoryPath
  )
  if (!canWriteProjectDirectory) {
    return Promise.reject(
      new Error('The project directory cannot be written to.')
    )
  }

  await flushOpenProjectWrites(app, source.path)

  const projectTitle = requestedProjectTitle.trim() || source.displayName
  const duplicateProjectNames = await getAvailableDuplicateProjectNames({
    requestedProjectTitle: projectTitle,
    fallbackProjectDirectoryName: source.directoryName,
    projectDirectoryPath: resolvedProjectDirectoryPath,
    unavailableProjectTitles,
  })
  const targetPath = fsZds.resolve(
    resolvedProjectDirectoryPath,
    duplicateProjectNames.name
  )
  if (
    fsZds.dirname(targetPath) !== resolvedProjectDirectoryPath ||
    (await pathExists(targetPath))
  ) {
    return Promise.reject(
      new Error(`Project "${duplicateProjectNames.name}" already exists`)
    )
  }

  const projectToml = await getProjectTomlContents({
    projectPath: source.path,
    wasmInstance,
  })
  if (isErr(projectToml)) {
    return Promise.reject(projectToml)
  }
  const duplicatedProjectToml = prepareProjectTomlForDuplication(
    projectToml,
    duplicateProjectNames.title,
    v4()
  )
  if (isErr(duplicatedProjectToml)) {
    return Promise.reject(duplicatedProjectToml)
  }

  const stagingPath = fsZds.join(
    resolvedProjectDirectoryPath,
    `.zds-duplicate-${v4()}`
  )
  try {
    await fsZds.cp(source.path, stagingPath, {
      recursive: true,
      makeWritable: true,
      verbatimSymlinks: true,
    })
    const stagedProjectTomlPath = fsZds.join(
      stagingPath,
      PROJECT_SETTINGS_FILE_NAME
    )
    await fsZds.rm(stagedProjectTomlPath, { force: true })
    await fsZds.writeFile(
      stagedProjectTomlPath,
      new TextEncoder().encode(duplicatedProjectToml)
    )
    await runWithProjectTargetLock(targetPath, async () => {
      if (await pathExists(targetPath)) {
        return Promise.reject(
          new Error(`Project "${duplicateProjectNames.name}" already exists`)
        )
      }
      await fsZds.rename(stagingPath, targetPath)
    })
  } catch (error) {
    await fsZds
      .rm(stagingPath, { recursive: true, force: true })
      .catch(() => undefined)
    return Promise.reject(error)
  }

  return {
    message: `Successfully duplicated "${source.displayName}" as "${duplicateProjectNames.title}"`,
    name: duplicateProjectNames.name,
    title: duplicateProjectNames.title,
  }
}
