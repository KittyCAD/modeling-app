import type { PickTiming } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import type { EdgePickingMode } from '@src/clientSideScene/localRenderer/pickBufferDebug'

export const PICK_BENCHMARK_MODES: readonly EdgePickingMode[] = [
  'original-main',
  'fixed-24',
  'depth-offset',
  'cpu-search',
  'gpu-growth',
  'zoom-growth',
  'face-protect-growth',
  'face-strip-growth',
  'three-edge-growth',
  'score-growth',
  'coverage-growth',
]

export type PickBenchmarkRow = {
  mode: EdgePickingMode
  phase: 'cached' | 'fresh'
  dirtyCount: number
  staleCount: number
  renderMs: number
  readbackMs: number
  totalMs: number
  p95Ms: number
}

export type PickBenchmarkResult = {
  backend: string
  width: number
  height: number
  x: number
  y: number
  rows: PickBenchmarkRow[]
}

export function summarizePickTimings(
  mode: EdgePickingMode,
  phase: PickBenchmarkRow['phase'],
  timings: PickTiming[]
): PickBenchmarkRow {
  const sorted = (key: 'renderMs' | 'readbackMs' | 'totalMs') =>
    timings.map((timing) => timing[key]).sort((a, b) => a - b)
  const render = sorted('renderMs')
  const readback = sorted('readbackMs')
  const total = sorted('totalMs')
  return {
    mode,
    phase,
    dirtyCount: timings.filter((timing) => timing.dirty).length,
    staleCount: timings.filter((timing) => timing.stale).length,
    renderMs: render[Math.floor(render.length / 2)],
    readbackMs: readback[Math.floor(readback.length / 2)],
    totalMs: total[Math.floor(total.length / 2)],
    p95Ms: total[Math.ceil(total.length * 0.95) - 1],
  }
}
