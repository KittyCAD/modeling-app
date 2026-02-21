import type { Bonjour, Browser, Service } from 'bonjour-service'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { discoverMachineApi } from '@src/lib/discoverMachineApi'

afterEach(() => {
  vi.useRealTimers()
})

describe('discoverMachineApi', () => {
  it('stops the bonjour browser once after the timeout', async () => {
    vi.useFakeTimers()

    const stop = vi.fn()
    const destroy = vi.fn()
    const find = vi.fn(
      (
        _options: { protocol: 'tcp' | 'udp'; type: string },
        _onup: (service: Service) => void
      ) => ({ stop }) as Browser
    )

    const resultPromise = discoverMachineApi({
      timeoutAfterMs: 10,
      createBonjour: () =>
        ({
          find,
          destroy,
        }) as unknown as Bonjour,
    })

    await vi.advanceTimersByTimeAsync(10)

    await expect(resultPromise).resolves.toBeNull()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledTimes(1)
  })
})
