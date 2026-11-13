import { posix } from '@chainner/node-path'
import { createStagedProject } from '@src/lib/fileSystem/createStagedProject'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))

let memory: ReturnType<typeof createMemoryFileSystem>
let runtime: ReturnType<typeof createFileOperationsRuntime>

beforeEach(async () => {
  memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
  await memory.mkdir('/projects/source', { recursive: true })
  await memory.writeFile('/projects/source/main.kcl', new Uint8Array([1, 2]))
  runtime = createFileOperationsRuntime(memory)
})
afterEach(async () => runtime.dispose())

it('keeps the destination absent until population finishes, then publishes its bytes', async () => {
  const ready = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const creating = createStagedProject(
    runtime.operations,
    '/projects/copy',
    async (temporary) => {
      await runtime.operations.copy('/projects/source', temporary)
      ready.resolve(undefined)
      await release.promise
    }
  )
  try {
    await ready.promise
    expect(await runtime.operations.exists('/projects/copy')).toBe(false)
  } finally {
    release.resolve(undefined)
    await creating
  }
  expect(await memory.readFile('/projects/copy/main.kcl')).toEqual(
    new Uint8Array([1, 2])
  )
  expect(await memory.readdir('/projects')).toEqual(['source', 'copy'])
})

it.each(['populate', 'rename'] as const)(
  'cleans up after %s failure without changing the source',
  async (stage) => {
    const failure = new Error('Destination failed')
    const operations =
      stage === 'rename'
        ? { ...runtime.operations, rename: vi.fn().mockRejectedValue(failure) }
        : runtime.operations
    await expect(
      createStagedProject(operations, '/projects/copy', async (temporary) => {
        await operations.copy('/projects/source', temporary)
        if (stage === 'populate') return Promise.reject(failure)
      })
    ).rejects.toBe(failure)
    expect(await memory.readdir('/projects')).toEqual(['source'])
    expect(await memory.readFile('/projects/source/main.kcl')).toEqual(
      new Uint8Array([1, 2])
    )
  }
)

it('does not remove a directory it failed to create', async () => {
  const failure = new Error('Creation failed')
  const remove = vi.fn()
  await expect(
    createStagedProject(
      {
        ...runtime.operations,
        createDirectory: vi.fn().mockRejectedValue(failure),
        remove,
      },
      '/projects/copy',
      vi.fn()
    )
  ).rejects.toBe(failure)
  expect(remove).not.toHaveBeenCalled()
})
