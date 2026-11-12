import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProjectPoller } from '@src/lib/cloudProjects/runtime/polling'

const elapsedTime = fc.oneof(
  fc.constantFrom(0, 1, 1_499, 1_500, 1_800, 7_000, 30_000, 60_000),
  fc.integer({ min: 0, max: 90_000 })
)
const jitter = fc.array(fc.integer({ min: 0, max: 999 }), {
  minLength: 1,
  maxLength: 20,
})
const event = fc.oneof(
  fc.record({ kind: fc.constant('advance'), milliseconds: elapsedTime }),
  fc.record({
    kind: fc.constant('fail'),
    retryAfterMs: fc.integer({ min: 0, max: 90_000 }),
  }),
  fc.record({
    kind: fc.constantFrom(
      'enable',
      'disable',
      'activity',
      'checkNow',
      'unchanged',
      'changed'
    ),
  })
)

function randomSource(values: readonly number[]) {
  let index = 0
  return () => values[index++ % values.length] / 1_000
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('cloud polling under generated event sequences', () => {
  it('serializes requests, respects pause and retry deadlines, and resumes after requests settle', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(event, { maxLength: 80, size: 'medium' }),
        jitter,
        fc.boolean(),
        async (events, randomValues, failAfterDisposal) => {
          vi.useFakeTimers()
          vi.setSystemTime(0)
          let enabled = true
          let disposed = false
          let retryNotBefore = 0
          const pending: ReturnType<typeof Promise.withResolvers<boolean>>[] =
            []
          const violations: string[] = []
          const expectedErrors: Error[] = []
          const onError = vi.fn()
          const check = vi.fn(() => {
            // Record violations outside the promise: the poller catches errors
            // thrown by check, including assertion failures.
            if (!enabled || disposed) violations.push('polled while paused')
            if (pending.length) violations.push('overlapping requests')
            if (Date.now() < retryNotBefore)
              violations.push('polled before Retry-After expired')
            const gate = Promise.withResolvers<boolean>()
            pending.push(gate)
            return gate.promise
          })
          const poller = createProjectPoller({
            check,
            onError,
            random: randomSource(randomValues),
          })
          try {
            poller.setEnabled(true)
            await vi.advanceTimersByTimeAsync(0)
            expect(check).toHaveBeenCalledOnce()
            await vi.advanceTimersByTimeAsync(3_500)
            poller.activity()
            poller.checkNow()
            await vi.advanceTimersByTimeAsync(3_500)
            expect(check).toHaveBeenCalledOnce()

            for (const action of events) {
              switch (action.kind) {
                case 'advance':
                  await vi.advanceTimersByTimeAsync(action.milliseconds)
                  break
                case 'enable':
                case 'disable':
                  enabled = action.kind === 'enable'
                  poller.setEnabled(enabled)
                  break
                case 'activity':
                  poller.activity()
                  break
                case 'checkNow':
                  poller.checkNow()
                  break
                case 'changed':
                case 'unchanged': {
                  const gate = pending.shift()
                  if (gate) {
                    retryNotBefore = 0
                    gate.resolve(action.kind === 'changed')
                  }
                  break
                }
                case 'fail': {
                  const gate = pending.shift()
                  if (gate) {
                    const error = Object.assign(new Error('Probe failed'), {
                      retryAfterMs: action.retryAfterMs,
                    })
                    retryNotBefore = Date.now() + action.retryAfterMs
                    expectedErrors.push(error)
                    gate.reject(error)
                  }
                  break
                }
              }
              await vi.advanceTimersByTimeAsync(0)
              expect(violations).toEqual([])
              expect(onError.mock.calls).toEqual(
                expectedErrors.map((error) => [error])
              )
            }

            // Safety must not pass merely because polling stopped altogether.
            enabled = false
            poller.setEnabled(false)
            pending.shift()?.resolve(false)
            await vi.advanceTimersByTimeAsync(0)
            retryNotBefore = 0
            enabled = true
            const beforeResume = check.mock.calls.length
            poller.setEnabled(true)
            poller.checkNow()
            await vi.advanceTimersByTimeAsync(120_001)
            expect(check).toHaveBeenCalledTimes(beforeResume + 1)
            expect(violations).toEqual([])

            retryNotBefore = 0
            pending.shift()?.resolve(true)
            await vi.advanceTimersByTimeAsync(1_800)
            expect(check).toHaveBeenCalledTimes(beforeResume + 2)
            expect(violations).toEqual([])

            disposed = true
            enabled = false
            poller.dispose()
            const beforeDisposal = check.mock.calls.length
            const lateRequest = pending.shift()
            expect(lateRequest).toBeDefined()
            if (failAfterDisposal)
              lateRequest?.reject(new Error('Late failure'))
            else lateRequest?.resolve(true)
            poller.setEnabled(true)
            poller.activity()
            poller.checkNow()
            await vi.advanceTimersByTimeAsync(120_001)
            expect(check).toHaveBeenCalledTimes(beforeDisposal)
            expect(violations).toEqual([])
            expect(onError.mock.calls).toEqual(
              expectedErrors.map((error) => [error])
            )
          } finally {
            poller.dispose()
            for (const gate of pending) gate.resolve(false)
            await vi.advanceTimersByTimeAsync(0)
            vi.clearAllTimers()
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('keeps checking during repeated activity despite changing jitter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 1_000 }), {
          minLength: 1,
          maxLength: 80,
          size: 'medium',
        }),
        jitter,
        async (typingIntervals, randomValues) => {
          vi.useFakeTimers()
          vi.setSystemTime(0)
          const starts: number[] = []
          const poller = createProjectPoller({
            check: async () => {
              starts.push(Date.now())
              return false
            },
            onError: vi.fn(),
            random: randomSource(randomValues),
          })
          try {
            poller.setEnabled(true)
            await vi.advanceTimersByTimeAsync(0)
            for (const milliseconds of typingIntervals) {
              poller.activity()
              await vi.advanceTimersByTimeAsync(milliseconds)
              expect(
                Date.now() - starts[starts.length - 1]
              ).toBeLessThanOrEqual(1_800)
            }
            await vi.advanceTimersByTimeAsync(1_800)
            expect(starts.length).toBeGreaterThan(1)
            for (let index = 1; index < starts.length; index++) {
              expect(starts[index] - starts[index - 1]).toBeLessThanOrEqual(
                1_800
              )
            }
          } finally {
            poller.dispose()
            vi.clearAllTimers()
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})
