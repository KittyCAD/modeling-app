import { createSystemIOOperationQueue } from '@src/lib/systemIO/operationQueue'
import type { SystemIORequestBase } from '@src/lib/systemIO/registry/contract'
import { describe, expect, it, vi } from 'vitest'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

function createTestQueue() {
  let id = 0
  let time = 0

  return createSystemIOOperationQueue<SystemIORequestBase>({
    createId: () => `operation-${++id}`,
    now: () => ++time,
  })
}

describe('systemIO operation queue', () => {
  it('serializes operations that target the same resource', async () => {
    const queue = createTestQueue()
    const first = deferred<string>()
    const second = deferred<string>()
    const firstHandler = vi.fn(() => first.promise)
    const secondHandler = vi.fn(() => second.promise)

    const firstOperation = queue.enqueue(
      {
        request: {
          type: 'test.write',
          input: { value: 1 },
        },
        resourceKey: 'project:/example',
      },
      firstHandler
    )
    const secondOperation = queue.enqueue(
      {
        request: {
          type: 'test.write',
          input: { value: 2 },
        },
        resourceKey: 'project:/example',
      },
      secondHandler
    )

    await flushPromises()

    expect(firstOperation.status.value).toBe('running')
    expect(secondOperation.status.value).toBe('queued')
    expect(firstHandler).toHaveBeenCalledTimes(1)
    expect(secondHandler).not.toHaveBeenCalled()

    first.resolve('first')
    await expect(firstOperation.result).resolves.toBe('first')
    await flushPromises()

    expect(secondOperation.status.value).toBe('running')
    expect(secondHandler).toHaveBeenCalledTimes(1)

    second.resolve('second')
    await expect(secondOperation.result).resolves.toBe('second')
  })

  it('runs operations for different resources concurrently', async () => {
    const queue = createTestQueue()
    const first = deferred<string>()
    const second = deferred<string>()
    const firstHandler = vi.fn(() => first.promise)
    const secondHandler = vi.fn(() => second.promise)

    const firstOperation = queue.enqueue(
      {
        request: {
          type: 'test.write',
          input: { value: 1 },
        },
        resourceKey: 'project:/one',
      },
      firstHandler
    )
    const secondOperation = queue.enqueue(
      {
        request: {
          type: 'test.write',
          input: { value: 2 },
        },
        resourceKey: 'project:/two',
      },
      secondHandler
    )

    await flushPromises()

    expect(firstOperation.status.value).toBe('running')
    expect(secondOperation.status.value).toBe('running')
    expect(firstHandler).toHaveBeenCalledTimes(1)
    expect(secondHandler).toHaveBeenCalledTimes(1)

    first.resolve('first')
    second.resolve('second')

    await expect(firstOperation.result).resolves.toBe('first')
    await expect(secondOperation.result).resolves.toBe('second')
  })

  it('coalesces duplicate queued operations', async () => {
    const queue = createTestQueue()
    const refresh = deferred<string>()
    const handler = vi.fn(() => refresh.promise)
    const operationRequest = {
      request: {
        type: 'projects.refresh',
        input: { projectDirectoryPath: '/projects' },
      },
      resourceKey: 'project-directory:/projects',
      coalesceKey: 'projects.refresh:/projects',
    }

    const firstOperation = queue.enqueue(operationRequest, handler)
    const secondOperation = queue.enqueue(operationRequest, handler)

    expect(secondOperation).toBe(firstOperation)

    await flushPromises()
    expect(handler).toHaveBeenCalledTimes(1)

    refresh.resolve('projects')

    await expect(firstOperation.result).resolves.toBe('projects')
  })

  it('does not coalesce into an already running operation', async () => {
    const queue = createTestQueue()
    const first = deferred<string>()
    const second = deferred<string>()
    const handler = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const operationRequest = {
      request: {
        type: 'projects.refresh',
        input: { projectDirectoryPath: '/projects' },
      },
      resourceKey: 'project-directory:/projects',
      coalesceKey: 'projects.refresh:/projects',
    }

    const firstOperation = queue.enqueue(operationRequest, handler)

    // Let the first operation start running before the next request arrives,
    // simulating a refresh triggered by a mutation that happened after the
    // first scan began.
    await flushPromises()
    expect(firstOperation.status.value).toBe('running')

    const secondOperation = queue.enqueue(operationRequest, handler)
    expect(secondOperation).not.toBe(firstOperation)
    expect(secondOperation.status.value).toBe('queued')

    first.resolve('stale')
    await expect(firstOperation.result).resolves.toBe('stale')
    await flushPromises()

    // The second operation runs fresh instead of reusing the stale in-flight
    // result, guaranteeing a re-read after the mutation.
    expect(secondOperation.status.value).toBe('running')
    expect(handler).toHaveBeenCalledTimes(2)

    second.resolve('fresh')
    await expect(secondOperation.result).resolves.toBe('fresh')
  })

  it('cancels a queued operation without running its handler', async () => {
    const queue = createTestQueue()
    const first = deferred<string>()
    const firstHandler = vi.fn(() => first.promise)
    const secondHandler = vi.fn(() => Promise.resolve('second'))

    const firstOperation = queue.enqueue(
      {
        request: {
          type: 'test.write',
          input: { value: 1 },
        },
        resourceKey: 'project:/example',
      },
      firstHandler
    )
    const secondOperation = queue.enqueue(
      {
        request: {
          type: 'test.write',
          input: { value: 2 },
        },
        resourceKey: 'project:/example',
      },
      secondHandler
    )

    await flushPromises()
    secondOperation.cancel()

    expect(secondOperation.status.value).toBe('cancelled')
    await expect(secondOperation.result).rejects.toMatchObject({
      name: 'AbortError',
    })

    first.resolve('first')
    await expect(firstOperation.result).resolves.toBe('first')
    await flushPromises()

    expect(secondHandler).not.toHaveBeenCalled()
  })
})
