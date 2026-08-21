import type { ClientMetrics } from '@kittycad/lib/dist/types/src'
import { Connection } from '@src/lib/engineConnection/connection'
import { FPS_TRACKER_INTERVAL_MS } from '@src/lib/engineConnection/fpsTracker'
import { EngineConnectionEvents } from '@src/lib/engineConnection/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

function createConnection() {
  return new Connection({
    url: 'wss://example.test',
    token: '',
    handleOnDataChannelMessage: () => {},
    tearDownManager: () => {},
    rejectPendingCommand: () => {},
    handleMessage: () => {},
  })
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

describe('Connection FPS tracking', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses an in-flight WebRTC stats collection', async () => {
    const connection = createConnection()
    const collector = vi
      .fn<() => Promise<ClientMetrics>>()
      .mockResolvedValue({ rtc_frames_per_second: 30 } satisfies ClientMetrics)
    connection.webrtcStatsCollector = collector

    const firstMetricsPromise = connection.collectClientMetrics()
    const secondMetricsPromise = connection.collectClientMetrics()

    expect(firstMetricsPromise).toBe(secondMetricsPromise)
    expect(collector).toHaveBeenCalledTimes(1)

    await firstMetricsPromise

    const thirdMetricsPromise = connection.collectClientMetrics()

    expect(thirdMetricsPromise).not.toBe(firstMetricsPromise)
    expect(collector).toHaveBeenCalledTimes(2)
  })

  it('publishes FPS only when the rounded value changes', async () => {
    vi.useFakeTimers()
    const connection = createConnection()
    const framesPerSecond: Array<number | undefined> = []
    const collector = vi
      .fn<() => Promise<ClientMetrics>>()
      .mockResolvedValueOnce({
        rtc_frames_per_second: 59.4,
      } satisfies ClientMetrics)
      .mockResolvedValueOnce({
        rtc_frames_per_second: 59.49,
      } satisfies ClientMetrics)
      .mockResolvedValueOnce({
        rtc_frames_per_second: 60.4,
      } satisfies ClientMetrics)

    connection.addEventListener(
      EngineConnectionEvents.FramesPerSecondChanged,
      (({ detail }: CustomEvent<number | undefined>) => {
        framesPerSecond.push(detail)
      }) as EventListener
    )
    connection.setWebrtcStatsCollector(collector)
    await flushPromises()

    expect(framesPerSecond).toEqual([59])

    await vi.advanceTimersByTimeAsync(FPS_TRACKER_INTERVAL_MS)
    await flushPromises()

    expect(framesPerSecond).toEqual([59])

    await vi.advanceTimersByTimeAsync(FPS_TRACKER_INTERVAL_MS)
    await flushPromises()

    expect(framesPerSecond).toEqual([59, 60])

    connection.stopFpsTracker()
  })
})
