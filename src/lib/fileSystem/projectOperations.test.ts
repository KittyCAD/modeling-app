import { posix } from '@chainner/node-path'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import { createProjectForTest } from '@src/lib/projectTestUtils'
import type { Project } from '@src/lib/project'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))
// File-edit tests leave project-title policy to its own tests.
vi.mock('@src/lib/desktop', () => ({
  ensureProjectTomlTitle: vi.fn(async () => {}),
}))
vi.mock('@src/lib/projectLibraries/directoryScanner', () => ({
  readProjectsFromProjectDirectory: vi.fn(),
}))

let memory: ReturnType<typeof createMemoryFileSystem>
let runtime: ReturnType<typeof createFileOperationsRuntime>

beforeEach(async () => {
  vi.mocked(readProjectsFromProjectDirectory).mockReset()
  memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
  await memory.mkdir('/project', { recursive: true })
  await memory.mkdir('/outside', { recursive: true })
  await memory.writeFile('/project/keep.kcl', new TextEncoder().encode('keep'))
  await memory.writeFile('/outside/private.bin', new Uint8Array([42]))
  runtime = createFileOperationsRuntime(memory)
})
afterEach(async () => {
  await runtime?.dispose()
  vi.useRealTimers()
})

const invalidPaths = fc.constantFrom(
  '/project',
  '/project/',
  '/project/.',
  '/project/nested/..',
  '/outside/private.bin',
  '/project-other/private.bin',
  '/project/../outside/private.bin'
)

describe('project file operations on MemoryFS', () => {
  it('rejects an invalid path anywhere in an edit batch without changing storage', async () => {
    const projects = createProjectOperations({
      operations: runtime.operations,
      wasm: vi.fn(),
    })
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { maxLength: 5 }),
        invalidPaths,
        fc.boolean(),
        fc.nat(),
        async (contents, path, deleting, position) => {
          const edits = contents.map((contents, index) => ({
            path: `/project/new-${index}.kcl`,
            contents,
          }))
          const bad = { path, contents: deleting ? null : 'replacement' }
          const insertAt = position % (edits.length + 1)
          await expect(
            projects.applyEdits('/project', [
              { path: '/project/keep.kcl', contents: null },
              ...edits.slice(0, insertAt),
              bad,
              ...edits.slice(insertAt),
            ])
          ).rejects.toThrow(/inside its project|outside its project/)
          expect(await memory.readdir('/project')).toEqual(['keep.kcl'])
          expect(await memory.readFile('/project/keep.kcl', 'utf8')).toBe(
            'keep'
          )
          expect(await memory.readFile('/outside/private.bin')).toEqual(
            new Uint8Array([42])
          )
          expect(projects.pending.value).toBe(0)
        }
      )
    )
  })

  it('keeps the newer project listing when an older request finishes last', async () => {
    const older = Promise.withResolvers<Project[]>()
    const newer = Promise.withResolvers<Project[]>()
    vi.mocked(readProjectsFromProjectDirectory)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const projects = createProjectOperations({
      operations: runtime.operations,
      wasm: vi.fn(),
    })
    const first = projects.listProjects('/older')
    await vi.waitFor(() =>
      expect(readProjectsFromProjectDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ projectDirectoryPath: '/older' })
      )
    )
    const second = projects.listProjects('/newer')
    const newest = createProjectForTest('/newer/bracket', { name: 'bracket' })
    newer.resolve([newest])
    await second
    expect(projects.projects.value).toEqual([newest])
    older.resolve([createProjectForTest('/older/gear', { name: 'gear' })])
    await first
    expect(projects.projects.value).toEqual([newest])
    expect(projects.pending.value).toBe(0)
  })

  it('deletes a project while unrelated discovery is still pending', async () => {
    const listing = Promise.withResolvers<Project[]>()
    vi.mocked(readProjectsFromProjectDirectory).mockReturnValueOnce(
      listing.promise
    )
    const projects = createProjectOperations({
      operations: runtime.operations,
      wasm: vi.fn(),
    })
    const discovery = projects.listProjects('/outside')
    try {
      await projects.deleteProject('/project')
      await expect(memory.stat('/project')).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect(await memory.readFile('/outside/private.bin')).toEqual(
        new Uint8Array([42])
      )
      expect(projects.pending.value).toBe(1)
    } finally {
      listing.resolve([])
      await discovery
    }
    expect(projects.pending.value).toBe(0)
  })

  it.each(['edits', 'import'] as const)(
    'owns submitted %s bytes and stays pending until the batch acknowledges them',
    async (method) => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ maxLength: 256 }),
          async (contents) => {
            const start = Promise.withResolvers<undefined>()
            const written = Promise.withResolvers<undefined>()
            const acknowledged = Promise.withResolvers<undefined>()
            const projects = createProjectOperations({
              operations: runtime.operations,
              wasm: vi.fn(),
              batch: async (_root, run) => {
                await start.promise
                const result = await run(runtime.operations)
                written.resolve(undefined)
                await acknowledged.promise
                return result
              },
            })
            const submitted = new Uint8Array(contents)
            let finished = false
            const saving = (
              method === 'edits'
                ? projects.applyEdits('/project', [
                    { path: '/project/copied.bin', contents: submitted },
                  ])
                : projects.writeFiles(
                    '/project',
                    [{ path: 'copied.bin', contents: submitted }],
                    { overwrite: true }
                  )
            ).then(() => {
              finished = true
            })
            try {
              submitted.fill(9)
              start.resolve(undefined)
              await written.promise
              expect(await memory.readFile('/project/copied.bin')).toEqual(
                contents
              )
              vi.useFakeTimers()
              await vi.advanceTimersByTimeAsync(7_000)
              expect(finished).toBe(false)
              expect(projects.pending.value).toBe(1)
              acknowledged.resolve(undefined)
              await saving
              expect(finished).toBe(true)
              expect(projects.pending.value).toBe(0)
            } finally {
              vi.useRealTimers()
              start.resolve(undefined)
              acknowledged.resolve(undefined)
              await saving
            }
          }
        ),
        { numRuns: 30 }
      )
    }
  )

  it('does not delete existing files when a preceding write fails', async () => {
    const failure = new Error('Write failed')
    const projects = createProjectOperations({
      operations: {
        ...runtime.operations,
        writeFile: async () => Promise.reject(failure),
      },
      wasm: vi.fn(),
    })
    await expect(
      projects.applyEdits('/project', [
        { path: '/project/keep.kcl', contents: null },
        { path: '/project/new.kcl', contents: 'new' },
      ])
    ).rejects.toBe(failure)
    expect(await memory.readdir('/project')).toEqual(['keep.kcl'])
    expect(await memory.readFile('/project/keep.kcl', 'utf8')).toBe('keep')
    expect(projects.pending.value).toBe(0)
  })

  it('creates nested files and removes only the requested file', async () => {
    const projects = createProjectOperations({
      operations: runtime.operations,
      wasm: vi.fn(),
    })
    await projects.applyEdits('/project', [
      { path: '/project/keep.kcl', contents: null },
      { path: '/project/parts/new.kcl', contents: 'new contents' },
    ])
    await expect(memory.stat('/project/keep.kcl')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await memory.readFile('/project/parts/new.kcl', 'utf8')).toBe(
      'new contents'
    )
    expect(await memory.readFile('/outside/private.bin')).toEqual(
      new Uint8Array([42])
    )
  })

  it.each([
    '../outside/private.bin',
    '../../outside/private.bin',
    'nested/../../outside/private.bin',
  ])('rejects import traversal %s before changing any files', async (path) => {
    const projects = createProjectOperations({
      operations: runtime.operations,
      wasm: vi.fn(),
    })
    await expect(
      projects.writeFiles(
        '/project',
        [
          { path: 'nested/new.kcl', contents: 'new' },
          { path, contents: new Uint8Array([9]) },
        ],
        { overwrite: true }
      )
    ).rejects.toThrow('outside its project')
    expect(await memory.readdir('/project')).toEqual(['keep.kcl'])
    expect(await memory.readFile('/outside/private.bin')).toEqual(
      new Uint8Array([42])
    )
  })
})
