import {
  isExcludedProjectPath,
  normalizeRelativePath,
} from '@src/lib/fs-zds/cloud/paths'

import { normalizeProjectArchiveFiles } from '@src/lib/fs-zds/cloud/archive'

import type { ProjectArchiveFile } from '@src/lib/fs-zds/cloud/types'

import fsZds from '@src/lib/fs-zds'

import {
  appendGitignoreForDirectoryWithFs,
  createInitialGitignoreStackWithFs,
  fileOperationsGitignoreFs,
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'

import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/**
 * Collects files from `projectRoot` for a cloud upload archive. The walk uses
 * coordinated reads, skips internal metadata and version-control paths,
 * respects `.gitignore` rules, and returns normalized files in stable order.
 */
export async function collectProjectFilesForUpload({
  fileOperations,
  projectRoot,
}: {
  fileOperations: FileOperationsRegistryService
  projectRoot: string
}) {
  const files: ProjectArchiveFile[] = []
  const gitignoreFs = fileOperationsGitignoreFs(fileOperations)

  const walk = async (
    currentPath: string,
    gitignoreStack: GitignoreStackEntry[]
  ) => {
    const entries = await fileOperations.readDirectory(currentPath)
    for (const entry of entries) {
      if (isExcludedProjectPath(entry)) {
        continue
      }

      const absolutePath = fsZds.join(currentPath, entry)
      const relativePath = normalizeRelativePath(
        fsZds.relative(projectRoot, absolutePath)
      )
      const isDirectory =
        (await fileOperations.stat(absolutePath)).kind === 'directory'
      if (isPathIgnoredByGitignore(gitignoreStack, relativePath, isDirectory)) {
        continue
      }

      if (isDirectory) {
        const childGitignoreStack = await appendGitignoreForDirectoryWithFs(
          gitignoreFs,
          gitignoreStack,
          absolutePath,
          projectRoot
        )
        await walk(absolutePath, childGitignoreStack)
        continue
      }

      const data = await fileOperations.readFile(absolutePath)
      files.push({
        relativePath,
        data: Uint8Array.from(data),
      })
    }
  }

  const gitignoreStack = await createInitialGitignoreStackWithFs(
    gitignoreFs,
    projectRoot
  )
  await walk(projectRoot, gitignoreStack)
  return normalizeProjectArchiveFiles(files).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  )
}
