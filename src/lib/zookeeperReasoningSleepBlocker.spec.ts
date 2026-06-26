import { describe, expect, it, vi } from 'vitest'

import {
  ZOOKEEPER_REASONING_SLEEP_BLOCKER_TYPE,
  ZookeeperReasoningSleepBlocker,
} from '@src/lib/zookeeperReasoningSleepBlocker'

describe('ZookeeperReasoningSleepBlocker', () => {
  it('starts a system sleep blocker when reasoning becomes active', () => {
    const sleepBlocker = {
      start: vi.fn(() => 10),
      stop: vi.fn(() => true),
    }
    const blocker = new ZookeeperReasoningSleepBlocker(sleepBlocker)

    expect(blocker.setActive(1, true)).toBe(true)

    expect(sleepBlocker.start).toHaveBeenCalledOnce()
    expect(sleepBlocker.start).toHaveBeenCalledWith(
      ZOOKEEPER_REASONING_SLEEP_BLOCKER_TYPE
    )
    expect(sleepBlocker.stop).not.toHaveBeenCalled()
  })

  it('keeps blocking until all active windows have finished reasoning', () => {
    const sleepBlocker = {
      start: vi.fn(() => 10),
      stop: vi.fn(() => true),
    }
    const blocker = new ZookeeperReasoningSleepBlocker(sleepBlocker)

    blocker.setActive(1, true)
    blocker.setActive(2, true)
    expect(sleepBlocker.start).toHaveBeenCalledOnce()
    expect(blocker.getActiveCount()).toBe(2)

    expect(blocker.setActive(1, false)).toBe(true)
    expect(sleepBlocker.stop).not.toHaveBeenCalled()

    expect(blocker.setActive(2, false)).toBe(false)
    expect(sleepBlocker.stop).toHaveBeenCalledOnce()
    expect(sleepBlocker.stop).toHaveBeenCalledWith(10)
  })

  it('does not restart or stop on duplicate state updates', () => {
    const sleepBlocker = {
      start: vi.fn(() => 10),
      stop: vi.fn(() => true),
    }
    const blocker = new ZookeeperReasoningSleepBlocker(sleepBlocker)

    blocker.setActive(1, true)
    blocker.setActive(1, true)
    blocker.setActive(1, false)
    blocker.setActive(1, false)

    expect(sleepBlocker.start).toHaveBeenCalledOnce()
    expect(sleepBlocker.stop).toHaveBeenCalledOnce()
  })
})
