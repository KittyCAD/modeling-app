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
