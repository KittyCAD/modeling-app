import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

/** Filesystem operations needed to walk a path upwards looking for git metadata. */
export type GitWorkingCopyFs = Pick<
  IZooDesignStudioFS,
  'join' | 'dirname' | 'stat'
>

const GIT_METADATA_NAME = '.git'

/** Guards against filesystem implementations whose `dirname` never settles on a root. */
const MAX_PARENT_DIRECTORIES = 64

async function getDefaultFsZds() {
  const { default: fsZds } = await import('@src/lib/fs-zds')
  return fsZds
}

export async function findGitWorkingCopyRootWithFs(
  fs: GitWorkingCopyFs,
  path: string
): Promise<string | undefined> {
  let currentPath = path

  for (let depth = 0; depth <= MAX_PARENT_DIRECTORIES; depth++) {
    if (!currentPath) {
      return undefined
    }

    try {
      // Linked worktrees and submodules use a `.git` file rather than a
      // directory, so any entry with that name marks a working copy.
      await fs.stat(fs.join(currentPath, GIT_METADATA_NAME))
      return currentPath
    } catch {
      // Not a working copy root, keep walking towards the filesystem root.
    }

    const parentPath = fs.dirname(currentPath)
    if (parentPath === currentPath) {
      return undefined
    }

    currentPath = parentPath
  }

  return undefined
}

export async function isPathInGitWorkingCopyWithFs(
  fs: GitWorkingCopyFs,
  path: string
): Promise<boolean> {
  return (await findGitWorkingCopyRootWithFs(fs, path)) !== undefined
}

export async function isPathInGitWorkingCopy(path: string): Promise<boolean> {
  return isPathInGitWorkingCopyWithFs(await getDefaultFsZds(), path)
}
