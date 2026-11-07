import GizmoRenderer from '@src/components/gizmo/GizmoRenderer'
import { useEffect, useRef } from 'react'
import type { GizmoProps } from '@src/components/gizmo/Gizmo'

export default function CubeGizmo({
  camera,
  theme,
  orbitEnabled,
}: Pick<GizmoProps, 'camera' | 'theme' | 'orbitEnabled'>) {
  const initialTheme = useRef(theme)
  const wrapperRef = useRef<HTMLDivElement>(null!)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const renderer = useRef<GizmoRenderer | null>(null)

  const disableOrbit = !orbitEnabled

  // onMount
  useEffect(() => {
    if (canvasRef.current) {
      renderer.current = new GizmoRenderer(
        canvasRef.current,
        false, // The cube uses an orthographic camera regardless of the main projection.
        initialTheme.current,
        camera
      )
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [camera])

  useEffect(() => {
    renderer.current?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    renderer.current?.setDisabled(!orbitEnabled)
  }, [camera, orbitEnabled])

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
