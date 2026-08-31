import { beforeEach, describe, expect, it } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { createProjectSession } from '@src/features/projectSession/createProjectSession'
import {
  type FakeFileSystem,
  createFakeFileSystem,
} from '@src/test/fakeFileSystem'
import type {
  ProjectLibrary,
  ProjectLibraryRealization,
} from '@src/lib/projectLibraries'

const library: ProjectLibrary = {
  id: 'directory-abc',
  title: 'Local Projects',
  path: '/projects',
  type: 'directory',
  order: 0,
}

const realization: ProjectLibraryRealization = {
  id: 'local:/projects/bracket',
  libraryIds: [library.id],
  path: '/projects/bracket',
  name: 'bracket',
  modifiedAt: 0,
  fileCount: 2,
  kclFileCount: 2,
  directoryCount: 0,
  readWriteAccess: true,
  defaultFile: 'main.kcl',
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('applyMutation', () => {
  let fileSystem: FakeFileSystem
  let session: ReturnType<typeof createProjectSession>

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'width = 10\n',
      '/projects/bracket/lid.kcl': '// lid\n',
    })
    session = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue: createFsOperationQueue(),
    })
    await settle()
  })

  const textOf = (path: string) =>
    session.bufferForPath(path)?.state.peek().doc.toString()

  it('edits an open buffer', async () => {
    await session.openFile('main.kcl')

    const result = await session.applyMutation({
      label: 'Set width to 24',
      edits: { 'main.kcl': [{ from: 0, to: 10, insert: 'width = 24' }] },
    })

    expect(result.failed).toEqual([])
    expect(result.touched.map((entry) => entry.path)).toEqual(['main.kcl'])
    expect(textOf('main.kcl')).toBe('width = 24\n')
  })

  /**
   * The whole point of taking the snapshot first: with no restore-from-snapshot
   * API, this capture is the only record of what the project looked like before,
   * so it has to predate every step.
   */
  it('captures the project before it changes anything', async () => {
    await session.openFile('main.kcl')

    const result = await session.applyMutation({
      label: 'Set width to 24',
      edits: { 'main.kcl': [{ from: 0, to: 10, insert: 'width = 24' }] },
    })

    const captured = result.before.buffers.find(
      (buffer) => buffer.content === 'width = 10\n'
    )
    expect(captured).toBeDefined()
    // And the live buffer has moved on, so the two are genuinely different.
    expect(textOf('main.kcl')).toBe('width = 24\n')
  })

  it('creates a file and opens it', async () => {
    const result = await session.applyMutation({
      label: 'Add a bracket',
      creates: [{ path: 'bracket.kcl', contents: 'depth = 2\n' }],
    })

    expect(result.created).toEqual(['bracket.kcl'])
    expect(result.failed).toEqual([])
    expect(await fileSystem.readTextFile('/projects/bracket/bracket.kcl')).toBe(
      'depth = 2\n'
    )
    // Opened, so a later edit in the same mutation could target it.
    expect(session.bufferForPath('bracket.kcl')).toBeDefined()
  })

  it('applies an edit to a file the same mutation created', async () => {
    const result = await session.applyMutation({
      label: 'Add a bracket and correct it',
      creates: [{ path: 'bracket.kcl', contents: 'depth = 2\n' }],
      edits: { 'bracket.kcl': [{ from: 0, to: 5, insert: 'width' }] },
    })

    expect(result.failed).toEqual([])
    expect(textOf('bracket.kcl')).toBe('width = 2\n')
  })

  it('deletes a file, closing its buffer', async () => {
    await session.openFile('lid.kcl')

    const result = await session.applyMutation({
      label: 'Remove the lid',
      deletes: ['lid.kcl'],
    })

    expect(result.deleted).toEqual(['lid.kcl'])
    expect(session.bufferForPath('lid.kcl')).toBeUndefined()
    expect(await fileSystem.exists('/projects/bracket/lid.kcl')).toBe(false)
  })

  /**
   * Deletes run last so an edit and a delete in one mutation cannot race, and so
   * the delete inherits `deleteEntry`'s buffers-close-before-removal ordering.
   */
  it('edits before it deletes', async () => {
    await session.openFile('main.kcl')
    await session.openFile('lid.kcl')

    const result = await session.applyMutation({
      label: 'Fold the lid into main',
      edits: { 'main.kcl': [{ from: 0, to: 10, insert: 'width = 24' }] },
      deletes: ['lid.kcl'],
    })

    expect(result.failed).toEqual([])
    expect(textOf('main.kcl')).toBe('width = 24\n')
    expect(await fileSystem.exists('/projects/bracket/lid.kcl')).toBe(false)
  })

  /**
   * Refused rather than written straight to disk: a buffer opened later would
   * hold content disagreeing with the file, and nothing would say which was meant.
   */
  it('refuses to edit a path with no open buffer', async () => {
    const result = await session.applyMutation({
      label: 'Edit something unopened',
      edits: { 'lid.kcl': [{ from: 0, to: 1, insert: 'x' }] },
    })

    expect(result.touched).toEqual([])
    expect(result.failed).toEqual([
      { path: 'lid.kcl', reason: 'No buffer is open for this path.' },
    ])
    // Untouched on disk.
    expect(await fileSystem.readTextFile('/projects/bracket/lid.kcl')).toBe(
      '// lid\n'
    )
  })

  it('refuses to create over a path that is already taken', async () => {
    const result = await session.applyMutation({
      label: 'Add a file that exists',
      creates: [{ path: 'lid.kcl', contents: 'nope\n' }],
    })

    expect(result.created).toEqual([])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].path).toBe('lid.kcl')
    // The original survives, rather than the name being quietly made unique.
    expect(await fileSystem.readTextFile('/projects/bracket/lid.kcl')).toBe(
      '// lid\n'
    )
  })

  /**
   * Partial success is a normal outcome. A create that landed plus an edit that
   * failed is a state somebody can look at and understand; a half-undone
   * filesystem is not, which is why there is deliberately no rollback.
   */
  it('reports what failed without undoing what worked', async () => {
    const result = await session.applyMutation({
      label: 'One good step and one bad one',
      creates: [{ path: 'bracket.kcl', contents: 'depth = 2\n' }],
      edits: { 'lid.kcl': [{ from: 0, to: 1, insert: 'x' }] },
    })

    expect(result.created).toEqual(['bracket.kcl'])
    expect(result.failed).toHaveLength(1)
    // The created file is still there.
    expect(await fileSystem.exists('/projects/bracket/bracket.kcl')).toBe(true)
  })

  it('attributes its transactions to the origin it was given', async () => {
    await session.openFile('main.kcl')
    const buffer = session.bufferForPath('main.kcl')
    const seen: { origin: string; author?: string }[] = []
    buffer?.onChange((change) =>
      seen.push({ origin: change.origin, author: change.author })
    )

    await session.applyMutation({
      label: 'Set width to 24',
      edits: { 'main.kcl': [{ from: 0, to: 10, insert: 'width = 24' }] },
      origin: {
        role: 'semantic',
        author: 'zookeeper:c1',
        contributionId: 't1',
      },
    })

    expect(seen).toEqual([{ origin: 'semantic', author: 'zookeeper:c1' }])
  })

  it('defaults to a project origin when none is given', async () => {
    await session.openFile('main.kcl')
    const buffer = session.bufferForPath('main.kcl')
    const seen: string[] = []
    buffer?.onChange((change) => seen.push(change.origin))

    await session.applyMutation({
      label: 'Set width to 24',
      edits: { 'main.kcl': [{ from: 0, to: 10, insert: 'width = 24' }] },
    })

    expect(seen).toEqual(['project'])
  })

  it('does nothing, successfully, for an empty mutation', async () => {
    const result = await session.applyMutation({ label: 'Nothing' })

    expect(result).toMatchObject({
      touched: [],
      created: [],
      deleted: [],
      failed: [],
    })
    expect(result.before).toBeDefined()
  })
})
