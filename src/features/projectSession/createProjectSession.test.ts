import { beforeEach, describe, expect, it } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import type { FileChange, FileWatcher } from '@src/contracts/fileWatcher'
import { createPersistenceCapability } from '@src/features/editorCapabilities/persistence'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'
import { createProjectSession } from '@src/features/projectSession/createProjectSession'
import { hashString } from '@src/lib/hash'
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

/** A watcher a test can fire by hand, standing in for the operating system. */
function createFakeWatcher() {
  const listeners = new Map<
    string,
    Set<(changes: readonly FileChange[]) => void>
  >()

  return {
    watcher: {
      id: 'fake',
      watch: (path, listener) => {
        const existing = listeners.get(path) ?? new Set()
        existing.add(listener)
        listeners.set(path, existing)
        return () => existing.delete(listener)
      },
    } satisfies FileWatcher,
    watching: (root: string) => (listeners.get(root)?.size ?? 0) > 0,
    emit: (root: string, changes: readonly FileChange[]) => {
      for (const listener of listeners.get(root) ?? []) listener(changes)
    },
  }
}

describe('project session', () => {
  let fileSystem: FakeFileSystem
  let session: ReturnType<typeof createProjectSession>

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
      '/projects/bracket/lid.kcl': '// lid',
      '/projects/bracket/README.md': '# bracket',
    })
    session = createProjectSession(realization, library, {
      fileSystem,
      // No capabilities: these tests are about session and buffer lifecycle,
      // not about what CodeMirror extensions do.
      capabilities: combineCapabilities([]),
      themes: [],
      queue: createFsOperationQueue(),
    })
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
    const broken = createProjectSession(realization, library, {
      fileSystem: failing,
      capabilities: combineCapabilities([]),
      themes: [],
      queue: createFsOperationQueue(),
    })
    await settle()

    expect(broken.filesState.value).toBe('error')
    expect(broken.files.value).toHaveLength(0)
  })

  it('opens a file into a buffer carrying its text and language', async () => {
    const buffer = await session.openFile('main.kcl')

    expect(buffer.name.value).toBe('main.kcl')
    expect(buffer.languageId.value).toBe('kcl')
    expect(buffer.text.value).toBe('thickness = 4')
    expect(buffer.dirty.value).toBe(false)
    expect(session.activeBuffer.value?.id).toBe(buffer.id)
  })

  it('gives the buffer an absolute resource path and the session a relative one', async () => {
    const buffer = await session.openFile('main.kcl')

    // Absolute is what capabilities act on: persistence writes this path.
    expect(buffer.path.value).toBe('/projects/bracket/main.kcl')
    // Relative is presentation: breadcrumbs, the explorer, and the URL.
    expect(session.relativePathFor(buffer)).toBe('main.kcl')
    expect(session.activeBufferPath.value).toBe('main.kcl')
  })

  it('has no relative path for a scratch buffer', () => {
    const buffer = session.openScratch()
    expect(session.relativePathFor(buffer)).toBeNull()
    expect(session.activeBufferPath.value).toBeNull()
  })

  it('assigns language from the extension', async () => {
    expect((await session.openFile('README.md')).languageId.value).toBe(
      'markdown'
    )
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

describe('buffer lifecycle', () => {
  let fileSystem: FakeFileSystem
  let session: ReturnType<typeof createProjectSession>

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
      '/projects/bracket/lid.kcl': '// lid',
    })
    session = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue: createFsOperationQueue(),
    })
    await settle()
  })

  it('looks a buffer up by id and by path', async () => {
    const buffer = await session.openFile('main.kcl')

    expect(session.buffer(buffer.id)).toBe(buffer)
    expect(session.bufferForPath('main.kcl')).toBe(buffer)
    expect(session.bufferForPath('nope.kcl')).toBeUndefined()
  })

  it('opens a scratch buffer with no path', () => {
    const buffer = session.openScratch({ languageId: 'kcl' })

    expect(buffer.path.value).toBeNull()
    expect(buffer.fileBacked.value).toBe(false)
    expect(session.activeBuffer.value?.id).toBe(buffer.id)
  })

  it('renames a buffer without changing its identity', async () => {
    const buffer = await session.openFile('main.kcl')
    session.renameBufferPath(buffer.id, 'renamed.kcl')

    expect(session.buffer(buffer.id)).toBe(buffer)
    expect(session.bufferForPath('renamed.kcl')).toBe(buffer)
    expect(buffer.pathRevision.value).toBe(1)
  })

  it('pushes the executing role into the buffer, and moves it exclusively', async () => {
    const main = await session.openFile('main.kcl')
    const lid = await session.openFile('lid.kcl')

    expect(main.executing.value).toBe(true)

    session.setExecutingBuffer(lid.id)
    // Exactly one buffer executes, and each knows whether it is the one, since
    // capabilities key off it.
    expect(main.executing.value).toBe(false)
    expect(lid.executing.value).toBe(true)
  })
})

describe('project snapshots', () => {
  let fileSystem: FakeFileSystem
  let session: ReturnType<typeof createProjectSession>

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
      '/projects/bracket/lid.kcl': '// lid',
    })
    session = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue: createFsOperationQueue(),
    })
    await settle()
  })

  it('includes unsaved edits, with no save-all first', async () => {
    const buffer = await session.openFile('main.kcl')
    buffer.dispatch({ changes: { from: 0, insert: '// draft\n' } })

    const snapshot = session.captureSnapshot()
    const captured = snapshot.buffers.find(
      (b) => b.path === '/projects/bracket/main.kcl'
    )

    // The point of reading buffers rather than the filesystem: a commit or an
    // export sees what the user is looking at.
    expect(captured?.content).toContain('// draft')
    expect(captured?.dirty).toBe(true)
    expect(fileSystem.files.get('/projects/bracket/main.kcl')).toBe(
      'thickness = 4'
    )
  })

  it('writes autosaves to the file the buffer actually came from', async () => {
    // The regression this guards: persistence used the buffer's path verbatim,
    // and the buffer held a project-relative one, so every save landed at the
    // filesystem root instead of inside the project. The dirty flag still
    // cleared, so only checking the bytes catches it.
    const persisted = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
    })
    const withPersistence = createProjectSession(realization, library, {
      fileSystem: persisted,
      capabilities: combineCapabilities([
        createPersistenceCapability({
          fileSystem: () => persisted,
          queue: () => createFsOperationQueue(),
        }),
      ]),
      themes: [],
      queue: createFsOperationQueue(),
    })
    await settle()

    const buffer = await withPersistence.openFile('main.kcl')
    buffer.dispatch({ changes: { from: 0, insert: '// saved\n' } })
    // Disposal flushes the pending write, so the debounce need not be waited on.
    withPersistence.closeBuffer(buffer.id)
    await settle()
    await settle()

    expect(persisted.files.get('/projects/bracket/main.kcl')).toContain(
      '// saved'
    )
    expect(persisted.files.has('main.kcl')).toBe(false)
  })

  it('records identity and versions for every buffer', async () => {
    const main = await session.openFile('main.kcl')
    await session.openFile('lid.kcl')

    const snapshot = session.captureSnapshot()
    expect(snapshot.buffers).toHaveLength(2)
    expect(snapshot.buffers.map((b) => b.bufferId)).toContain(main.id)
    for (const captured of snapshot.buffers) {
      expect(captured.contentId).toBeTruthy()
      expect(captured.version).toBeGreaterThanOrEqual(0)
      expect(captured.pathRevision).toBeGreaterThanOrEqual(0)
    }
  })

  it('stays consistent while the user keeps typing', async () => {
    const buffer = await session.openFile('main.kcl')
    const snapshot = session.captureSnapshot()

    buffer.dispatch({ changes: { from: 0, insert: 'typed after capture' } })

    expect(snapshot.buffers[0].content).toBe('thickness = 4')
  })

  it('gives each capture its own operation id', () => {
    expect(session.captureSnapshot().operationId).not.toBe(
      session.captureSnapshot().operationId
    )
  })
})

describe('external change reconciliation', () => {
  let fileSystem: FakeFileSystem
  let session: ReturnType<typeof createProjectSession>

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
    })
    session = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue: createFsOperationQueue(),
    })
    await settle()
  })

  it('adopts an external change into a clean buffer', async () => {
    const buffer = await session.openFile('main.kcl')

    const report = session.reconcileExternalChange({
      path: 'main.kcl',
      contents: 'thickness = 6',
    })

    expect(report?.outcome).toBe('adopted')
    expect(buffer.text.value).toBe('thickness = 6')
  })

  it('accepts an absolute path, as a watcher would report it', async () => {
    await session.openFile('main.kcl')

    const report = session.reconcileExternalChange({
      path: '/projects/bracket/main.kcl',
      contents: 'thickness = 6',
    })

    expect(report?.outcome).toBe('adopted')
  })

  it('does not overwrite unsaved edits', async () => {
    const buffer = await session.openFile('main.kcl')
    buffer.dispatch({ changes: { from: 0, insert: 'mine ' } })

    const report = session.reconcileExternalChange({
      path: 'main.kcl',
      contents: 'theirs',
    })

    expect(report?.outcome).toBe('diverged')
    expect(buffer.text.value).toBe('mine thickness = 4')
    expect(buffer.divergence.value).toBe('theirs')
  })

  it('reports nothing for a file no buffer holds', () => {
    // The caller can then treat it as a plain filesystem change.
    expect(
      session.reconcileExternalChange({ path: 'other.kcl', contents: 'x' })
    ).toBeNull()
  })
})

describe('watching for external changes', () => {
  let fileSystem: FakeFileSystem
  let queue: ReturnType<typeof createFsOperationQueue>
  let watcher: ReturnType<typeof createFakeWatcher>
  let session: ReturnType<typeof createProjectSession>

  const changed = (path: string): FileChange[] => [{ path, kind: 'changed' }]

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
    })
    queue = createFsOperationQueue()
    watcher = createFakeWatcher()
    session = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue,
      watcher: watcher.watcher,
    })
    await settle()
  })

  it('watches the project folder for as long as the session lives', () => {
    expect(watcher.watching('/projects/bracket')).toBe(true)
    session.dispose()
    expect(watcher.watching('/projects/bracket')).toBe(false)
  })

  it('folds an external edit into an open buffer', async () => {
    const buffer = await session.openFile('main.kcl')

    await fileSystem.writeTextFile(
      '/projects/bracket/main.kcl',
      'thickness = 6'
    )
    watcher.emit('/projects/bracket', changed('/projects/bracket/main.kcl'))
    await settle()

    expect(buffer.text.value).toBe('thickness = 6')
  })

  it('surfaces a conflict rather than overwriting unsaved edits', async () => {
    const buffer = await session.openFile('main.kcl')
    buffer.dispatch({ changes: { from: 0, insert: 'mine ' } })

    await fileSystem.writeTextFile('/projects/bracket/main.kcl', 'theirs')
    watcher.emit('/projects/bracket', changed('/projects/bracket/main.kcl'))
    await settle()

    expect(buffer.text.value).toBe('mine thickness = 4')
    expect(buffer.divergence.value).toBe('theirs')
  })

  it('ignores this app’s own save coming back', async () => {
    const buffer = await session.openFile('main.kcl')

    // Exactly what autosave does, followed by the user typing on before the
    // watcher fires. Without the provenance check the buffer would be told its
    // own older content is somebody else's edit, and the divergence bar would
    // appear mid-sentence.
    const saved = 'thickness = 4'
    queue.recordWrite('/projects/bracket/main.kcl', hashString(saved))
    await fileSystem.writeTextFile('/projects/bracket/main.kcl', saved)
    buffer.dispatch({ changes: { from: 0, insert: 'still typing ' } })

    watcher.emit('/projects/bracket', changed('/projects/bracket/main.kcl'))
    await settle()

    expect(buffer.divergence.value).toBeNull()
    expect(buffer.text.value).toBe('still typing thickness = 4')
  })

  it('refreshes the file list when a file appears', async () => {
    expect(session.files.value.map((file) => file.path)).toEqual(['main.kcl'])

    await fileSystem.writeTextFile('/projects/bracket/lid.kcl', '// lid')
    watcher.emit('/projects/bracket', [
      { path: '/projects/bracket/lid.kcl', kind: 'created' },
    ])
    await settle()

    expect(session.files.value.map((file) => file.path)).toContain('lid.kcl')
  })

  it('does not re-walk the project for a plain write', async () => {
    let listings = 0
    const counted = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
    })
    const readDirectory = counted.readDirectory.bind(counted)
    counted.readDirectory = (path: string) => {
      listings += 1
      return readDirectory(path)
    }

    const counting = createProjectSession(realization, library, {
      fileSystem: counted,
      capabilities: combineCapabilities([]),
      themes: [],
      queue,
      watcher: watcher.watcher,
    })
    await settle()

    const afterOpen = listings
    watcher.emit('/projects/bracket', changed('/projects/bracket/main.kcl'))
    await settle()

    // A write changes neither the tree nor anything on screen when no buffer
    // holds the file, so re-reading the whole project would be work for nothing.
    expect(listings).toBe(afterOpen)
    counting.dispose()
  })

  it('runs without a watcher, as on the web', async () => {
    const unwatched = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue,
    })
    await settle()

    const buffer = await unwatched.openFile('main.kcl')
    expect(buffer.text.value).toBe('thickness = 4')
    unwatched.dispose()
  })
})

describe('project files', () => {
  let fileSystem: FakeFileSystem
  let queue: ReturnType<typeof createFsOperationQueue>
  let session: ReturnType<typeof createProjectSession>

  const paths = () =>
    session.files.value.flatMap(function flatten(file): string[] {
      return [file.path, ...(file.children ?? []).flatMap(flatten)]
    })

  beforeEach(async () => {
    fileSystem = createFakeFileSystem({
      '/projects/bracket/main.kcl': 'thickness = 4',
      '/projects/bracket/parts/lid.kcl': '// lid',
    })
    queue = createFsOperationQueue()
    session = createProjectSession(realization, library, {
      fileSystem,
      capabilities: combineCapabilities([]),
      themes: [],
      queue,
    })
    await settle()
  })

  describe('creating', () => {
    it('adds an empty file to the tree', async () => {
      await session.createFile('base.kcl')

      expect(fileSystem.files.get('/projects/bracket/base.kcl')).toBe('')
      expect(paths()).toContain('base.kcl')
    })

    it('takes contents when the caller has some', async () => {
      await session.createFile('seed.kcl', 'width = 2')
      expect(fileSystem.files.get('/projects/bracket/seed.kcl')).toBe(
        'width = 2'
      )
    })

    it('makes the directories a path implies', async () => {
      await session.createFile('brackets/left/part.kcl')
      expect(
        fileSystem.files.get('/projects/bracket/brackets/left/part.kcl')
      ).toBe('')
    })

    it('adds a directory', async () => {
      await session.createDirectory('sketches')
      expect(paths()).toContain('sketches')
    })

    /**
     * Refused rather than made unique. The caller either typed this name, in
     * which case it needs to hear the answer, or generated it, in which case it
     * knows the siblings.
     */
    it('refuses a name already taken', async () => {
      await expect(session.createFile('main.kcl')).rejects.toThrow(
        'already exists'
      )
      await expect(session.createDirectory('parts')).rejects.toThrow(
        'already exists'
      )
      expect(fileSystem.files.get('/projects/bracket/main.kcl')).toBe(
        'thickness = 4'
      )
    })
  })

  describe('renaming', () => {
    it('moves the file', async () => {
      await session.renameEntry('main.kcl', 'body.kcl')

      expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(false)
      expect(fileSystem.files.get('/projects/bracket/body.kcl')).toBe(
        'thickness = 4'
      )
      expect(paths()).toContain('body.kcl')
    })

    it('carries an open buffer without disturbing it', async () => {
      const buffer = await session.openFile('main.kcl')
      buffer.dispatch({ changes: { from: 0, insert: '// wip\n' } })

      await session.renameEntry('main.kcl', 'body.kcl')

      // Same document: the identity, the unsaved edit and the undo history all
      // survive, which is the point of the session owning this.
      expect(session.buffer(buffer.id)).toBe(buffer)
      expect(buffer.text.value).toContain('// wip')
      expect(buffer.dirty.value).toBe(true)
      expect(session.relativePathFor(buffer)).toBe('body.kcl')
      expect(session.bufferForPath('body.kcl')).toBe(buffer)
    })

    it('carries every buffer under a renamed directory', async () => {
      const buffer = await session.openFile('parts/lid.kcl')

      await session.renameEntry('parts', 'components')

      expect(session.relativePathFor(buffer)).toBe('components/lid.kcl')
      expect(fileSystem.files.has('/projects/bracket/components/lid.kcl')).toBe(
        true
      )
    })

    it('refuses to write over something', async () => {
      await expect(
        session.renameEntry('main.kcl', 'parts/lid.kcl')
      ).rejects.toThrow('already exists')
      expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(true)
    })

    it('does nothing when the name has not changed', async () => {
      await session.renameEntry('main.kcl', 'main.kcl')
      expect(fileSystem.files.get('/projects/bracket/main.kcl')).toBe(
        'thickness = 4'
      )
    })

    it('leaves the buffer alone when the move fails', async () => {
      const buffer = await session.openFile('main.kcl')

      await expect(
        session.renameEntry('main.kcl', 'parts/lid.kcl')
      ).rejects.toThrow()

      expect(session.relativePathFor(buffer)).toBe('main.kcl')
    })
  })

  describe('deleting', () => {
    it('removes the file and drops it from the tree', async () => {
      await session.deleteEntry('main.kcl')

      expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(false)
      expect(paths()).not.toContain('main.kcl')
    })

    it('closes the buffer that held it', async () => {
      const buffer = await session.openFile('main.kcl')

      await session.deleteEntry('main.kcl')

      expect(session.buffer(buffer.id)).toBeUndefined()
      expect(session.activeBuffer.value).toBeNull()
    })

    it('closes every buffer under a deleted directory', async () => {
      const buffer = await session.openFile('parts/lid.kcl')

      await session.deleteEntry('parts')

      expect(session.buffer(buffer.id)).toBeUndefined()
      expect(fileSystem.files.has('/projects/bracket/parts/lid.kcl')).toBe(
        false
      )
    })

    /**
     * The resurrection case. Closing a buffer flushes its pending autosave, so
     * the write and the removal have to be ordered — and they are queued against
     * different paths when a whole folder goes, which is what the barrier in
     * `deleteEntry` is for.
     */
    it('does not let a pending save bring a deleted file back', async () => {
      const shared = createFsOperationQueue()
      const persisted = createFakeFileSystem({
        '/projects/bracket/parts/lid.kcl': '// lid',
      })

      // A write that takes a moment, which is the only way the ordering is
      // observable: with an instant filesystem the flush happens to land first
      // whether anything ordered it or not.
      const slow = {
        ...persisted,
        writeTextFile: async (path: string, contents: string) => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          await persisted.writeTextFile(path, contents)
        },
      }

      const withPersistence = createProjectSession(realization, library, {
        fileSystem: slow,
        capabilities: combineCapabilities([
          createPersistenceCapability({
            fileSystem: () => slow,
            // The same queue the session uses, as in the app: that shared
            // ordering is what makes the save land before the delete.
            queue: () => shared,
          }),
        ]),
        themes: [],
        queue: shared,
      })
      await settle()

      const buffer = await withPersistence.openFile('parts/lid.kcl')
      buffer.dispatch({ changes: { from: 0, insert: '// unsaved\n' } })

      await withPersistence.deleteEntry('parts')
      // Long enough for a write that was not waited for to land and undo the
      // delete.
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(persisted.files.has('/projects/bracket/parts/lid.kcl')).toBe(false)
      withPersistence.dispose()
    })
  })
})
