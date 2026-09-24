import type { UpdateCheckResult } from 'electron-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const check = vi.hoisted(() => vi.fn<() => Promise<UpdateCheckResult | null>>())
vi.mock('electron-updater', () => ({
  autoUpdater: { checkForUpdates: check },
}))

import {
  checkForUpdates,
  configureUpdateChecks,
  resetUpdateCheck,
} from '@src/lib/desktopUpdater'

const info = {
  version: '2.0.0',
  files: [],
  releaseDate: '2026-09-22',
  path: 'update.zip',
  sha512: 'checksum',
}
const available: UpdateCheckResult = {
  isUpdateAvailable: true,
  updateInfo: info,
  versionInfo: info,
}

beforeEach(() => {
  resetUpdateCheck()
  configureUpdateChecks(vi.fn())
  check.mockReset().mockResolvedValue(available)
})

describe('checkForUpdates', () => {
  it('replays pending update state for later checks without restaging', async () => {
    const notify = vi.fn()
    configureUpdateChecks(notify)
    await checkForUpdates()
    expect(notify).not.toHaveBeenCalled()
    await checkForUpdates()
    expect(notify).toHaveBeenCalledOnce()
    expect(check).toHaveBeenCalledOnce()
  })

  it('shares a check and stays locked after download while macOS stages the app', async () => {
    const checking = Promise.withResolvers<UpdateCheckResult>()
    const download = Promise.withResolvers<string[]>()
    check.mockReturnValueOnce(checking.promise)
    const first = checkForUpdates()
    expect(checkForUpdates()).toBe(first)
    await Promise.resolve()
    expect(check).toHaveBeenCalledOnce()

    checking.resolve({ ...available, downloadPromise: download.promise })
    expect(checkForUpdates()).toBe(first)
    download.resolve([])
    await first

    // Another check here would replace Squirrel and delete its staged bundle.
    await checkForUpdates()
    await checkForUpdates()
    expect(check).toHaveBeenCalledOnce()
    resetUpdateCheck()
    await checkForUpdates()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it.each(['check', 'download'])(
    'waits for the active %s to settle after reset',
    async (phase) => {
      const checking = Promise.withResolvers<UpdateCheckResult>()
      const download = Promise.withResolvers<string[]>()
      check.mockReturnValueOnce(
        phase === 'check'
          ? checking.promise
          : Promise.resolve({ ...available, downloadPromise: download.promise })
      )
      const first = checkForUpdates()
      await Promise.resolve()

      resetUpdateCheck()
      expect(checkForUpdates()).toBe(first)
      expect(check).toHaveBeenCalledOnce()
      checking.resolve(available)
      download.resolve([])
      await first
      await checkForUpdates()
      expect(check).toHaveBeenCalledTimes(2)
    }
  )

  it.each([null, { ...available, isUpdateAvailable: false }])(
    'allows later checks when the updater returns %j',
    async (result) => {
      check.mockResolvedValueOnce(result)
      await checkForUpdates()
      await checkForUpdates()
      expect(check).toHaveBeenCalledTimes(2)
    }
  )

  it.each(['check', 'download'])(
    'observes a failed %s and permits retry',
    async (phase) => {
      const error = new Error('Update failed')
      const download = Promise.withResolvers<string[]>()
      if (phase === 'check') check.mockRejectedValueOnce(error)
      else
        check.mockResolvedValueOnce({
          ...available,
          downloadPromise: download.promise,
        })
      const completion = expect(checkForUpdates()).rejects.toBe(error)
      if (phase === 'download') download.reject(error)
      await completion

      await checkForUpdates()
      expect(check).toHaveBeenCalledTimes(2)
    }
  )
})
