import { beforeEach, describe, expect, it } from 'vitest'
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
  fileCount: 3,
  kclFileCount: 2,
  directoryCount: 0,
  readWriteAccess: true,
  defaultFile: 'main.kcl',
}

/** Let the constructor's file listing settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('project session', () => {
  let fileSystem: FakeFileSystem
  let session: ReturnType<typeof createProjectSession>

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
      '/projects/bracket/lid.kcl': '// lid',
      '/projects/bracket/README.md': '# bracket',
    })
    session = createProjectSession(realization, library, fileSystem)
    await settle()
  })

  it('lists files on open, relative to the project root', () => {
    expect(session.filesState.value).toBe('ready')
    // Locale-alphabetical, which is case-insensitive: lid, main, then README.
    expect(session.files.value.map((file) => file.path)).toEqual([
      'lid.kcl',
      'main.kcl',
      'README.md',
    ])
  })

  it('reports the library it was opened through', () => {
    expect(session.library.value?.id).toBe(library.id)
  })

  it('opens no buffer, so the editor lands on its empty state', () => {
    expect(session.buffers.value).toHaveLength(0)
    expect(session.activeBuffer.value).toBeNull()
    expect(session.executingBuffer.value).toBeNull()
  })

  it('reports a listing failure instead of pretending the project is empty', async () => {
    const failing = createFakeFileSystem({})
    failing.readDirectory = async () => {
      throw new Error('unreadable')
    }
    const broken = createProjectSession(realization, library, failing)
    await settle()

    expect(broken.filesState.value).toBe('error')
    expect(broken.files.value).toHaveLength(0)
  })

  it('opens a file into a buffer carrying its text and language', async () => {
    const buffer = await session.openFile('main.kcl')

    expect(buffer.name.value).toBe('main.kcl')
    expect(buffer.languageId).toBe('kcl')
    expect(buffer.text.value).toBe('thickness = 4')
    expect(buffer.dirty.value).toBe(false)
    expect(session.activeBuffer.value?.id).toBe(buffer.id)
  })

  it('resolves buffer paths against the project folder', async () => {
    await session.openFile('main.kcl')
    // The buffer keeps the project-relative path; only reads are absolute.
    expect(session.activeBuffer.value?.path.value).toBe('main.kcl')
  })

  it('assigns language from the extension', async () => {
    expect((await session.openFile('README.md')).languageId).toBe('markdown')
  })

  it('reuses the buffer for a file already open', async () => {
    const first = await session.openFile('main.kcl')
    await session.openFile('lid.kcl')
    const again = await session.openFile('main.kcl')

    expect(again.id).toBe(first.id)
    expect(session.buffers.value).toHaveLength(2)
    expect(session.activeBuffer.value?.id).toBe(first.id)
  })

  it('mints buffer ids rather than deriving them from the path', async () => {
    const a = await session.openFile('main.kcl')
    const b = await session.openFile('lid.kcl')
    // A rename must be able to move a path without changing identity.
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toContain('main.kcl')
  })

  it('adopts the first KCL file as the executing buffer', async () => {
    const buffer = await session.openFile('main.kcl')
    expect(session.executingBuffer.value?.id).toBe(buffer.id)
  })

  it('does not let a non-KCL file become the executing buffer', async () => {
    await session.openFile('README.md')
    expect(session.executingBuffer.value).toBeNull()
  })

  it('leaves the executing buffer alone once one is chosen', async () => {
    const first = await session.openFile('main.kcl')
    await session.openFile('lid.kcl')
    expect(session.executingBuffer.value?.id).toBe(first.id)
  })

  it('keeps viewing and executing independent', async () => {
    const main = await session.openFile('main.kcl')
    const lid = await session.openFile('lid.kcl')

    session.setActiveBuffer(lid.id)
    // The whole point: reading a second file must not disturb the model.
    expect(session.activeBuffer.value?.id).toBe(lid.id)
    expect(session.executingBuffer.value?.id).toBe(main.id)

    session.setExecutingBuffer(lid.id)
    expect(session.executingBuffer.value?.id).toBe(lid.id)
    expect(session.activeBuffer.value?.id).toBe(lid.id)
  })

  it('treats a null active buffer as a normal state', async () => {
    await session.openFile('main.kcl')
    session.setActiveBuffer(null)

    expect(session.activeBuffer.value).toBeNull()
    // The buffer itself survives; only the selection cleared.
    expect(session.buffers.value).toHaveLength(1)
  })

  it('falls back to another buffer when the active one closes', async () => {
    const main = await session.openFile('main.kcl')
    const lid = await session.openFile('lid.kcl')

    session.setActiveBuffer(main.id)
    session.closeBuffer(main.id)

    expect(session.buffers.value).toHaveLength(1)
    expect(session.activeBuffer.value?.id).toBe(lid.id)
  })

  it('falls back to nothing when the last buffer closes', async () => {
    const main = await session.openFile('main.kcl')
    session.closeBuffer(main.id)

    expect(session.buffers.value).toHaveLength(0)
    expect(session.activeBuffer.value).toBeNull()
    expect(session.executingBuffer.value).toBeNull()
  })

  it('clears the executing buffer when that buffer closes', async () => {
    const main = await session.openFile('main.kcl')
    const lid = await session.openFile('lid.kcl')

    session.setActiveBuffer(lid.id)
    session.closeBuffer(main.id)

    expect(session.executingBuffer.value).toBeNull()
    expect(session.activeBuffer.value?.id).toBe(lid.id)
  })

  it('propagates a read failure to the caller', async () => {
    await expect(session.openFile('missing.kcl')).rejects.toThrow()
    expect(session.buffers.value).toHaveLength(0)
  })
})
