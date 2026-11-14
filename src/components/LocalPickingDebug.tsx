import {
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
    </section>
  )
}
