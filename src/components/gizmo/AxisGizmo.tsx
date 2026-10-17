import { useSignals } from '@preact/signals-react/runtime'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'

export default function AxisGizmo() {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { sceneInfra } = kclManager
  const { state: modelingState } = useModelingContext()
  const settingsValues = settings.useSettings()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const disabled =
    modelingState.matches('Sketch') &&
    !settingsValues.app.allowOrbitInSketchMode.current

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const renderer = sceneInfra.getAxisGizmo()
    if (!renderer) return
    wrapper.appendChild(renderer.canvas)
    return () => {
      renderer.canvas.remove()
    }
  }, [sceneInfra])

  useEffect(() => {
    sceneInfra.getAxisGizmo()?.setDisabled(disabled)
  }, [sceneInfra, disabled])

  return (
    <div
      ref={wrapperRef}
      aria-label="View orientation gizmo"
      data-testid={`gizmo${disabled ? '-disabled' : ''}`}
      style={{
        filter: disabled ? 'grayscale(100%)' : 'none',
        cursor: disabled ? 'not-allowed' : 'auto',
      }}
      className="relative grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-auto bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm"
    >
      <ViewControlContextMenu menuTargetElement={wrapperRef} />
    </div>
  )
}
