import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectFilesystemMutationBusyError,
  runWithProjectFilesystemMutationLock,
} from '@src/lib/projectDirectoryNamespaceLock'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createLockManager() {
  type PendingRequest = {
    callback: (lock: Lock | null) => unknown
    mode: LockMode
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }
  const queue: PendingRequest[] = []
  let activeExclusive = false
  let activeShared = 0

  const canAcquire = (mode: LockMode) =>
    mode === 'shared'
      ? !activeExclusive
      : !activeExclusive && activeShared === 0

  const execute = (request: PendingRequest) => {
    if (request.mode === 'shared') {
      activeShared += 1
    } else {
      activeExclusive = true
    }
    Promise.resolve(request.callback({ mode: request.mode, name: 'test' }))
      .then(request.resolve, request.reject)
      .finally(() => {
        if (request.mode === 'shared') {
          activeShared -= 1
        } else {
          activeExclusive = false
        }
        drain()
      })
  }

  const drain = () => {
    const first = queue[0]
    if (!first || !canAcquire(first.mode)) {
      return
    }
    if (first.mode === 'exclusive') {
      queue.shift()
      execute(first)
      return
    }
    while (queue[0]?.mode === 'shared' && canAcquire('shared')) {
      execute(queue.shift()!)
    }
  }

  const request = vi.fn(
    <T>(
      _name: string,
      optionsOrCallback: LockOptions | ((lock: Lock | null) => Promise<T> | T),
      maybeCallback?: (lock: Lock | null) => Promise<T> | T
    ): Promise<T> => {
      const options =
        typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
      const callback =
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : maybeCallback!
      const mode = options.mode ?? 'exclusive'
      if (options.ifAvailable && (!canAcquire(mode) || queue.length > 0)) {
        return Promise.resolve(callback(null))
      }
      return new Promise<T>((resolve, reject) => {
        queue.push({
          callback,
          mode,
          reject,
          resolve: resolve as (value: unknown) => void,
        })
        drain()
      })
    }
  )

  return { request } as unknown as LockManager
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runWithProjectFilesystemMutationLock', () => {
  it('allows shared filesystem mutations to coexist', async () => {
    vi.stubGlobal('navigator', { locks: createLockManager() })
    const releaseFirst = deferred()
    const firstStarted = deferred()
    const secondStarted = deferred()

    const first = runWithProjectFilesystemMutationLock(
      async () => {
        firstStarted.resolve()
        await releaseFirst.promise
      },
      { mode: 'shared' }
    )
    await firstStarted.promise
    const second = runWithProjectFilesystemMutationLock(
      async () => secondStarted.resolve(),
      { mode: 'shared' }
    )

    await secondStarted.promise
    releaseFirst.resolve()
    await Promise.all([first, second])
  })

  it('waits for shared mutations before entering an exclusive snapshot', async () => {
    vi.stubGlobal('navigator', { locks: createLockManager() })
    const releaseShared = deferred()
    const sharedStarted = deferred()
    let exclusiveStarted = false

    const shared = runWithProjectFilesystemMutationLock(
      async () => {
        sharedStarted.resolve()
        await releaseShared.promise
      },
      { mode: 'shared' }
    )
    await sharedStarted.promise
    const exclusive = runWithProjectFilesystemMutationLock(async () => {
      exclusiveStarted = true
    })

    await Promise.resolve()
    expect(exclusiveStarted).toBe(false)
    releaseShared.resolve()
    await Promise.all([shared, exclusive])
    expect(exclusiveStarted).toBe(true)
  })

  it('rejects a new nonblocking shared mutation behind an exclusive waiter', async () => {
    vi.stubGlobal('navigator', { locks: createLockManager() })
    const releaseShared = deferred()
    const sharedStarted = deferred()

    const shared = runWithProjectFilesystemMutationLock(
      async () => {
        sharedStarted.resolve()
        await releaseShared.promise
      },
      { mode: 'shared' }
    )
    await sharedStarted.promise
    const exclusive = runWithProjectFilesystemMutationLock(async () => {})

    await expect(
      runWithProjectFilesystemMutationLock(async () => {}, {
        ifAvailable: true,
        mode: 'shared',
      })
    ).rejects.toBeInstanceOf(ProjectFilesystemMutationBusyError)
    releaseShared.resolve()
    await Promise.all([shared, exclusive])
  })

  it('does not rerun an operation when the operation itself rejects', async () => {
    vi.stubGlobal('navigator', { locks: createLockManager() })
    const expectedError = new Error('write failed')
    const operation = vi.fn(async () => Promise.reject(expectedError))

    await expect(runWithProjectFilesystemMutationLock(operation)).rejects.toBe(
      expectedError
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
