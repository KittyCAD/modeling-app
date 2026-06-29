import {
  type SubscribableActor,
  waitForActorSnapshot,
} from '@src/machines/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createFakeActor<TSnapshot>(
  initialSnapshot: TSnapshot
): SubscribableActor<TSnapshot> & {
  listenerCount: () => number
  setSnapshot: (nextSnapshot: TSnapshot) => void
} {
  let snapshot = initialSnapshot
  const listeners = new Set<(nextSnapshot: TSnapshot) => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return {
        unsubscribe: () => listeners.delete(listener),
      }
    },
    listenerCount: () => listeners.size,
    setSnapshot: (nextSnapshot) => {
      snapshot = nextSnapshot
      for (const listener of listeners) {
        listener(nextSnapshot)
      }
    },
  }
}

describe('machine utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves true immediately when the actor snapshot already matches', async () => {
    const actor = createFakeActor('ready')

    await expect(
      waitForActorSnapshot(actor, (snapshot) => snapshot === 'ready', 5000)
    ).resolves.toBe(true)
    expect(actor.listenerCount()).toBe(0)
  })

  it('resolves true and unsubscribes when a later actor snapshot matches', async () => {
    const actor = createFakeActor('loading')
    const matched = waitForActorSnapshot(
      actor,
      (snapshot) => snapshot === 'ready',
      5000
    )

    expect(actor.listenerCount()).toBe(1)
    actor.setSnapshot('ready')

    await expect(matched).resolves.toBe(true)
    expect(actor.listenerCount()).toBe(0)
  })

  it('resolves false and unsubscribes when the actor snapshot does not match before timeout', async () => {
    const actor = createFakeActor('loading')
    const matched = waitForActorSnapshot(
      actor,
      (snapshot) => snapshot === 'ready',
      5000
    )

    expect(actor.listenerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)

    await expect(matched).resolves.toBe(false)
    expect(actor.listenerCount()).toBe(0)
  })
})
