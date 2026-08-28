import { describe, expect, it, vi } from 'vitest'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectSession } from '@src/contracts/projectSession'
import type { ProjectLibraryRealization } from '@src/lib/projectLibraries'
import { openDefaultFile } from '@src/features/projectSession/openDefaultFile'

const realization = (
  overrides: Partial<ProjectLibraryRealization> = {}
): ProjectLibraryRealization => ({
  id: 'local:/projects/bracket',
  libraryIds: ['local'],
  path: '/projects/bracket',
  name: 'bracket',
  modifiedAt: 0,
  fileCount: 1,
  kclFileCount: 1,
  directoryCount: 0,
  readWriteAccess: true,
  ...overrides,
})

/** Only the two methods this asks about; the rest would be noise. */
const fakeFileSystem = (present: readonly string[]) =>
  ({
    exists: vi.fn(async (path: string) => present.includes(path)),
  }) as unknown as FileSystem

const fakeSession = (failOn: readonly string[] = []) => {
  const opened: string[] = []
  const session = {
    openFile: vi.fn(async (path: string) => {
      if (failOn.includes(path)) throw new Error('unreadable')
      opened.push(path)
      return {} as never
    }),
  } as unknown as ProjectSession
  return { session, opened }
}

describe('opening a project default file', () => {
  it('opens the file the project nominates', async () => {
    const { session, opened } = fakeSession()
    const fs = fakeFileSystem(['/projects/bracket/parts/base.kcl'])

    const result = await openDefaultFile(
      session,
      realization({ defaultFile: 'parts/base.kcl' }),
      fs
    )

    expect(result).toBe('parts/base.kcl')
    expect(opened).toEqual(['parts/base.kcl'])
  })

  it('falls back to main.kcl when the project nominates nothing', async () => {
    const { session, opened } = fakeSession()
    const fs = fakeFileSystem(['/projects/bracket/main.kcl'])

    expect(await openDefaultFile(session, realization(), fs)).toBe('main.kcl')
    expect(opened).toEqual(['main.kcl'])
  })

  it('falls back to main.kcl when the nominated file is gone', async () => {
    const { session, opened } = fakeSession()
    const fs = fakeFileSystem(['/projects/bracket/main.kcl'])

    const result = await openDefaultFile(
      session,
      realization({ defaultFile: 'deleted.kcl' }),
      fs
    )

    expect(result).toBe('main.kcl')
    expect(opened).toEqual(['main.kcl'])
  })

  it('opens nothing when neither resolves, which is a state and not a failure', async () => {
    const { session, opened } = fakeSession()
    const fs = fakeFileSystem([])

    expect(await openDefaultFile(session, realization(), fs)).toBeNull()
    expect(opened).toEqual([])
  })

  /*
   * The desktop main process logs a rejected IPC handler before the renderer
   * can catch it, so "no main.kcl" would report an error for behaving normally.
   */
  it('never asks for a file it has not confirmed is there', async () => {
    const { session } = fakeSession()
    const fs = fakeFileSystem([])

    await openDefaultFile(session, realization({ defaultFile: 'a.kcl' }), fs)

    expect(session.openFile).not.toHaveBeenCalled()
  })

  it('does not probe main.kcl twice when the project nominates it', async () => {
    const { session } = fakeSession()
    const fs = fakeFileSystem(['/projects/bracket/main.kcl'])

    await openDefaultFile(session, realization({ defaultFile: 'main.kcl' }), fs)

    expect(fs.exists).toHaveBeenCalledTimes(1)
  })

  /* Present but unreadable is a different answer from absent. */
  it('reports nothing opened when the only candidate cannot be read', async () => {
    const { session } = fakeSession(['main.kcl'])
    const fs = fakeFileSystem(['/projects/bracket/main.kcl'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await openDefaultFile(session, realization(), fs)).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
