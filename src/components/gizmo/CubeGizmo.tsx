import { useSignals } from '@preact/signals-react/runtime'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { useApp, useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'

export default function CubeGizmo() {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { sceneInfra } = kclManager
  const { state: modelingState } = useModelingContext()
  const settingsValues = settings.useSettings()
  const resolvedTheme = useResolvedTheme()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const disabled =
    modelingState.matches('Sketch') &&
    !settingsValues.app.allowOrbitInSketchMode.current

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const renderer = sceneInfra.getCubeGizmo(resolvedTheme)
    if (!renderer) return
    wrapper.appendChild(renderer.canvas)
    return () => {
      renderer.canvas.remove()
    }
    // Theme updates below preserve the editor-owned renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneInfra])

  useEffect(() => {
    sceneInfra.getCubeGizmo(resolvedTheme)?.setTheme(resolvedTheme)
  }, [sceneInfra, resolvedTheme])

  useEffect(() => {
    const renderer = sceneInfra.getCubeGizmo(resolvedTheme)
    if (!renderer) return
    renderer.setDisabled(disabled)
    renderer.canvas.style.pointerEvents = disabled ? 'none' : 'auto'
  }, [sceneInfra, resolvedTheme, disabled])

  return (
    <div
      ref={wrapperRef}
      style={{ cursor: disabled ? 'not-allowed' : 'auto' }}
      aria-label="View orientation gizmo"
      data-testid={`gizmo${disabled ? '-disabled' : ''}`}
      className="grid place-content-center rounded-full overflow-hidden pointer-events-auto"
    />
  )
}
