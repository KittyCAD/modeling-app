import { createLatestFileSaveQueue } from '@src/lib/projectSession/latestFileSaveQueue'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

describe('latest file save queue', () => {
  it('serializes writes and coalesces every waiting edit into the latest snapshot', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { minLength: 2, maxLength: 20 }),
        async (contents) => {
          const gate = Promise.withResolvers<undefined>()
          const written: string[] = []
          let active = 0
          const queue = createLatestFileSaveQueue(
            async (request: { requestedPath: string; code: string }) => {
              active += 1
              expect(active).toBe(1)
              written.push(request.code)
              if (written.length === 1) await gate.promise
              active -= 1
            }
          )
          const pending = contents.map((code) =>
            queue.save({ requestedPath: '/main.kcl', code })
          )
          try {
            expect(written).toEqual([contents[0]])
            gate.resolve(undefined)
            await Promise.all(pending)
            expect(written).toEqual([contents[0], contents.at(-1)])
            expect(queue.has('/main.kcl')).toBe(false)
          } finally {
            gate.resolve(undefined)
          }
        }
      )
    )
  })

  it('keeps other files independent during a seven-second save', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<undefined>()
    const saved: string[] = []
    const queue = createLatestFileSaveQueue(
      async ({ requestedPath }: { requestedPath: string }) => {
        if (requestedPath === '/slow.kcl') await gate.promise
        saved.push(requestedPath)
      }
    )
    const slow = queue.save({ requestedPath: '/slow.kcl' })
    try {
      await queue.save({ requestedPath: '/other.kcl' })
      await vi.advanceTimersByTimeAsync(7_000)
      expect(saved).toEqual(['/other.kcl'])
      expect(queue.has('/slow.kcl')).toBe(true)
      gate.resolve(undefined)
      await slow
      expect(saved).toEqual(['/other.kcl', '/slow.kcl'])
    } finally {
      gate.resolve(undefined)
      vi.useRealTimers()
    }
  })

  it('tries the newest queued snapshot after failure and releases failed queues for retry', async () => {
    const gate = Promise.withResolvers<undefined>()
    const write = vi.fn(
      async ({ code }: { requestedPath: string; code: number }) => {
        if (code === 1) {
          await gate.promise
          throw new Error('Lost acknowledgement')
        }
        if (code === 3) throw new Error('Offline')
      }
    )
    const queue = createLatestFileSaveQueue(write)
    const first = queue.save({ requestedPath: '/main.kcl', code: 1 })
    const latest = queue.save({ requestedPath: '/main.kcl', code: 2 })
    gate.resolve(undefined)
    await Promise.all([first, latest])
    expect(write).toHaveBeenCalledTimes(2)
    await expect(
      queue.save({ requestedPath: '/main.kcl', code: 3 })
    ).rejects.toThrow('Offline')
    expect(queue.has('/main.kcl')).toBe(false)
    await queue.save({ requestedPath: '/main.kcl', code: 4 })
    expect(queue.has('/main.kcl')).toBe(false)
  })
  it('preserves navigation saves between coalesced edits across generated file schedules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            requestedPath: fc.constantFrom('/a.kcl', '/b.kcl'),
            code: fc.string(),
            navigation: fc.boolean(),
          }),
          { minLength: 1, maxLength: 40 }
        ),
        async (requests) => {
          const gate = Promise.withResolvers<undefined>()
          const actual = new Map<string, string[]>()
          const active = new Set<string>()
          const expected = new Map<string, typeof requests>()
          const queue = createLatestFileSaveQueue(
            async (request: (typeof requests)[number]) => {
              expect(active.has(request.requestedPath)).toBe(false)
              active.add(request.requestedPath)
              const written = actual.get(request.requestedPath) ?? []
              written.push(request.code)
              actual.set(request.requestedPath, written)
              await gate.promise
              active.delete(request.requestedPath)
            }
          )
          const pending = requests.map((request) => {
            const scheduled = expected.get(request.requestedPath) ?? []
            // The first request is already running. Only adjacent waiting edits coalesce.
            if (
              scheduled.length > 1 &&
              !request.navigation &&
              scheduled.at(-1)?.navigation === false
            )
              scheduled[scheduled.length - 1] = request
            else scheduled.push(request)
            expected.set(request.requestedPath, scheduled)
            return request.navigation
              ? queue.enqueue(request)
              : queue.save(request)
          })
          try {
            gate.resolve(undefined)
            await Promise.all(pending)
            expect(actual).toEqual(
              new Map(
                [...expected].map(([path, values]) => [
                  path,
                  values.map((value) => value.code),
                ])
              )
            )
            expect(active.size).toBe(0)
            for (const path of expected.keys())
              expect(queue.has(path)).toBe(false)
          } finally {
            gate.resolve(undefined)
            await Promise.allSettled(pending)
          }
        }
      )
    )
  })

  it('reports a navigation failure even when a later queued edit succeeds', async () => {
    const gate = Promise.withResolvers<undefined>()
    const failure = new Error('Navigation write failed')
    const written: number[] = []
    const queue = createLatestFileSaveQueue(
      async ({ code }: { requestedPath: string; code: number }) => {
        written.push(code)
        if (code === 1) {
          await gate.promise
          throw failure
        }
      }
    )
    const outgoing = queue.enqueue({ requestedPath: '/main.kcl', code: 1 })
    const rejected = expect(outgoing).rejects.toBe(failure)
    const later = queue.save({ requestedPath: '/main.kcl', code: 2 })
    gate.resolve(undefined)
    await rejected
    await later
    expect(written).toEqual([1, 2])
    await queue.settled()
  })
  it('finishes an edit batch before a later navigation save is acknowledged', async () => {
    vi.useFakeTimers()
    const editGate = Promise.withResolvers<undefined>()
    const navigationGate = Promise.withResolvers<undefined>()
    let editFinished = false
    const queue = createLatestFileSaveQueue(
      async ({ code }: { requestedPath: string; code: number }) => {
        await (code === 1 ? editGate.promise : navigationGate.promise)
      }
    )
    const edit = queue
      .save({ requestedPath: '/main.kcl', code: 1 })
      .then(() => {
        editFinished = true
      })
    const navigation = queue.enqueue({ requestedPath: '/main.kcl', code: 2 })
    try {
      editGate.resolve(undefined)
      await vi.advanceTimersByTimeAsync(7_000)
      expect(editFinished).toBe(true)
      expect(queue.has('/main.kcl')).toBe(true)
      expect(queue.hasEdits('/main.kcl')).toBe(false)
      navigationGate.resolve(undefined)
      await Promise.all([edit, navigation])
    } finally {
      editGate.resolve(undefined)
      navigationGate.resolve(undefined)
      await Promise.allSettled([edit, navigation])
      vi.useRealTimers()
    }
  })
  it('keeps edit and navigation failures separate when both are queued', async () => {
    const gate = Promise.withResolvers<undefined>()
    const firstError = new Error('Edit failed')
    const navigationError = new Error('Navigation failed')
    const written: number[] = []
    const queue = createLatestFileSaveQueue(
      async ({ code }: { requestedPath: string; code: number }) => {
        written.push(code)
        if (code === 1) {
          await gate.promise
          throw firstError
        }
        if (code === 2) throw navigationError
      }
    )
    const first = queue.save({ requestedPath: '/main.kcl', code: 1 })
    const navigation = queue.enqueue({ requestedPath: '/main.kcl', code: 2 })
    const latest = queue.save({ requestedPath: '/main.kcl', code: 3 })
    const firstRejected = expect(first).rejects.toBe(firstError)
    const navigationRejected = expect(navigation).rejects.toBe(navigationError)
    gate.resolve(undefined)
    await Promise.all([firstRejected, navigationRejected, latest])
    expect(written).toEqual([1, 2, 3])
    expect(queue.has('/main.kcl')).toBe(false)
  })
})
