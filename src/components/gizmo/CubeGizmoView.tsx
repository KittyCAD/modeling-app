import GizmoRenderer from '@src/components/gizmo/GizmoRenderer'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ResolvedTheme } from '@src/lib/theme'
import { useEffect, useRef } from 'react'

export function CubeGizmoView({
  sceneInfra,
  resolvedTheme,
  disableOrbit = false,
}: {
  sceneInfra: Pick<SceneInfra, 'camControls'>
  resolvedTheme: ResolvedTheme
  disableOrbit?: boolean
}) {
  // Hardcoded to orthographic, the model doesn't look good in perspective
  const isPerspective = false //settings.modeling.cameraProjection.current === 'perspective'
  const initialIsPerspectiveRef = useRef(isPerspective)
  const initialResolvedThemeRef = useRef(resolvedTheme)

  const wrapperRef = useRef<HTMLDivElement>(null!)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const renderer = useRef<GizmoRenderer | null>(null)

  // onMount
  useEffect(() => {
    if (canvasRef.current) {
      renderer.current = new GizmoRenderer(
        canvasRef.current,
        initialIsPerspectiveRef.current,
        initialResolvedThemeRef.current,
        sceneInfra
      )
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [sceneInfra])

  // perspective changed
  // useEffect(() => {
  //   renderer.current?.setPerspective(isPerspective)
  // }, [isPerspective])

  // theme changed
  useEffect(() => {
    renderer.current?.setTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    renderer.current?.setDisabled(disableOrbit)
  }, [disableOrbit])

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
