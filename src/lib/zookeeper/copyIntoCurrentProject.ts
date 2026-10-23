import type { KclManager } from '@src/lang/KclManager'
import { PROJECT_IMAGE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import type { ZDSProject } from '@src/lib/projectSession/project'
import { webSafePathSplit } from '@src/lib/pathUtils'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export class CurrentProjectCopyError extends Error {}

type SourceFile = { path: string; data: Uint8Array }

function isBlankMain(code: string) {
  return /^\s*(?:@settings\([^)]*\)\s*)?$/.test(code)
}

function decodeKcl(data: Uint8Array) {
  try {
    const code = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (!code.includes('\0')) {
      return code
    }
  } catch {}
  return undefined
}

export async function copyLibraryFilesIntoCurrentProject({
  files,
  sourceTitle,
  sourcePath,
  fileOperations,
  project,
  kclManager,
  isCurrent,
}: {
  files: readonly SourceFile[]
  sourceTitle: string
  sourcePath?: string
  fileOperations: FileOperationsRegistryService
  project: ZDSProject
  kclManager: KclManager
  isCurrent: () => boolean
}): Promise<{
  title: string
  source_title: string
  destination: 'current_project'
}> {
  const projectPath = project.path
  const mainPath = fsZds.join(projectPath, 'main.kcl')
  if (!isCurrent() || kclManager.path !== mainPath) {
    return Promise.reject(
      new CurrentProjectCopyError('Open main.kcl in the current project first.')
    )
  }
  if (
    sourcePath &&
    (await fileOperations.realpath(sourcePath)) ===
      (await fileOperations.realpath(projectPath))
  ) {
    return Promise.reject(
      new CurrentProjectCopyError('The source is already the current project.')
    )
  }
  if (!(await kclManager.flushWriteToFile()) || !isCurrent()) {
    return Promise.reject(
      new CurrentProjectCopyError('The current project changed. Try again.')
    )
  }
  const originalMain = kclManager.code
  const diskMain = new TextDecoder().decode(
    await fileOperations.readFile(mainPath)
  )
  const rootEntries = await fileOperations.readDirectory(projectPath)
  if (
    !isBlankMain(originalMain) ||
    diskMain !== originalMain ||
    rootEntries.some(
      (name) =>
        !name.startsWith('.') &&
        name !== 'main.kcl' &&
        name !== 'project.toml' &&
        name !== PROJECT_IMAGE_NAME
    )
  ) {
    return Promise.reject(
      new CurrentProjectCopyError(
        'The current project has files or model code. Use a blank project for a whole-project copy.'
      )
    )
  }

  const main = files.find((file) => file.path === 'main.kcl')
  const mainCode = main && decodeKcl(main.data)
  if (!mainCode) {
    return Promise.reject(
      new CurrentProjectCopyError(
        'The source project has no readable main.kcl.'
      )
    )
  }
  const otherKclFiles: { absolutePath: string; nextContent: string }[] = []
  for (const file of files) {
    if (file.path === 'main.kcl') {
      continue
    }
    if (file.path.toLowerCase().endsWith('.kcl')) {
      const code = decodeKcl(file.data)
      if (code === undefined) {
        return Promise.reject(
          new CurrentProjectCopyError('A source KCL file is not readable text.')
        )
      }
      otherKclFiles.push({
        absolutePath: fsZds.join(projectPath, ...webSafePathSplit(file.path)),
        nextContent: code,
      })
    }
  }
  if (!isCurrent() || kclManager.code !== originalMain) {
    return Promise.reject(
      new CurrentProjectCopyError('The current project changed. Try again.')
    )
  }

  const createdFiles: string[] = []
  const createdDirectories: string[] = []
  let mainUpdated = false
  try {
    for (const file of files) {
      if (file.path === 'main.kcl') {
        continue
      }
      if (!isCurrent() || kclManager.code !== originalMain) {
        await Promise.reject(
          new CurrentProjectCopyError('The current project changed. Try again.')
        )
      }
      const parts = webSafePathSplit(file.path)
      let directory = projectPath
      for (const part of parts.slice(0, -1)) {
        directory = fsZds.join(directory, part)
        if (!(await fileOperations.exists(directory))) {
          await fileOperations.createDirectory(directory)
          createdDirectories.push(directory)
        }
      }
      const absolutePath = fsZds.join(projectPath, ...parts)
      await fileOperations.createFile(absolutePath, file.data)
      createdFiles.push(absolutePath)
    }
    if (!isCurrent() || kclManager.code !== originalMain) {
      await Promise.reject(
        new CurrentProjectCopyError('The current project changed. Try again.')
      )
    }
    await project.syncReplayedFilesToRust(otherKclFiles)
    kclManager.updateCodeEditor(mainCode, {
      shouldAddToHistory: false,
      shouldClearHistory: true,
      shouldExecute: true,
      shouldResetCamera: true,
      shouldWriteToDisk: true,
    })
    mainUpdated = true
    if (!(await kclManager.flushWriteToFile()) || !isCurrent()) {
      await Promise.reject(
        new CurrentProjectCopyError('The current project changed. Try again.')
      )
    }
    return {
      title: project.projectIORefSignal.value.title ?? project.name,
      source_title: sourceTitle,
      destination: 'current_project',
    }
  } catch (error) {
    let rollbackFailed = false
    if (mainUpdated) {
      if (
        kclManager.path === mainPath &&
        isCurrent() &&
        kclManager.code === mainCode
      ) {
        kclManager.updateCodeEditor(originalMain, {
          shouldAddToHistory: false,
          shouldClearHistory: true,
          shouldExecute: true,
          shouldWriteToDisk: true,
        })
        rollbackFailed =
          !(await kclManager.flushWriteToFile().catch(() => false)) ||
          rollbackFailed
      } else {
        const currentDisk = await fileOperations
          .readFile(mainPath)
          .catch(() => undefined)
        if (
          !currentDisk ||
          new TextDecoder().decode(currentDisk) !== mainCode
        ) {
          rollbackFailed = true
        } else {
          const restored = await fileOperations
            .writeFile(mainPath, originalMain)
            .then(
              () => true,
              () => false
            )
          rollbackFailed = !restored || rollbackFailed
        }
      }
    }
    const fileRollbacks = await Promise.allSettled(
      createdFiles.reverse().map((path) => fileOperations.remove(path))
    )
    rollbackFailed =
      fileRollbacks.some((result) => result.status === 'rejected') ||
      rollbackFailed
    await project.syncReplayedFilesToRust(
      otherKclFiles.map(({ absolutePath }) => ({
        absolutePath,
        nextContent: null,
      }))
    )
    for (const path of createdDirectories.reverse()) {
      const removed = await fileOperations.remove(path).then(
        () => true,
        () => false
      )
      rollbackFailed = !removed || rollbackFailed
    }
    if (rollbackFailed) {
      return Promise.reject(
        new CurrentProjectCopyError(
          'The copy failed and some files could not be restored. Inspect the current project.'
        )
      )
    }
    return Promise.reject(
      error instanceof CurrentProjectCopyError
        ? error
        : new CurrentProjectCopyError(
            'Could not copy files into the current project.'
          )
    )
  }
}
