import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectFile } from '@src/contracts/projects'
import type { ProjectSession } from '@src/contracts/projectSession'
import {
  cancelDelete,
  cancelDraft,
  collapseAll,
  confirmDelete,
  directoryFor,
  draft,
  expandPath,
  expandedPaths,
  findEntry,
  namesIn,
  pendingDelete,
  requestDelete,
  resetFileExplorerState,
  selectedPath,
  startCreate,
  startRename,
  submitDraft,
  syncProject,
  toggleExpanded,
  updateDraft,
  validateEntryName,
} from '@src/features/project/areas/fileExplorerState'

const FILES: ProjectFile[] = [
  {
    path: 'parts',
    name: 'parts',
    kind: 'directory',
    children: [
      { path: 'parts/lid.kcl', name: 'lid.kcl', kind: 'file' },
      { path: 'parts/untitled.kcl', name: 'untitled.kcl', kind: 'file' },
    ],
  },
  { path: 'main.kcl', name: 'main.kcl', kind: 'file' },
]

/**
 * Only the four operations and the file list.
 *
 * The state module is not allowed to need more of the session than this: moving
 * buffers, ordering writes and refreshing the tree are the session's, and a stub
 * that had to implement them would be a sign the split had gone wrong.
 */
function createFakeSession(overrides: Partial<ProjectSession> = {}) {
  const calls = {
    createFile: [] as string[],
    createDirectory: [] as string[],
    renameEntry: [] as [string, string][],
    deleteEntry: [] as string[],
    openFile: [] as string[],
  }

  const session = {
    files: { value: FILES },
    createFile: async (path: string) => {
      calls.createFile.push(path)
    },
    createDirectory: async (path: string) => {
      calls.createDirectory.push(path)
    },
    renameEntry: async (from: string, to: string) => {
      calls.renameEntry.push([from, to])
    },
    deleteEntry: async (path: string) => {
      calls.deleteEntry.push(path)
    },
    openFile: async (path: string) => {
      calls.openFile.push(path)
      return {} as never
    },
    ...overrides,
  } as unknown as ProjectSession

  return { session, calls }
}

describe('file explorer state', () => {
  beforeEach(() => {
    resetFileExplorerState()
  })

  describe('validateEntryName', () => {
    it('accepts an ordinary name', () => {
      expect(validateEntryName('bracket.kcl')).toBeNull()
    })

    it('needs something to work with', () => {
      expect(validateEntryName('   ')).toMatch(/name is needed/)
    })

    /** A separator would make this a move, which is a different operation. */
    it('refuses a separator', () => {
      expect(validateEntryName('parts/lid.kcl')).toMatch(/slash/)
      expect(validateEntryName('parts\\lid.kcl')).toMatch(/slash/)
    })

    it('refuses the dot names', () => {
      expect(validateEntryName('.')).toMatch(/not usable/)
      expect(validateEntryName('..')).toMatch(/not usable/)
    })

    it('leaves everything else to the filesystem, which knows better', () => {
      // Reserved on Windows, fine elsewhere: refusing it here would be a guess,
      // and the failure it prevents is one the filesystem reports accurately.
      expect(validateEntryName('CON')).toBeNull()
    })
  })

  describe('reading the tree', () => {
    it('finds an entry at any depth', () => {
      expect(findEntry(FILES, 'parts/lid.kcl')?.name).toBe('lid.kcl')
      expect(findEntry(FILES, 'nope')).toBeUndefined()
    })

    it('lists the names in a directory', () => {
      expect(namesIn(FILES, '')).toEqual(['parts', 'main.kcl'])
      expect(namesIn(FILES, 'parts')).toEqual(['lid.kcl', 'untitled.kcl'])
    })

    it('acts in the directory a row implies', () => {
      // A directory acts on itself; a file acts beside itself, not inside it.
      expect(directoryFor(FILES, 'parts')).toBe('parts')
      expect(directoryFor(FILES, 'parts/lid.kcl')).toBe('parts')
      expect(directoryFor(FILES, 'main.kcl')).toBe('')
      expect(directoryFor(FILES, null)).toBe('')
      expect(directoryFor(FILES, 'gone')).toBe('')
    })
  })

  describe('expansion', () => {
    it('toggles a folder both ways', () => {
      toggleExpanded('parts')
      expect(expandedPaths.value.has('parts')).toBe(true)
      toggleExpanded('parts')
      expect(expandedPaths.value.has('parts')).toBe(false)
    })

    it('collapses everything at once', () => {
      expandPath('parts')
      expandPath('parts/inner')
      collapseAll()
      expect(expandedPaths.value.size).toBe(0)
    })

    it('treats the root as nothing to expand', () => {
      expandPath('')
      expect(expandedPaths.value.size).toBe(0)
    })
  })

  describe('starting a draft', () => {
    it('defaults to a name that is free', () => {
      startCreate('file', 'parts', namesIn(FILES, 'parts'))
      // `untitled.kcl` is taken, and the suffix goes before the extension.
      expect(draft.value).toMatchObject({
        mode: 'file',
        target: 'parts',
        value: 'untitled-2.kcl',
      })
    })

    it('opens the folder it is going into', () => {
      startCreate('directory', 'parts', [])
      expect(expandedPaths.value.has('parts')).toBe(true)
    })

    it('prefills a rename with the current name', () => {
      startRename('parts/lid.kcl')
      expect(draft.value).toMatchObject({
        mode: 'rename',
        target: 'parts/lid.kcl',
        value: 'lid.kcl',
      })
    })

    it('clears a pending delete, since only one of them can be answered', () => {
      requestDelete('main.kcl')
      startRename('main.kcl')
      expect(pendingDelete.value).toBeNull()
    })

    it('forgets the error as soon as the name changes', () => {
      startRename('main.kcl')
      draft.value = { ...draft.value!, error: 'already exists' }
      updateDraft('body.kcl')
      expect(draft.value?.error).toBeNull()
    })
  })

  describe('submitting a draft', () => {
    it('creates a file and opens it', async () => {
      const { session, calls } = createFakeSession()
      startCreate('file', 'parts', [])
      updateDraft('body.kcl')

      await submitDraft(session)

      expect(calls.createFile).toEqual(['parts/body.kcl'])
      expect(calls.openFile).toEqual(['parts/body.kcl'])
      expect(draft.value).toBeNull()
      expect(selectedPath.value).toBe('parts/body.kcl')
    })

    it('creates a folder and opens it in the tree', async () => {
      const { session, calls } = createFakeSession()
      startCreate('directory', '', [])
      updateDraft('sketches')

      await submitDraft(session)

      expect(calls.createDirectory).toEqual(['sketches'])
      expect(expandedPaths.value.has('sketches')).toBe(true)
    })

    it('renames within the same directory', async () => {
      const { session, calls } = createFakeSession()
      startRename('parts/lid.kcl')
      updateDraft('cover.kcl')

      await submitDraft(session)

      expect(calls.renameEntry).toEqual([['parts/lid.kcl', 'parts/cover.kcl']])
    })

    it('does nothing when a rename does not change the name', async () => {
      const { session, calls } = createFakeSession()
      startRename('main.kcl')

      await submitDraft(session)

      expect(calls.renameEntry).toEqual([])
      expect(draft.value).toBeNull()
    })

    it('keeps the row open when the name is refused', async () => {
      const { session, calls } = createFakeSession()
      startCreate('file', '', [])
      updateDraft('a/b.kcl')

      await submitDraft(session)

      expect(calls.createFile).toEqual([])
      expect(draft.value?.error).toMatch(/slash/)
      // Still open, with what was typed still in it.
      expect(draft.value?.value).toBe('a/b.kcl')
    })

    /**
     * The failure that matters most: the name is taken. Reporting it and
     * throwing away what was typed would be the worst of both.
     */
    it('keeps the row open and says why when the session refuses', async () => {
      const { session } = createFakeSession({
        createFile: async () => {
          throw new Error('"main.kcl" already exists.')
        },
      })
      startCreate('file', '', [])
      updateDraft('main.kcl')

      await submitDraft(session)

      expect(draft.value?.error).toBe('"main.kcl" already exists.')
      expect(draft.value?.busy).toBe(false)
    })

    it('ignores a second submit while the first is in flight', async () => {
      const created: string[] = []
      let release = () => {}
      const { session } = createFakeSession({
        createFile: async (path: string) => {
          created.push(path)
          await new Promise<void>((resolve) => {
            release = resolve
          })
        },
      })

      startCreate('file', '', [])
      updateDraft('body.kcl')

      const first = submitDraft(session)
      await submitDraft(session)
      release()
      await first

      expect(created).toEqual(['body.kcl'])
    })

    it('does nothing at all with no draft open', async () => {
      const { session, calls } = createFakeSession()
      await submitDraft(session)
      expect(calls.createFile).toEqual([])
    })

    it('is abandoned by cancelling', () => {
      startRename('main.kcl')
      cancelDraft()
      expect(draft.value).toBeNull()
    })
  })

  describe('deleting', () => {
    it('asks first, then deletes', async () => {
      const { session, calls } = createFakeSession()
      selectedPath.value = 'main.kcl'
      requestDelete('main.kcl')

      expect(calls.deleteEntry).toEqual([])

      await confirmDelete(session)

      expect(calls.deleteEntry).toEqual(['main.kcl'])
      expect(pendingDelete.value).toBeNull()
      // Selection goes with it: acting on a row that is gone is the next bug.
      expect(selectedPath.value).toBeNull()
    })

    it('is abandoned by cancelling', async () => {
      const { session, calls } = createFakeSession()
      requestDelete('main.kcl')
      cancelDelete()

      await confirmDelete(session)
      expect(calls.deleteEntry).toEqual([])
    })

    it('keeps the confirmation up when the delete fails', async () => {
      const { session } = createFakeSession({
        deleteEntry: async () => {
          throw new Error('Permission denied.')
        },
      })
      requestDelete('main.kcl')

      await confirmDelete(session)

      expect(pendingDelete.value).toMatchObject({
        path: 'main.kcl',
        error: 'Permission denied.',
        busy: false,
      })
    })

    it('closes any draft, since only one question can be answered at a time', () => {
      startRename('main.kcl')
      requestDelete('main.kcl')
      expect(draft.value).toBeNull()
    })
  })

  describe('changing project', () => {
    it('forgets the tree when the project changes', () => {
      syncProject('project-a')
      expandPath('parts')
      selectedPath.value = 'main.kcl'

      syncProject('project-b')

      expect(expandedPaths.value.size).toBe(0)
      expect(selectedPath.value).toBeNull()
    })

    /** Mounting is not a change: the panel unmounts on every toggle. */
    it('keeps the tree when the same project is reported again', () => {
      syncProject('project-c')
      expandPath('parts')

      syncProject('project-c')

      expect(expandedPaths.value.has('parts')).toBe(true)
    })
  })
})
