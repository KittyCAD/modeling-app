import type { PickBufferIO } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import type { LocalRenderer } from '@src/clientSideScene/localRenderer/LocalRenderer'
import { withPickBufferDebugPaused } from '@src/clientSideScene/localRenderer/pickBufferDebug'

export const PICK_BENCHMARK_SAMPLE_COUNT = 30

export type PickTiming = {
  rendered: boolean
  submitMs: number
  readbackMs: number
  totalMs: number
}

type PickBenchmarkRow = {
  phase: 'Cached' | 'Fresh'
  submitMs: number
  readbackMs: number
  totalMs: number
  p95Ms: number
}

export type PickBenchmarkResult = {
  backend: string
  width: number
  height: number
  bufferWidth: number
  bufferHeight: number
  rows: PickBenchmarkRow[]
}

export function summarizePickTimings(
  phase: PickBenchmarkRow['phase'],
  timings: PickTiming[]
): PickBenchmarkRow {
  const sorted = (key: 'submitMs' | 'readbackMs' | 'totalMs') =>
    timings.map((timing) => timing[key]).sort((a, b) => a - b)
  const median = (values: number[]) =>
    (values[Math.floor((values.length - 1) / 2)] +
      values[Math.floor(values.length / 2)]) /
    2
  const total = sorted('totalMs')
  return {
    phase,
    submitMs: median(sorted('submitMs')),
    readbackMs: median(sorted('readbackMs')),
    totalMs: median(total),
    p95Ms: total[Math.ceil(total.length * 0.95) - 1],
  }
}

export function benchmarkLocalPicker(
  source: Pick<LocalRenderer, 'getPickView'>
) {
  return withPickBufferDebugPaused(
    async (): Promise<PickBenchmarkResult | Error> => {
      const view = source.getPickView()
      if (!view)
        return new Error('No current local model is available to benchmark.')
      const { width, height, backend, bufferWidth, bufferHeight } = view
      if (width <= 0 || height <= 0)
        return new Error('No local viewport is available to benchmark.')

      const sample = async (count: number, fresh?: boolean) => {
        const timings: PickTiming[] = []
        for (let i = 0; i < count; i++) {
          if (!view.isCurrent())
            return new Error('Scene or viewport changed during the benchmark.')
          if (fresh) view.invalidate()
          const timing = {
            rendered: false,
            submitMs: 0,
            readbackMs: 0,
            totalMs: 0,
          }
          const buffer: PickBufferIO = {
            render(target, camera) {
              const start = performance.now()
              view.buffer.render(target, camera)
              timing.submitMs = performance.now() - start
              timing.rendered = true
            },
            async read(...args) {
              const start = performance.now()
              const pixels = await view.buffer.read(...args)
              timing.readbackMs = performance.now() - start
              return pixels
            },
          }
          const start = performance.now()
          const result = await view.pick(width / 2, height / 2, buffer)
          timing.totalMs = performance.now() - start
          if (
            !result ||
            result.stale ||
            (fresh !== undefined && timing.rendered !== fresh)
          ) {
            return new Error('Picking targets changed during the benchmark.')
          }
          timings.push(timing)
        }
        return timings
      }
      view.invalidate()
      const warmup = await sample(5)
      if (warmup instanceof Error) return warmup
      const cached = await sample(PICK_BENCHMARK_SAMPLE_COUNT, false)
      if (cached instanceof Error) return cached
      const fresh = await sample(PICK_BENCHMARK_SAMPLE_COUNT, true)
      if (fresh instanceof Error) return fresh
      if (!view.isCurrent())
        return new Error('Scene or viewport changed during the benchmark.')
      return {
        backend,
        width,
        height,
        bufferWidth,
        bufferHeight,
        rows: [
          summarizePickTimings('Cached', cached),
          summarizePickTimings('Fresh', fresh),
        ],
      }
    }
  )
}
