import { useEffect, useState } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import { ConnectionStream } from '@src/components/ConnectionStream'
import { CustomIcon } from '@src/components/CustomIcon'
import Gizmo from '@src/components/gizmo/Gizmo'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { DEFAULT_SKETCH_SOLVE_STREAM_DIMMING } from '@src/clientSideScene/ClientSideSceneComp'
import { Toolbar } from '@src/Toolbar'
import { useApp, useSingletons } from '@src/lib/boot'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import { OpenCascadeThreeScene } from './OpenCascadeThreeScene'

export function ModelingArea() {
  useSignals()
  const { settings } = useApp()
  const engine = settings.useSettings().modeling.engine.current

  if (engine === 'open_cascade') {
    return <OpenCascadeModelingArea />
  }

  return <ZooModelingArea />
}

function ZooModelingArea() {
  const { auth } = useApp()
  const { state, send } = useModelingContext()
  const authToken = auth.useToken()
  const [sketchSolveStreamDimming, setSketchSolveStreamDimming] = useState(
    DEFAULT_SKETCH_SOLVE_STREAM_DIMMING
  )
  const showNonVisualConstraints = state.context.showNonVisualConstraints
  const streamVisibilityPercent = Math.round(
    (1 - sketchSolveStreamDimming) * 100
  )

  return (
    <div className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden">
      <Toolbar />
      <ConnectionStream
        authToken={authToken}
        sketchSolveStreamDimming={sketchSolveStreamDimming}
      />
      {state.matches('sketchSolveMode') && (
        <div className="absolute bottom-2 left-2 z-10 flex items-end gap-2 pointer-events-auto">
          <div className="px-2 py-1 border border-chalkboard-20 dark:border-chalkboard-80 rounded bg-chalkboard-10/80 dark:bg-chalkboard-100/80 backdrop-blur-sm">
            <div className="text-[10px] text-chalkboard-70 dark:text-chalkboard-40">
              Background Opacity
            </div>
            <input
              aria-label="Sketch background opacity"
              type="range"
              min="0"
              max="100"
              step="1"
              value={streamVisibilityPercent}
              onChange={(e) => {
                const nextVisibilityPercent = Number(e.target.value)
                setSketchSolveStreamDimming((100 - nextVisibilityPercent) / 100)
              }}
              className="w-32 cursor-pointer"
            />
          </div>
          <button
            type="button"
            aria-pressed={showNonVisualConstraints}
            aria-label="Toggle non-visual constraints"
            title="Show constraints"
            onClick={() => send({ type: 'toggle non-visual constraints' })}
            className={`h-8 px-2 rounded border text-xs flex items-center gap-1.5 backdrop-blur-sm ${
              showNonVisualConstraints
                ? 'bg-primary text-chalkboard-10 border-primary'
                : 'bg-chalkboard-10/80 dark:bg-chalkboard-100/80 border-chalkboard-20 dark:border-chalkboard-80'
            }`}
          >
            <CustomIcon
              name={showNonVisualConstraints ? 'eyeOpen' : 'eyeCrossedOut'}
              className="w-4 h-4"
            />
            Constraints
          </button>
        </div>
      )}
      <ModelingGizmo />
    </div>
  )
}

function OpenCascadeModelingArea() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const [diagnostic, setDiagnostic] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false

    async function startAndExecute() {
      const engineCommandManager =
        kclManager.engineCommandManager as EngineCommandManagerProxy
      if (engineCommandManager.currentEngine !== 'open_cascade') {
        return
      }

      if (engineCommandManager.connection) {
        engineCommandManager.tearDown()
      }

      if (!engineCommandManager.started) {
        await engineCommandManager.start({
          width: 1024,
          height: 768,
          token: 'open-cascade-local',
          setStreamIsReady: () => {},
          rustContext: kclManager.rustContext,
        })
      }

      await kclManager.rustContext.clearSceneAndBustCache(
        jsAppSettings(settings.actor),
        kclManager.path || undefined
      )
      await kclManager.executeCode()

      if (!cancelled) {
        setDiagnostic(undefined)
      }
    }

    startAndExecute().catch((error) => {
      if (!cancelled) {
        setDiagnostic(error instanceof Error ? error.message : String(error))
      }
      reportRejection(error)
    })

    return () => {
      cancelled = true
    }
  }, [kclManager, settings.actor])

  return (
    <div className="relative z-0 min-w-64 flex flex-col flex-1 items-center overflow-hidden bg-chalkboard-10 dark:bg-chalkboard-100">
      <Toolbar />
      <OpenCascadeThreeScene diagnostic={diagnostic} />
      <ModelingGizmo />
    </div>
  )
}

function ModelingGizmo() {
  return (
    <div className="absolute bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
      <Gizmo />
    </div>
  )
}
