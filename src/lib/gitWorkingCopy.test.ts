import type { GitWorkingCopyFs } from '@src/lib/gitWorkingCopy'
import {
  findGitWorkingCopyRootWithFs,
  isPathInGitWorkingCopyWithFs,
} from '@src/lib/gitWorkingCopy'
import { describe, expect, it, vi } from 'vitest'

function createFs(existingPaths: readonly string[]): GitWorkingCopyFs {
  return {
    join: (...parts) => parts.reduce((left, right) => `${left}/${right}`),
    dirname: (path) => {
      const lastSlashIndex = path.lastIndexOf('/')
      if (lastSlashIndex === -1) {
        return path
      }
      return lastSlashIndex === 0 ? '/' : path.slice(0, lastSlashIndex)
    },
    stat: vi.fn(async (path: string) => {
      if (!existingPaths.includes(path)) {
        throw new Error('ENOENT')
      }
      return {} as Awaited<ReturnType<GitWorkingCopyFs['stat']>>
    }),
  }
}

describe('findGitWorkingCopyRootWithFs', () => {
  it('finds the working copy root when the library folder is the root', async () => {
    const fs = createFs(['/home/me/cad/.git'])

    await expect(
      findGitWorkingCopyRootWithFs(fs, '/home/me/cad')
    ).resolves.toBe('/home/me/cad')
  })

  it('finds the working copy root in a parent directory', async () => {
    const fs = createFs(['/home/me/cad/.git'])

    await expect(
      findGitWorkingCopyRootWithFs(fs, '/home/me/cad/parts/brackets')
    ).resolves.toBe('/home/me/cad')
  })

  it('treats a .git file as a working copy, as linked worktrees use one', async () => {
    const fs = createFs(['/home/me/worktree/.git'])

    await expect(
      findGitWorkingCopyRootWithFs(fs, '/home/me/worktree')
    ).resolves.toBe('/home/me/worktree')
  })

  it('returns undefined when no ancestor holds git metadata', async () => {
    const fs = createFs([])

    await expect(
      findGitWorkingCopyRootWithFs(fs, '/home/me/projects')
    ).resolves.toBeUndefined()
  })

  it('stops at the filesystem root', async () => {
    const fs = createFs([])

    await expect(findGitWorkingCopyRootWithFs(fs, '/')).resolves.toBeUndefined()
    expect(fs.stat).toHaveBeenCalledTimes(1)
  })

  it('returns undefined for an empty path without touching the filesystem', async () => {
    const fs = createFs(['/.git'])

    await expect(findGitWorkingCopyRootWithFs(fs, '')).resolves.toBeUndefined()
    expect(fs.stat).not.toHaveBeenCalled()
  })
})

describe('isPathInGitWorkingCopyWithFs', () => {
  it('reports membership in a working copy', async () => {
    const fs = createFs(['/home/me/cad/.git'])

    await expect(
      isPathInGitWorkingCopyWithFs(fs, '/home/me/cad/parts')
    ).resolves.toBe(true)
    await expect(
      isPathInGitWorkingCopyWithFs(fs, '/home/other/parts')
    ).resolves.toBe(false)
  })
})
