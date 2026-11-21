import {
  type EdgePickingMode,
  getPickBufferDebugState,
  setPickBufferDebugOpacity,
  setPickBufferDebugSeeds,
  subscribePickBufferDebug,
} from '@src/clientSideScene/localRenderer/pickBufferDebug'
import type { PickBenchmarkResult } from '@src/clientSideScene/localRenderer/pickBenchmark'
import { useSingletons } from '@src/lib/boot'
import { reportRejection, trap } from '@src/lib/trap'
import { useState, useSyncExternalStore } from 'react'

export function LocalPickingDebug() {
  const [running, setRunning] = useState(false)
  const [benchmark, setBenchmark] = useState<PickBenchmarkResult | null>(null)
  const { kclManager } = useSingletons()
  const { active, showingSeeds, opacity, mode } = useSyncExternalStore(
    subscribePickBufferDebug,
    getPickBufferDebugState
  )
  const renderer = kclManager.sceneInfra.localRenderer

  return (
    <section className="flex flex-col gap-2 py-2">
      <span>Local picking IDs</span>
      <label>
        Edge picking mode
        <select
          value={mode}
          disabled={!renderer || running}
          onChange={(event) =>
            renderer?.setEdgePickingMode(event.target.value as EdgePickingMode)
          }
        >
          <option value="original-main">Original</option>
          <option value="fixed-24">Fixed 24px</option>
          <option value="depth-offset">Depth offset</option>
          <option value="cpu-search">CPU nearest edge</option>
          <option value="gpu-growth">GPU growth</option>
          <option value="face-protect-growth">
            GPU growth (protect faces)
          </option>
          <option value="zoom-growth">Zoom-adjusted GPU growth</option>
          <option value="score-growth">GPU growth (edge/face scores)</option>
          <option value="coverage-growth">
            GPU growth (depth and face coverage)
          </option>
          <option value="three-edge-growth">
            GPU growth (keep faces at 3+ edges)
          </option>
          <option value="face-strip-growth">
            GPU growth (preserve face strip)
          </option>
        </select>
      </label>
      <button
        type="button"
        className="rounded bg-gray-200 px-3 py-1 text-black"
        disabled={!renderer || running}
        onClick={() => {
          if (active) renderer?.closePickBufferDebug()
          else {
            const error = renderer?.showPickBufferDebug()
            if (error) trap(error)
          }
        }}
      >
        {active ? 'Hide picking IDs' : 'Show picking IDs'}
      </button>
      <button
        type="button"
        className="rounded bg-2 px-3 py-1 text-2 disabled:opacity-50"
        disabled={!renderer || running}
        onClick={() => {
          if (!renderer) return
          setRunning(true)
          setBenchmark(null)
          void renderer
            .runPickBenchmark()
            .then((result) => {
              if (trap(result)) return
              setBenchmark(result)
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
            {benchmark.height.toFixed(0)} CSS px, canvas center (
            {benchmark.x.toFixed(0)}, {benchmark.y.toFixed(0)})
          </span>
          <span>
            30 samples per phase. Readback wait includes queued GPU work, the
            pixel copy, and async completion.
          </span>
          <div className="overflow-x-auto">
            <table className="w-full text-left tabular-nums">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Phase</th>
                  <th>Dirty</th>
                  <th>Stale</th>
                  <th>Render ms</th>
                  <th>Readback wait ms</th>
                  <th>Total ms</th>
                  <th>P95 ms</th>
                </tr>
              </thead>
              <tbody>
                {benchmark.rows.map((row) => (
                  <tr key={`${row.mode}-${row.phase}`}>
                    <td>{row.mode}</td>
                    <td>{row.phase}</td>
                    <td>{row.dirtyCount}</td>
                    <td>{row.staleCount}</td>
                    <td>{row.renderMs.toFixed(1)}</td>
                    <td>{row.readbackMs.toFixed(1)}</td>
                    <td>{row.totalMs.toFixed(1)}</td>
                    <td>{row.p95Ms.toFixed(1)}</td>
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
                `Backend: ${benchmark.backend}; viewport: ${benchmark.width}x${benchmark.height}; point: ${benchmark.x},${benchmark.y}`,
                'mode\tphase\tdirty\tstale\trenderMs\treadbackMs\ttotalMs\tp95Ms',
                ...benchmark.rows.map((row) =>
                  [
                    row.mode,
                    row.phase,
                    row.dirtyCount,
                    row.staleCount,
                    row.renderMs.toFixed(1),
                    row.readbackMs.toFixed(1),
                    row.totalMs.toFixed(1),
                    row.p95Ms.toFixed(1),
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
      {active && (
        <>
          {(mode === 'gpu-growth' ||
            mode === 'face-protect-growth' ||
            mode === 'face-strip-growth' ||
            mode === 'three-edge-growth' ||
            mode === 'score-growth' ||
            mode === 'coverage-growth' ||
            mode === 'cpu-search' ||
            mode === 'zoom-growth') && (
            <button
              type="button"
              className="rounded bg-gray-200 px-3 py-1 text-black"
              onClick={() => setPickBufferDebugSeeds(!showingSeeds)}
            >
              {showingSeeds ? 'Show resolved IDs' : 'Show thin seeds'}
            </button>
          )}
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
    </section>
  )
}
