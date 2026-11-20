import { Debugger } from '@src/lib/debugger'
import { expect, it, vi } from 'vitest'

it('records cleanup logs after browser globals are removed', () => {
  const debuggerInstance = new Debugger()
  const started = Date.now()
  vi.stubGlobal('window', undefined)
  try {
    debuggerInstance.addLog({
      label: 'connection',
      message: 'stopPingPong',
    })
    expect(debuggerInstance.logs).toHaveLength(1)
    expect(debuggerInstance.logs[0]).toMatchObject({
      label: 'connection',
      message: 'stopPingPong',
    })
    expect(debuggerInstance.logs[0].time).toBeGreaterThanOrEqual(started)
    expect(debuggerInstance.logs[0].time).toBeLessThanOrEqual(Date.now())
  } finally {
    vi.unstubAllGlobals()
  }
})
