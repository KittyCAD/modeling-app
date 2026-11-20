import {
  benchmarkLocalPicker,
  PICK_BENCHMARK_SAMPLE_COUNT,
  type PickBenchmarkResult,
} from '@src/clientSideScene/localRenderer/pickBenchmark'
import {
  closePickBufferDebug,
  showPickBufferDebug,
  getPickBufferDebugState,
  setPickBufferDebugOpacity,
  setPickBufferDebugSeeds,
  subscribePickBufferDebug,
} from '@src/clientSideScene/localRenderer/pickBufferDebug'
import { useSingletons } from '@src/lib/boot'
import { reportRejection, trap } from '@src/lib/trap'
import { useState, useSyncExternalStore } from 'react'

export function LocalPickingDebug() {
  const [running, setRunning] = useState(false)
  const [benchmark, setBenchmark] = useState<PickBenchmarkResult | null>(null)
  const { kclManager } = useSingletons()
  const { active, showingSeeds, opacity } = useSyncExternalStore(
    subscribePickBufferDebug,
    getPickBufferDebugState
  )
  const renderer = kclManager.sceneInfra.localRenderer

  return (
    <section className="flex flex-col gap-2 py-2">
      <span>Local picking IDs</span>
      <button
        type="button"
        className="rounded bg-gray-200 px-3 py-1 text-black"
        disabled={!renderer}
        onClick={() => {
          if (active) {
            closePickBufferDebug()
          } else if (renderer) {
            const error = showPickBufferDebug(renderer)
            if (error) {
              trap(error)
            }
          }
        }}
      >
        {active ? 'Hide picking IDs' : 'Show picking IDs'}
      </button>
      {active && (
        <>
          <button
            type="button"
            className="rounded bg-gray-200 px-3 py-1 text-black"
            onClick={() => setPickBufferDebugSeeds(!showingSeeds)}
          >
            {showingSeeds ? 'Show grown IDs' : 'Show thin seeds'}
          </button>
          <label>
            Picking IDs opacity: {opacity}%
            <input
              type="range"
              min="0"
              max="100"
              value={opacity}
              onChange={(event) =>
                setPickBufferDebugOpacity(Number(event.target.value))
              }
            />
          </label>
        </>
      )}
      <button
        type="button"
        className="rounded bg-2 px-3 py-1 text-2 disabled:opacity-50"
        disabled={!renderer || running}
        onClick={() => {
          if (!renderer) {
            return
          }
          setRunning(true)
          setBenchmark(null)
          void benchmarkLocalPicker(renderer)
            .then((result) => {
              if (!trap(result)) {
                setBenchmark(result)
              }
            })
            .catch(reportRejection)
            .finally(() => setRunning(false))
        }}
      >
        {running ? 'Benchmarking...' : 'Run picker benchmark'}
      </button>
      {benchmark && (
        <div className="flex flex-col gap-2 text-xs">
          <span>
            {benchmark.backend}, {benchmark.width.toFixed(0)} x{' '}
            {benchmark.height.toFixed(0)} CSS px, {benchmark.bufferWidth} x{' '}
            {benchmark.bufferHeight} buffer px
          </span>
          <span>
            {PICK_BENCHMARK_SAMPLE_COUNT} center picks per phase. Fresh picks
            rebuild the ID buffer. Readback wait includes queued GPU work.
          </span>
          <div className="overflow-x-auto">
            <table className="w-full text-left tabular-nums">
              <thead>
                <tr>
                  <th scope="col">Phase</th>
                  <th scope="col">Render submit (ms)</th>
                  <th scope="col">Readback wait (ms)</th>
                  <th scope="col">Total median (ms)</th>
                  <th scope="col">Total p95 (ms)</th>
                </tr>
              </thead>
              <tbody>
                {benchmark.rows.map((row) => (
                  <tr key={row.phase}>
                    <th scope="row">{row.phase}</th>
                    <td>{row.submitMs.toFixed(2)}</td>
                    <td>{row.readbackMs.toFixed(2)}</td>
                    <td>{row.totalMs.toFixed(2)}</td>
                    <td>{row.p95Ms.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="self-start rounded bg-2 px-3 py-1 text-2"
            onClick={() => {
              const lines = [
                `${benchmark.backend}; ${benchmark.width}x${benchmark.height} CSS px; ${benchmark.bufferWidth}x${benchmark.bufferHeight} buffer px; ${PICK_BENCHMARK_SAMPLE_COUNT} center picks per phase`,
                'phase\tsubmitMedianMs\treadbackMedianMs\ttotalMedianMs\ttotalP95Ms',
                ...benchmark.rows.map((row) =>
                  [
                    row.phase,
                    row.submitMs.toFixed(2),
                    row.readbackMs.toFixed(2),
                    row.totalMs.toFixed(2),
                    row.p95Ms.toFixed(2),
                  ].join('\t')
                ),
              ]
              void navigator.clipboard
                .writeText(lines.join('\n'))
                .catch(reportRejection)
            }}
          >
            Copy results
          </button>
        </div>
      )}
    </section>
  )
}
