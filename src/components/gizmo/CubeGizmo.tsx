import GizmoRenderer from '@src/components/gizmo/GizmoRenderer'
import { useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'

import { useResolvedTheme } from '@src/hooks/useResolvedTheme'

export default function CubeGizmo() {
  const { kclManager } = useSingletons()

  const resolvedTheme = useResolvedTheme()

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

  return (
    <div
      ref={wrapperRef}
      aria-label="View orientation gizmo"
      data-testid="gizmo"
      className="grid place-content-center rounded-full overflow-hidden pointer-events-auto"
    >
      <canvas ref={canvasRef} />
    </div>
  )
}
