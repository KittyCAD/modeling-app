import { PreviewQueue } from '@src/lib/modelingPreview/queue'
import { describe, expect, it, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('preview ownership', () => {
  it('runs only the newest queued candidate and never publishes the superseded one', async () => {
    const first = deferred<number>()
    const evaluate = vi.fn((input: number) =>
      input === 1 ? first.promise : Promise.resolve(input)
    )
    const publish = vi.fn(
      async (_output: number, _current: () => boolean) => {}
    )
    const queue = new PreviewQueue(evaluate, publish, vi.fn())
    queue.update(1)
    queue.update(2)
    queue.update(3)
    expect(evaluate.mock.calls).toEqual([[1]])
    first.resolve(1)
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(evaluate.mock.calls).toEqual([[1], [3]])
    expect(publish.mock.calls[0][0]).toBe(3)
  })

  it('revokes a result even after asynchronous geometry loading begins', async () => {
    const loaded = deferred<undefined>()
    const applied = vi.fn()
    const started = deferred<undefined>()
    const queue = new PreviewQueue(
      async () => 1,
      async (_, current) => {
        started.resolve(undefined)
        await loaded.promise
        if (current()) applied()
      },
      vi.fn()
    )
    queue.update(1)
    await started.promise
    queue.close()
    loaded.resolve(undefined)
    await loaded.promise
    expect(applied).not.toHaveBeenCalled()
  })

  it('suppresses failures and queued work after cancellation', async () => {
    const result = deferred<number>()
    const evaluate = vi.fn(() => result.promise)
    const fail = vi.fn()
    const queue = new PreviewQueue(evaluate, vi.fn(), fail)
    queue.update(1)
    queue.update(2)
    queue.close()
    result.reject(new Error('disconnected'))
    await Promise.resolve()
    await Promise.resolve()
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(fail).not.toHaveBeenCalled()
  })
})
