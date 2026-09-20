import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refreshPage: vi.fn().mockResolvedValue(undefined),
  reportRejection: vi.fn(),
}))

vi.mock('@src/lib/utils', () => ({ refreshPage: mocks.refreshPage }))
vi.mock('@src/lib/trap', () => ({ reportRejection: mocks.reportRejection }))

import { initializePreloadRecovery } from '@src/lib/preloadRecovery'

describe('initializePreloadRecovery', () => {
  it('saves edits and reloads at most once per revision', async () => {
    window.sessionStorage.clear()
    const flushWriteToFile = vi.fn().mockResolvedValue(true)
    initializePreloadRecovery({ flushWriteToFile })

    const firstFailure = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(firstFailure)

    expect(firstFailure.defaultPrevented).toBe(true)
    await vi.waitFor(() => {
      expect(flushWriteToFile).toHaveBeenCalledOnce()
      expect(mocks.refreshPage).toHaveBeenCalledWith('Stale app version')
    })

    const repeatedFailure = new Event('vite:preloadError', {
      cancelable: true,
    })
    window.dispatchEvent(repeatedFailure)

    expect(repeatedFailure.defaultPrevented).toBe(false)
    expect(flushWriteToFile).toHaveBeenCalledOnce()

    window.sessionStorage.clear()
    flushWriteToFile.mockResolvedValue(false)
    const unsavedFailure = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(unsavedFailure)

    await vi.waitFor(() => expect(flushWriteToFile).toHaveBeenCalledTimes(2))
    expect(mocks.refreshPage).toHaveBeenCalledOnce()
    expect(window.sessionStorage).toHaveLength(0)
  })
})
