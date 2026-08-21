import type { ClientMetrics } from '@kittycad/lib/dist/types/src'
import {
  FPS_TRACKER_INTERVAL_MS,
  getFramesPerSecondFromClientMetrics,
} from '@src/lib/engineConnection/fpsTracker'
import { describe, expect, it } from 'vitest'

describe('getFramesPerSecondFromClientMetrics', () => {
  it('uses a low-frequency tracker interval', () => {
    expect(FPS_TRACKER_INTERVAL_MS).toBe(5_000)
  })

  it('uses the browser-reported frames per second when available', () => {
    const result = getFramesPerSecondFromClientMetrics({
      metrics: {
        rtc_frames_decoded: 120,
        rtc_frames_per_second: 59.8,
      } satisfies ClientMetrics,
      previousSample: undefined,
      timestampMs: 1_000,
    })

    expect(result.framesPerSecond).toBe(59.8)
    expect(result.sample).toEqual({
      timestampMs: 1_000,
      framesDecoded: 120,
    })
  })

  it('falls back to decoded frame deltas', () => {
    const first = getFramesPerSecondFromClientMetrics({
      metrics: {
        rtc_frames_decoded: 120,
      } satisfies ClientMetrics,
      previousSample: undefined,
      timestampMs: 1_000,
    })
    const second = getFramesPerSecondFromClientMetrics({
      metrics: {
        rtc_frames_decoded: 168,
      } satisfies ClientMetrics,
      previousSample: first.sample,
      timestampMs: 3_000,
    })

    expect(first.framesPerSecond).toBeUndefined()
    expect(second.framesPerSecond).toBe(24)
  })

  it('ignores unusable frame deltas', () => {
    const result = getFramesPerSecondFromClientMetrics({
      metrics: {
        rtc_frames_decoded: 110,
      } satisfies ClientMetrics,
      previousSample: {
        timestampMs: 1_000,
        framesDecoded: 120,
      },
      timestampMs: 2_000,
    })

    expect(result.framesPerSecond).toBeUndefined()
  })
})
