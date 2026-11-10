import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import type { Project } from '@src/lib/project'
import { posix } from '@chainner/node-path'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))

vi.mock('@src/lib/desktop', () => ({
  ensureProjectTomlTitle: vi.fn(async () => {}),
}))

vi.mock('@src/lib/projectLibraries/directoryScanner', () => ({
  readProjectsFromProjectDirectory: vi.fn(),
}))

const projectFileOperations = {
  ...testFileOperations,
  stat: async () => ({
    kind: 'directory' as const,
    device: 0,
    inode: 0,
    size: 0,
    accessedAt: 0,
    modifiedAt: 0,
    changedAt: 0,
    createdAt: 0,
  }),
}

describe('project file operations', () => {
  it.each(['/project', '/project/', '/project/.', '/project/nested/..'])(
    'rejects an edit targeting the project root %s before any mutation',
    async (rootPath) => {
      for (const contents of [null, 'replacement']) {
        const writeFile = vi.fn()
        const remove = vi.fn()
        const projects = createProjectOperations({
          operations: { ...projectFileOperations, writeFile, remove },
          wasm: vi.fn(),
        })
        await expect(
          projects.applyEdits('/project', [
            { path: '/project/keep.kcl', contents: null },
            { path: rootPath, contents },
          ])
        ).rejects.toThrow('inside its project')
        expect(writeFile).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
        expect(projects.pending.value).toBe(0)
      }
    }
  )

  beforeEach(() => vi.mocked(readProjectsFromProjectDirectory).mockReset())

  it('keeps the newest directory listing when reads finish out of order', async () => {
    const older = Promise.withResolvers<Project[]>()
    const newer = Promise.withResolvers<Project[]>()
    vi.mocked(readProjectsFromProjectDirectory)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const projects = createProjectOperations({
      operations: projectFileOperations,
      wasm: vi.fn(),
    })
    const first = projects.listProjects('/older')
    await vi.waitFor(() =>
      expect(readProjectsFromProjectDirectory).toHaveBeenCalledTimes(1)
    )
    const second = projects.listProjects('/newer')
    await vi.waitFor(() =>
      expect(readProjectsFromProjectDirectory).toHaveBeenCalledTimes(2)
    )
    expect(projects.pending.value).toBe(2)
    const newest: Project[] = []
    newer.resolve(newest)
    await second
    expect(projects.projects.value).toBe(newest)
    const stale: Project[] = []
    older.resolve(stale)
    await first
    expect(projects.projects.value).toBe(newest)
    expect(projects.pending.value).toBe(0)
  })

  it('allows a mutation to finish while directory discovery is still pending', async () => {
    const gate = Promise.withResolvers<Project[]>()
    vi.mocked(readProjectsFromProjectDirectory)
      .mockClear()
      .mockReturnValueOnce(gate.promise)
    const remove = vi.fn(async () => {})
    const projects = createProjectOperations({
      operations: { ...projectFileOperations, remove },
      wasm: vi.fn(),
    })
    const listing = projects.listProjects('/projects')
    await vi.waitFor(() =>
      expect(readProjectsFromProjectDirectory).toHaveBeenCalledOnce()
    )
    await projects.deleteProject('/projects/removed')
    expect(remove).toHaveBeenCalledWith('/projects/removed')
    expect(projects.pending.value).toBe(1)
    gate.resolve([])
    await listing
    expect(projects.pending.value).toBe(0)
  })
  it('validates all paths before writing any files', async () => {
    const writeFile = vi.fn()
    const projects = createProjectOperations({
      operations: { ...projectFileOperations, writeFile },
      wasm: vi.fn(),
    })
    await expect(
      projects.applyEdits('/project', [
        { path: '/project/main.kcl', contents: 'new' },
        { path: '/other/private.kcl', contents: null },
      ])
    ).rejects.toThrow('outside its project')
    expect(writeFile).not.toHaveBeenCalled()
    expect(projects.pending.value).toBe(0)
  })

  it('owns submitted bytes and awaits the bulk persistence boundary', async () => {
    const gate = Promise.withResolvers<undefined>()
    const events: string[] = []
    const writeFile = vi.fn(async (_path: string, bytes: unknown) => {
      events.push(`write:${String(bytes)}`)
    })
    const projects = createProjectOperations({
      operations: {
        ...projectFileOperations,
        createDirectory: async () => {},
        exists: async () => true,
        stat: async () => ({
          kind: 'directory',
          device: 0,
          inode: 0,
          size: 0,
          accessedAt: 0,
          modifiedAt: 0,
          changedAt: 0,
          createdAt: 0,
        }),
        writeFile,
        remove: async () => {
          events.push('remove')
        },
      },
      wasm: vi.fn(),
      batch: async (_root, run) => {
        await gate.promise
        const result = await run({
          ...projectFileOperations,
          createDirectory: async () => {},
          writeFile,
          remove: async () => {
            events.push('remove')
          },
        })
        events.push('commit')
        return result
      },
    })
    const bytes = new Uint8Array([1, 2])
    const completed = projects.applyEdits('/project', [
      { path: '/project/new.kcl', contents: bytes },
      { path: '/project/old.kcl', contents: null },
    ])
    bytes.fill(9)
    expect(projects.pending.value).toBe(1)
    gate.resolve(undefined)
    await completed
    expect(events).toEqual(['write:1,2', 'remove', 'commit'])
    expect(projects.pending.value).toBe(0)
  })
  it('rejects an import traversal before writing any project files', async () => {
    const writeFile = vi.fn()
    const projects = createProjectOperations({
      operations: { ...projectFileOperations, writeFile },
      wasm: vi.fn(),
    })
    await expect(
      projects.writeFiles(
        '/project',
        [
          { path: 'nested/valid.kcl', contents: '' },
          { path: '../../outside.bin', contents: new Uint8Array([1]) },
        ],
        { overwrite: true }
      )
    ).rejects.toThrow('outside its project')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('owns imported bytes and waits for the batch acknowledgement', async () => {
    const gate = Promise.withResolvers<undefined>()
    const written: Uint8Array[] = []
    const projects = createProjectOperations({
      operations: {
        ...projectFileOperations,
        exists: vi.fn(async () => true),
        writeFile: vi.fn(async (_path, contents) => {
          written.push(contents as Uint8Array)
        }),
      },
      wasm: vi.fn(),
      batch: async (_root, run) => {
        const operations = {
          ...projectFileOperations,
          createDirectory: vi.fn(async () => {}),
          exists: vi.fn(async () => true),
          writeFile: vi.fn(async (_path: string, contents: unknown) => {
            written.push(contents as Uint8Array)
          }),
        }
        await gate.promise
        return run(operations)
      },
    })
    const bytes = new Uint8Array([0, 255])
    const complete = vi.fn()
    const importing = projects
      .writeFiles('/project', [{ path: 'part.bin', contents: bytes }], {
        overwrite: true,
      })
      .then(complete)
    bytes.fill(3)
    expect(complete).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await importing
    expect(written).toEqual([new Uint8Array([0, 255])])
    expect(complete).toHaveBeenCalledOnce()
  })
})
