import { runElectronSetup } from '@e2e/playwright/fixtures/electronLifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Electron fixture setup cleanup', () => {
  it('does not dispose a successful setup or leave its deadline timer active', async () => {
    const dispose = vi.fn()
    await runElectronSetup(async () => {}, dispose, 30_000, 'setup deadline')
    expect(dispose).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes a timed-out setup before propagating its original timeout', async () => {
    let rejectNavigation!: (error: Error) => void
    const navigation = new Promise<void>((_, reject) => {
      rejectNavigation = reject
    })
    let finishDisposal!: () => void
    const disposal = new Promise<void>((resolve) => {
      finishDisposal = resolve
    })
    const reportFailure = vi.fn((error: unknown) => error)
    const dispose = vi.fn(async () => {
      await disposal
      rejectNavigation(new Error('Navigation cancelled by context close'))
    })
    const outcome = runElectronSetup(
      () => navigation,
      dispose,
      30_000,
      'setup deadline'
    ).catch(reportFailure)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(dispose).toHaveBeenCalledOnce()
    expect(reportFailure).not.toHaveBeenCalled()
    finishDisposal()
    expect(await outcome).toEqual(new Error('setup deadline'))
    expect(dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes a crashed setup and preserves the crash error', async () => {
    const crash = new Error('page.reload: Page crashed')
    const dispose = vi.fn(async () => {})
    await expect(
      runElectronSetup(
        () => Promise.reject(crash),
        dispose,
        30_000,
        'setup deadline'
      )
    ).rejects.toBe(crash)
    expect(dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains both setup and cleanup errors if disposal fails', async () => {
    const setupError = new Error('setup failed')
    const cleanupError = new Error('cleanup failed')
    const result = await runElectronSetup(
      () => Promise.reject(setupError),
      () => Promise.reject(cleanupError),
      30_000,
      'setup deadline'
    ).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toEqual([
      setupError,
      cleanupError,
    ])
  })
})
