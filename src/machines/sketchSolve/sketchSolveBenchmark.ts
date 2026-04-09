import { mark, type PerformanceMarkDetail } from '@src/lib/performance'

type BenchmarkConfig = {
  enabled?: boolean
}

type BenchmarkGlobal = typeof globalThis & {
  __zooBenchmark?: BenchmarkConfig
}

export const SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX = 'benchmark/sketch-solve-drag'

export const SKETCH_SOLVE_DRAG_BENCHMARK_MARKS = {
  editSegmentsStart: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/editSegments/start`,
  editSegmentsEnd: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/editSegments/end`,
  updateSketchOutcomeStart: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/updateSketchOutcome/start`,
  updateSketchOutcomeEnd: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/updateSketchOutcome/end`,
  updateSceneGraphStart: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/updateSceneGraph/start`,
  updateSceneGraphEnd: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/updateSceneGraph/end`,
  animationFrameEnd: `${SKETCH_SOLVE_DRAG_BENCHMARK_PREFIX}/animationFrame/end`,
} as const

type SketchSolveDragBenchmarkMarkName =
  (typeof SKETCH_SOLVE_DRAG_BENCHMARK_MARKS)[keyof typeof SKETCH_SOLVE_DRAG_BENCHMARK_MARKS]

function isBenchmarkEnabled(): boolean {
  return Boolean((globalThis as BenchmarkGlobal).__zooBenchmark?.enabled)
}

export function markSketchSolveDragBenchmark(
  name: SketchSolveDragBenchmarkMarkName,
  detail?: PerformanceMarkDetail
): void {
  if (!isBenchmarkEnabled()) {
    return
  }

  mark(name, { detail })
}
