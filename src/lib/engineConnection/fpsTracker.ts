import type { ClientMetrics } from '@kittycad/lib/dist/types/src'

export const FPS_TRACKER_INTERVAL_MS = 5_000

export interface FpsTrackerSample {
  timestampMs: number
  framesDecoded: number | undefined
}

export function getFramesPerSecondFromClientMetrics({
  metrics,
  previousSample,
  timestampMs,
}: {
  metrics: ClientMetrics
  previousSample: FpsTrackerSample | undefined
  timestampMs: number
}) {
  const reportedFramesPerSecond = metrics.rtc_frames_per_second
  const framesDecoded = metrics.rtc_frames_decoded
  const sample = {
    timestampMs,
    framesDecoded:
      typeof framesDecoded === 'number' && Number.isFinite(framesDecoded)
        ? framesDecoded
        : undefined,
  }

  if (
    typeof reportedFramesPerSecond === 'number' &&
    Number.isFinite(reportedFramesPerSecond)
  ) {
    return {
      framesPerSecond: Math.max(0, reportedFramesPerSecond),
      sample,
    }
  }

  if (
    sample.framesDecoded === undefined ||
    previousSample?.framesDecoded === undefined
  ) {
    return {
      framesPerSecond: undefined,
      sample,
    }
  }

  const elapsedSeconds = (timestampMs - previousSample.timestampMs) / 1_000
  const framesDecodedDelta = sample.framesDecoded - previousSample.framesDecoded

  if (elapsedSeconds <= 0 || framesDecodedDelta < 0) {
    return {
      framesPerSecond: undefined,
      sample,
    }
  }

  return {
    framesPerSecond: framesDecodedDelta / elapsedSeconds,
    sample,
  }
}
