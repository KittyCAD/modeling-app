import { describe, expect, it } from 'vitest'
import { createFsOperationQueue } from '@src/features/fsOperations/createFsOperationQueue'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('fs operation queue', () => {
  it('serializes operations on the same path in submission order', async () => {
    const queue = createFsOperationQueue()
    const order: string[] = []

    const slow = queue.enqueue('/a', async () => {
      await tick()
      order.push('first')
    })
    const fast = queue.enqueue('/a', async () => {
      order.push('second')
    })

    await Promise.all([slow, fast])
    // Without serialization the fast one lands first and a later save can be
    // overwritten by an earlier one.
    expect(order).toEqual(['first', 'second'])
  })

  it('runs operations on different paths concurrently', async () => {
    const queue = createFsOperationQueue()
    const order: string[] = []

    const a = queue.enqueue('/a', async () => {
      await tick()
      order.push('a')
    })
    const b = queue.enqueue('/b', async () => {
      order.push('b')
    })

    await Promise.all([a, b])
    expect(order).toEqual(['b', 'a'])
  })

  it('treats equivalent path spellings as the same path', async () => {
    const queue = createFsOperationQueue()
    const order: string[] = []

    const first = queue.enqueue('/a/', async () => {
      await tick()
      order.push('first')
    })
    const second = queue.enqueue('/a', async () => {
      order.push('second')
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('lets a failed operation reject without blocking later ones', async () => {
    const queue = createFsOperationQueue()

    const failing = queue.enqueue('/a', async () => {
      throw new Error('disk full')
    })
    await expect(failing).rejects.toThrow('disk full')

    // One failed save must not poison every later save of the same file.
    await expect(queue.enqueue('/a', async () => 'ok')).resolves.toBe('ok')
  })

  it('returns the operation result to its own caller', async () => {
    const queue = createFsOperationQueue()
    await expect(queue.enqueue('/a', async () => 42)).resolves.toBe(42)
  })

  it('tracks pending work', async () => {
    const queue = createFsOperationQueue()
    expect(queue.pending.value).toBe(0)

    const running = queue.enqueue('/a', () => tick())
    expect(queue.pending.value).toBe(1)

    await running
    expect(queue.pending.value).toBe(0)
  })

  it('recognises its own writes, so a watcher can ignore the echo', () => {
    const queue = createFsOperationQueue()
    queue.recordWrite('/a/main.kcl', 'content-1')

    expect(queue.isOwnWrite('/a/main.kcl', 'content-1')).toBe(true)
    // A different version of the file is somebody else's edit.
    expect(queue.isOwnWrite('/a/main.kcl', 'content-2')).toBe(false)
    expect(queue.isOwnWrite('/b/other.kcl', 'content-1')).toBe(false)
  })
})
