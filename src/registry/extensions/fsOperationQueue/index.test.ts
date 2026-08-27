import { Registry } from '@kittycad/registry'
import { fsOperationQueue } from '@src/registry/contracts/fsOperationQueue'
import fsOperationQueueRegistryItem from '@src/registry/extensions/fsOperationQueue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fsZdsMocks = vi.hoisted(() => ({
  cp: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: fsZdsMocks,
}))

function createDeferred<Result>() {
  let resolve!: (value: Result | PromiseLike<Result>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Result>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('fs operation queue extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.clearAllMocks()
  })

  it('serializes queued filesystem operations', async () => {
    registry = new Registry()
    registry.configure([fsOperationQueueRegistryItem])
    const queue = registry.get(fsOperationQueue)
    const firstGate = createDeferred<string>()
    const order: string[] = []

    const first = queue.run(
      {
        kind: 'first',
        targetPath: '/project/first.kcl',
      },
      async () => {
        order.push('first:start')
        const result = await firstGate.promise
        order.push('first:end')
        return result
      }
    )
    const second = queue.run(
      {
        kind: 'second',
        targetPath: '/project/second.kcl',
      },
      async () => {
        order.push('second:start')
        return 'second result'
      }
    )

    await flushMicrotasks()

    expect(order).toEqual(['first:start'])
    expect(queue.state.value.pending).toBe(true)
    expect(queue.state.value.current).toMatchObject({
      kind: 'first',
      status: 'running',
      targetPath: '/project/first.kcl',
    })
    expect(queue.state.value.queued).toEqual([
      expect.objectContaining({
        kind: 'second',
        status: 'queued',
        targetPath: '/project/second.kcl',
      }),
    ])

    firstGate.resolve('first result')

    await expect(first).resolves.toBe('first result')
    await expect(second).resolves.toBe('second result')
    await queue.waitForIdle()

    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
    expect(queue.state.value.pending).toBe(false)
    expect(queue.state.value.current).toBeUndefined()
    expect(queue.state.value.queued).toEqual([])
    expect(queue.getJournal()).toEqual([
      expect.objectContaining({ kind: 'first', status: 'completed' }),
      expect.objectContaining({ kind: 'second', status: 'completed' }),
    ])
  })

  it('keeps batch operations exclusive from top-level queue work', async () => {
    registry = new Registry()
    registry.configure([fsOperationQueueRegistryItem])
    const queue = registry.get(fsOperationQueue)
    const mkdirGate = createDeferred<void>()
    const order: string[] = []

    fsZdsMocks.mkdir.mockImplementationOnce(async () => {
      order.push('batch:mkdir:start')
      await mkdirGate.promise
      order.push('batch:mkdir:end')
    })
    fsZdsMocks.cp.mockImplementationOnce(async () => {
      order.push('batch:cp')
    })
    fsZdsMocks.writeFile.mockImplementationOnce(async () => {
      order.push('external:write')
    })

    const batched = queue.batch(
      {
        kind: 'move-entry',
        sourcePath: '/project/source',
        targetPath: '/project/target',
      },
      async (batch) => {
        order.push('batch:start')
        await batch.mkdir('/project/target', { recursive: true })
        await batch.cp('/project/source', '/project/target', {
          recursive: true,
        })
        order.push('batch:end')
      }
    )
    const external = queue.writeFile(
      '/project/external.kcl',
      new Uint8Array([1])
    )

    await flushMicrotasks()

    expect(order).toEqual(['batch:start', 'batch:mkdir:start'])
    expect(queue.state.value.current).toMatchObject({
      kind: 'move-entry',
      status: 'running',
    })
    expect(queue.state.value.queued).toEqual([
      expect.objectContaining({ kind: 'write-file', status: 'queued' }),
    ])

    mkdirGate.resolve()
    await batched
    await external

    expect(order).toEqual([
      'batch:start',
      'batch:mkdir:start',
      'batch:mkdir:end',
      'batch:cp',
      'batch:end',
      'external:write',
    ])
    const journal = queue.getJournal()
    const batchRecord = journal.find((record) => record.kind === 'move-entry')
    expect(batchRecord).toMatchObject({ status: 'completed' })
    expect(
      journal.filter((record) => record.parentId === batchRecord?.id)
    ).toEqual([
      expect.objectContaining({ kind: 'mkdir', status: 'completed' }),
      expect.objectContaining({ kind: 'cp', status: 'completed' }),
    ])
  })

  it('serializes concurrently requested operations within a batch', async () => {
    registry = new Registry()
    registry.configure([fsOperationQueueRegistryItem])
    const queue = registry.get(fsOperationQueue)
    const firstGate = createDeferred<void>()
    const order: string[] = []

    await queue.batch({ kind: 'parallel-request' }, async (batch) => {
      const first = batch.run({ kind: 'first-child' }, async () => {
        order.push('first:start')
        await firstGate.promise
        order.push('first:end')
      })
      const second = batch.run({ kind: 'second-child' }, async () => {
        order.push('second:start')
      })

      await flushMicrotasks()
      expect(order).toEqual(['first:start'])
      firstGate.resolve()
      await Promise.all([first, second])
    })

    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('records a caught child failure while allowing batch fallback work', async () => {
    registry = new Registry()
    registry.configure([fsOperationQueueRegistryItem])
    const queue = registry.get(fsOperationQueue)
    const renameError = new Error('cross-device rename')
    fsZdsMocks.rename.mockRejectedValueOnce(renameError)
    fsZdsMocks.cp.mockResolvedValueOnce(undefined)
    fsZdsMocks.rm.mockResolvedValueOnce(undefined)

    await expect(
      queue.batch({ kind: 'move-entry' }, async (batch) => {
        try {
          await batch.rename('/project/source', '/project/target')
        } catch {
          await batch.cp('/project/source', '/project/target', {
            recursive: true,
          })
          await batch.rm('/project/source', { recursive: true })
        }
        return 'moved'
      })
    ).resolves.toBe('moved')

    const journal = queue.getJournal()
    const batchRecord = journal.find((record) => record.kind === 'move-entry')
    expect(batchRecord).toMatchObject({ status: 'completed' })
    expect(
      journal.filter((record) => record.parentId === batchRecord?.id)
    ).toEqual([
      expect.objectContaining({
        kind: 'rename',
        status: 'failed',
        error: renameError,
      }),
      expect.objectContaining({ kind: 'cp', status: 'completed' }),
      expect.objectContaining({ kind: 'rm', status: 'completed' }),
    ])
  })

  it('keeps draining after a queued operation fails', async () => {
    registry = new Registry()
    registry.configure([fsOperationQueueRegistryItem])
    const queue = registry.get(fsOperationQueue)
    const error = new Error('write failed')
    const order: string[] = []

    const failed = queue.run(
      {
        kind: 'write-file',
        targetPath: '/project/main.kcl',
      },
      async () => {
        order.push('failed:start')
        return Promise.reject(error)
      }
    )
    const completed = queue.run(
      {
        kind: 'rm',
        targetPath: '/project/old.kcl',
      },
      async () => {
        order.push('completed:start')
        return 'done'
      }
    )

    await expect(failed).rejects.toBe(error)
    await expect(completed).resolves.toBe('done')
    await queue.waitForIdle()

    expect(order).toEqual(['failed:start', 'completed:start'])
    expect(queue.state.value.pending).toBe(false)
    expect(queue.getJournal()).toEqual([
      expect.objectContaining({
        kind: 'write-file',
        status: 'failed',
        error,
      }),
      expect.objectContaining({ kind: 'rm', status: 'completed' }),
    ])
  })

  it('wraps mutating fsZds operations', async () => {
    registry = new Registry()
    registry.configure([fsOperationQueueRegistryItem])
    const queue = registry.get(fsOperationQueue)
    const fileData = new Uint8Array([1, 2, 3])

    fsZdsMocks.mkdir.mockResolvedValueOnce(undefined)
    fsZdsMocks.writeFile.mockResolvedValueOnce(undefined)
    fsZdsMocks.rename.mockResolvedValueOnce(undefined)
    fsZdsMocks.cp.mockResolvedValueOnce(undefined)
    fsZdsMocks.rm.mockResolvedValueOnce(undefined)

    await queue.mkdir('/project', { recursive: true })
    await queue.writeFile('/project/main.kcl', fileData)
    await queue.rename('/project/main.kcl', '/project/renamed.kcl')
    await queue.cp('/project/renamed.kcl', '/project/copy.kcl')
    await queue.rm('/project/copy.kcl', { force: true })

    expect(fsZdsMocks.mkdir).toHaveBeenCalledWith('/project', {
      recursive: true,
    })
    expect(fsZdsMocks.writeFile).toHaveBeenCalledWith(
      '/project/main.kcl',
      fileData,
      undefined
    )
    expect(fsZdsMocks.rename).toHaveBeenCalledWith(
      '/project/main.kcl',
      '/project/renamed.kcl',
      undefined
    )
    expect(fsZdsMocks.cp).toHaveBeenCalledWith(
      '/project/renamed.kcl',
      '/project/copy.kcl',
      undefined
    )
    expect(fsZdsMocks.rm).toHaveBeenCalledWith('/project/copy.kcl', {
      force: true,
    })
    expect(queue.getJournal().map((record) => record.kind)).toEqual([
      'mkdir',
      'write-file',
      'rename',
      'cp',
      'rm',
    ])
  })
})
