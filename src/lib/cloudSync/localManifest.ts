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
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import {
  appendGitignoreForDirectoryWithFs,
  createInitialGitignoreStackWithFs,
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'

function statIsDirectory(stat: IStat) {
  return Boolean(stat.mode & fsZdsConstants.S_IFDIR)
}

/**
 * Collects the files from `projectRoot` that cloud sync would include in an
 * upload archive. The walk uses the caller's filesystem, skips cloud-sync
 * internal paths, respects `.gitignore` rules, and returns normalized files in
 * stable relative-path order.
 */
export async function collectLocalProjectFilesForCloudSync({
  localFs,
  projectRoot,
}: {
  localFs: IZooDesignStudioFS
  projectRoot: string
}) {
  const files: ProjectArchiveFile[] = []

  const walk = async (
    currentPath: string,
    gitignoreStack: GitignoreStackEntry[]
  ) => {
    const entries = await localFs.readdir(currentPath)
    for (const entry of entries) {
      if (isCloudSyncExcludedPath(entry)) {
        continue
      }

      const absolutePath = localFs.join(currentPath, entry)
      const stat = await localFs.stat(absolutePath)
      const relativePath = normalizeRelativePath(
        localFs.relative(projectRoot, absolutePath)
      )
      const isDirectory = statIsDirectory(stat)
      if (isPathIgnoredByGitignore(gitignoreStack, relativePath, isDirectory)) {
        continue
      }

      if (isDirectory) {
        const childGitignoreStack = await appendGitignoreForDirectoryWithFs(
          localFs,
          gitignoreStack,
          absolutePath,
          projectRoot
        )
        await walk(absolutePath, childGitignoreStack)
        continue
      }

      const data = await localFs.readFile(absolutePath)
      files.push({
        relativePath,
        data: Uint8Array.from(data),
      })
    }
  }

  const gitignoreStack = await createInitialGitignoreStackWithFs(
    localFs,
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
  localFs,
  projectRoot,
}: {
  baseManifest: ProjectManifest
  localFs: IZooDesignStudioFS
  projectRoot: string
}) {
  const localManifest = await collectLocalProjectFilesForCloudSync({
    localFs,
    projectRoot,
  }).then(projectManifestFromFiles)

  return projectManifestsEqual(localManifest, baseManifest)
}
