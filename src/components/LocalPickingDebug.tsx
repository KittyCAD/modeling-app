import {
  type EdgePickingMode,
  getPickBufferDebugState,
  setPickBufferDebugOpacity,
  setPickBufferDebugSeeds,
  subscribePickBufferDebug,
} from '@src/clientSideScene/localRenderer/pickBufferDebug'
import { useSingletons } from '@src/lib/boot'
import { trap } from '@src/lib/trap'
import { useSyncExternalStore } from 'react'

export function LocalPickingDebug() {
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
          disabled={!renderer}
          onChange={(event) =>
            renderer?.setEdgePickingMode(event.target.value as EdgePickingMode)
          }
        >
          <option value="original-main">Original</option>
          <option value="fixed-24">Fixed 24px</option>
          <option value="depth-offset">Depth offset</option>
          <option value="cpu-search">CPU nearest edge</option>
          <option value="gpu-growth">GPU growth</option>
          <option value="zoom-growth">Zoom-adjusted GPU growth</option>
        </select>
      </label>
      <button
        type="button"
        className="rounded bg-gray-200 px-3 py-1 text-black"
        disabled={!renderer}
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
      {active && (
        <>
          {(mode === 'gpu-growth' ||
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
