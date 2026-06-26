import { afterEach, describe, expect, it, vi } from 'vitest'

import { MachineManager } from '@src/lib/MachineManager'

describe('MachineManager', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps polling after the first update fails', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const getMachineApiIp = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('first update failed'))
      .mockResolvedValueOnce('127.0.0.1')
    const listMachines = vi.fn().mockResolvedValue([])
    const manager = new MachineManager({
      getMachineApiIp,
      listMachines,
    })
    manager.pulseTimeoutDurationMS = 10

    await manager.start()

    expect(getMachineApiIp).toHaveBeenCalledTimes(1)
    expect(listMachines).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(manager.pulseTimeoutDurationMS)

    expect(getMachineApiIp).toHaveBeenCalledTimes(2)
    expect(listMachines).toHaveBeenCalledWith('127.0.0.1')

    manager.stop()
  })
})
