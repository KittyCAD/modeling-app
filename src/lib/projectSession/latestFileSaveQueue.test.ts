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
})
