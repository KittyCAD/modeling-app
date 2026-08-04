import {
  holdOpenProjectDirectoryLock,
  withProjectDirectoryWriteLock,
} from '@src/lib/projectDirectoryLock'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('prevents a directory write while another window has the project open', async () => {
  let sharedLockHeld = false
  const lockManager = {
    request: async <T>(
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => T | PromiseLike<T>
    ) => {
      const mode = options.mode ?? 'exclusive'
      const lock = { mode, name } as Lock
      if (mode === 'shared') {
        sharedLockHeld = true
        try {
          return await callback(lock)
        } finally {
          sharedLockHeld = false
        }
      }

      return callback(sharedLockHeld && options.ifAvailable ? null : lock)
    },
  } as LockManager
  vi.stubGlobal('navigator', { locks: lockManager })

  const releaseOpenProjectLock =
    holdOpenProjectDirectoryLock('/projects/bracket')
  const operation = vi.fn(async () => 'renamed')

  await expect(
    withProjectDirectoryWriteLock('/projects/bracket', operation)
  ).resolves.toBeUndefined()
  expect(operation).not.toHaveBeenCalled()

  releaseOpenProjectLock()
  await vi.waitFor(() => expect(sharedLockHeld).toBe(false))
  await expect(
    withProjectDirectoryWriteLock('/projects/bracket', operation)
  ).resolves.toBe('renamed')
})
