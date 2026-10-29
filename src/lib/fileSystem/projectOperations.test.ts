import { posix } from '@chainner/node-path'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))

describe('project file operations', () => {
  it('validates all paths before writing any files', async () => {
    const writeFile = vi.fn()
    const projects = createProjectOperations({
      operations: { ...testFileOperations, writeFile },
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
    expect(projects.failure.value).toBeInstanceOf(Error)
  })

  it('owns submitted bytes and awaits the bulk persistence boundary', async () => {
    const gate = Promise.withResolvers<undefined>()
    const events: string[] = []
    const writeFile = vi.fn(async (_path: string, bytes: unknown) => {
      events.push(`write:${String(bytes)}`)
    })
    const projects = createProjectOperations({
      operations: {
        ...testFileOperations,
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
        const result = await run()
        events.push('commit')
        return result
      },
    })
    const changes = vi.fn()
    const unsubscribe = projects.subscribe(changes)
    const bytes = new Uint8Array([1, 2])
    const completed = projects.applyEdits('/project', [
      { path: '/project/new.kcl', contents: bytes },
      { path: '/project/old.kcl', contents: null },
    ])
    bytes.fill(9)
    expect(projects.pending.value).toBe(1)
    expect(changes).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await completed
    expect(events).toEqual(['write:1,2', 'remove', 'commit'])
    expect(changes).toHaveBeenCalledOnce()
    expect(projects.pending.value).toBe(0)
    unsubscribe()
  })
})
