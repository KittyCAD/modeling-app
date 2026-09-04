import {
  isCloudSyncExcludedPath,
  normalizeRelativePath,
} from '@src/lib/cloudSync/paths'
import {
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
  projectManifestsEqual,
} from '@src/lib/cloudSync/projectArchive'
import type {
  ProjectArchiveFile,
  ProjectManifest,
} from '@src/lib/cloudSync/types'
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
 * Collects the files from `projectRoot` that cloud sync would include in an
 * upload archive. The walk uses coordinated reads, skips cloud-sync internal
 * paths, respects `.gitignore` rules, and returns normalized files in stable
 * relative-path order.
 */
export async function collectLocalProjectFilesForCloudSync({
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
      if (isCloudSyncExcludedPath(entry.name)) {
        continue
      }

      const absolutePath = fsZds.join(currentPath, entry.name)
      const relativePath = normalizeRelativePath(
        fsZds.relative(projectRoot, absolutePath)
      )
      const isDirectory = entry.kind === 'directory'
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
  return normalizeProjectArchiveFilesForCloudSync(files).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  )
}

/**
 * Builds the current syncable manifest for a local project folder and compares
 * it with a stored clean base manifest. Duplicate classification uses this to
 * distinguish exact duplicate realizations from divergent local copies.
 */
export async function localProjectManifestMatchesBase({
  baseManifest,
  fileOperations,
  projectRoot,
}: {
  baseManifest: ProjectManifest
  fileOperations: FileOperationsRegistryService
  projectRoot: string
}) {
  const localManifest = await collectLocalProjectFilesForCloudSync({
    fileOperations,
    projectRoot,
  }).then(projectManifestFromFiles)

  return projectManifestsEqual(localManifest, baseManifest)
}
