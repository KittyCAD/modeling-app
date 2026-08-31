import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useService } from '@src/app/context'
import { engineConnectionService } from '@src/contracts/engine'
import { cameraDriverService } from '@src/contracts/scene'
import { themeService } from '@src/contracts/theme'
import type { EngineCamera } from '@src/features/engineScene/createEngineCamera'
import type { GizmoRenderer } from '@src/features/engineScene/gizmoRenderer'
import './viewGizmo.css'

/**
 * The cube gizmo.
 *
 * A thin wrapper, as it is in the existing app: the component owns a canvas and a
 * lifetime, and everything else is in `GizmoRenderer`. Which is the right split
 * for something whose content is a WebGL scene — re-creating it on a render would
 * mean reloading a model and four textures.
 */
export function CubeGizmo({ camera }: { camera: EngineCamera }) {
  const themes = useService(themeService)
  const engine = useService(engineConnectionService)
  const drivers = useService(cameraDriverService)

  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<GizmoRenderer | null>(null)

  /**
   * Loaded on demand, because THREE.js is most of a megabyte.
   *
   * It is the only thing in the app that needs it, and it is not needed until
   * somebody has a scene to look at — so importing it here keeps it out of the
   * chunk that has to arrive before anything appears. The axis gizmo needs none
   * of it, and somebody who chose that never downloads it at all.
   */
  useEffect(() => {
    const element = canvas.current
    if (!element) return

    let disposed = false

    void import('@src/features/engineScene/gizmoRenderer')
      .then(({ GizmoRenderer }) => {
        // Unmounted while the chunk was in flight, which is ordinary: the
        // viewport can be torn down before a network round trip finishes.
        if (disposed) return

        renderer.current = new GizmoRenderer(
          element,
          themes.resolved.peek() === 'light' ? 'light' : 'dark',
          {
            camera,
            driver: () => drivers,
            // The engine's own render target, which is the pixel space a drag
            // has to be expressed in.
            viewport: () => engine.viewportSize.peek(),
          }
        )
      })
      .catch((error) => {
        console.error('gizmo: could not load the cube renderer', error)
      })

    return () => {
      disposed = true
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [camera, drivers, engine, themes])

  // Follows the theme without remounting: the materials are already built for
  // both, and swapping them is what `setTheme` is for.
  useSignalEffect(() => {
    const theme = themes.resolved.value
    renderer.current?.setTheme(theme === 'light' ? 'light' : 'dark')
  })

  return (
    <div class="zds-gizmo zds-gizmo--cube" aria-label="View orientation gizmo">
      {/*
        No accessible content: a lit cube is not describable, and everything it
        can do is a named-view command reachable from the palette and from `v`.
      */}
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  )
}
