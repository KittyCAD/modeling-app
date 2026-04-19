import { useEffect, useRef, useState } from 'react'
import GizmoRenderer from '@src/components/gizmo/GizmoRenderer'
import { useApp, useSingletons } from '@src/lib/boot'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'

export default function CubeGizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state: modelingState } = useModelingContext()
  const settingsValues = settings.useSettings()

  const resolvedTheme = useResolvedTheme()

  // Hardcoded to orthographic, the model doesn't look good in perspective
  const isPerspective = false //settings.modeling.cameraProjection.current === 'perspective'
  const initialIsPerspectiveRef = useRef(isPerspective)
  const initialResolvedThemeRef = useRef(resolvedTheme)

  const wrapperRef = useRef<HTMLDivElement>(null!)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const renderer = useRef<GizmoRenderer | null>(null)

  const [disableOrbit, setDisabledOrbit] = useState(false)

  // onMount
  useEffect(() => {
    if (canvasRef.current) {
      renderer.current = new GizmoRenderer(
        canvasRef.current,
        initialIsPerspectiveRef.current,
        initialResolvedThemeRef.current,
        kclManager.sceneInfra
      )
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [kclManager.sceneInfra])

  // perspective changed
  // useEffect(() => {
  //   renderer.current?.setPerspective(isPerspective)
  // }, [isPerspective])

  // theme changed
  useEffect(() => {
    renderer.current?.setTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    const disabled =
      modelingState.matches('Sketch') &&
      !settingsValues.app.allowOrbitInSketchMode.current

    setDisabledOrbit(disabled)
    renderer.current?.setDisabled(disabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [modelingState, settingsValues.app.allowOrbitInSketchMode.current])

  return (
    <div
      ref={wrapperRef}
      style={{
        cursor: disableOrbit ? 'not-allowed' : 'auto',
      }}
      aria-label="View orientation gizmo"
      data-testid={`gizmo${disableOrbit ? '-disabled' : ''}`}
      className="grid place-content-center rounded-full overflow-hidden pointer-events-auto"
    >
      <canvas
        ref={canvasRef}
        style={{ pointerEvents: disableOrbit ? 'none' : 'auto' }}
      />
    </div>
  )
}
