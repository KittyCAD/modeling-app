import { createProjectPoller } from '@src/lib/cloudProjects/runtime/polling'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const expectedCycle = [
  1_500, 1_500, 1_500, 1_500, 1_500, 3_000, 3_000, 3_000, 3_000, 3_000, 6_000,
  6_000, 6_000, 6_000, 6_000, 12_000, 12_000, 12_000, 12_000, 12_000,
]

function setup(random = () => 0.5) {
  const check = vi.fn(async () => false)
  const onError = vi.fn()
  const poller = createProjectPoller({ check, onError, random })
  poller.setEnabled(true)
  return { poller, check, onError }
}

describe('cloud project polling', () => {
  it('keeps a 1.5-second cadence when checking and applying an update takes half a second', async () => {
    const { check, poller } = setup()
    check.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 500))
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(check).toHaveBeenCalledTimes(3)
    poller.dispose()
  })

  it('checks immediately and cycles through 1.5/3/6/12 seconds five times each', async () => {
    const { check, poller } = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(1)
    for (const [index, delay] of [
      ...expectedCycle,
      ...expectedCycle,
      1_500,
      1_500,
    ].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(check).toHaveBeenCalledTimes(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(check).toHaveBeenCalledTimes(index + 2)
    }
    poller.dispose()
  })

  it.each([0, 0.999])(
    'jitters early intervals too (random=%s)',
    async (random) => {
      const { check, poller } = setup(() => random)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_199)
      expect(check).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(601)
      expect(check).toHaveBeenCalledTimes(2)
      poller.dispose()
    }
  )

  it.each(['local', 'remote'])(
    'restarts the entire repeated schedule after a %s change',
    async (source) => {
      const { check, poller } = setup()
      await vi.advanceTimersByTimeAsync(112_500)
      if (source === 'local') poller.activity()
      else {
        check.mockResolvedValueOnce(true)
        await vi.advanceTimersByTimeAsync(1_500)
      }
      const count = check.mock.calls.length
      for (const [index, milliseconds] of [
        ...expectedCycle,
        ...expectedCycle,
      ].entries()) {
        await vi.advanceTimersByTimeAsync(milliseconds - 1)
        expect(check).toHaveBeenCalledTimes(count + index)
        await vi.advanceTimersByTimeAsync(1)
        expect(check).toHaveBeenCalledTimes(count + index + 1)
      }
      poller.dispose()
    }
  )

  it('resets on a remote change and on local edits without letting typing postpone a check', async () => {
    const { check, poller } = setup()
    await vi.advanceTimersByTimeAsync(112_500)
    check.mockResolvedValueOnce(true)
    await vi.advanceTimersByTimeAsync(1_500)
    const count = check.mock.calls.length
    for (let second = 0; second < 3; second++) {
      poller.activity()
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(check).toHaveBeenCalledTimes(count + 1)
    await vi.advanceTimersByTimeAsync(6_000)
    poller.activity()
    const before = check.mock.calls.length
    await vi.advanceTimersByTimeAsync(1_500)
    expect(check).toHaveBeenCalledTimes(before + 1)
    poller.dispose()
  })

  it('never overlaps probes and remembers activity during an outstanding request', async () => {
    const { check, poller } = setup()
    const gate = Promise.withResolvers<boolean>()
    check.mockReturnValueOnce(gate.promise)
    await vi.advanceTimersByTimeAsync(0)
    poller.activity()
    poller.checkNow()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(check).toHaveBeenCalledOnce()
    gate.resolve(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)
    poller.dispose()
  })

  it('pauses while disabled, checks on return, and cannot restart after disposal', async () => {
    const { check, poller } = setup()
    await vi.advanceTimersByTimeAsync(0)
    poller.setEnabled(false)
    poller.activity()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(check).toHaveBeenCalledOnce()
    poller.setEnabled(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(check).toHaveBeenCalledTimes(2)
    poller.dispose()
    poller.checkNow()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure'] as const)(
    'stays paused when a seven-second probe finishes with %s while disabled',
    async (outcome) => {
      const { check, poller, onError } = setup()
      const gate = Promise.withResolvers<boolean>()
      const failure = new Error('Connection lost')
      check.mockReturnValueOnce(gate.promise)
      await vi.advanceTimersByTimeAsync(0)
      expect(check).toHaveBeenCalledOnce()
      poller.setEnabled(false)
      await vi.advanceTimersByTimeAsync(7_000)
      if (outcome === 'success') gate.resolve(false)
      else gate.reject(failure)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(check).toHaveBeenCalledOnce()
      expect(onError.mock.calls).toEqual(
        outcome === 'failure' ? [[failure]] : []
      )
      poller.setEnabled(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(check).toHaveBeenCalledTimes(2)
      poller.dispose()
    }
  )

  it('honors Retry-After even when edits, focus, or reconnect request earlier checks', async () => {
    const { check, poller, onError } = setup()
    const error = Object.assign(new Error('Rate limited'), {
      retryAfterMs: 60_000,
    })
    check.mockRejectedValueOnce(error)
    await vi.advanceTimersByTimeAsync(0)
    poller.activity()
    poller.checkNow()
    poller.setEnabled(false)
    poller.setEnabled(true)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(check).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(error)
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(2)
    poller.dispose()
  })
})
