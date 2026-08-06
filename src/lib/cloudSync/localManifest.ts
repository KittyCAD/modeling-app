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
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import {
  appendGitignoreForDirectoryWithFs,
  createInitialGitignoreStackWithFs,
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'

function statIsDirectory(stat: IStat) {
  return Boolean(stat.mode & 0o040000)
}

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

      if (statIsDirectory(stat)) {
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
