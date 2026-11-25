import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { DprDetector } from '@src/lib/DprDetector'

/** Observe canvas layout without writing layout inside a ResizeObserver delivery. */
export function observeViewportSize(element: HTMLElement, resize: () => void) {
  let active = true
  let frame: number | undefined
  const observer = new ResizeObserver(() => {
    if (!active || frame !== undefined) return
    frame = window.requestAnimationFrame(() => {
      frame = undefined
      if (active) resize()
    })
  })
  observer.observe(element)
  return () => {
    active = false
    observer.disconnect()
    if (frame !== undefined) window.cancelAnimationFrame(frame)
  }
}

/** Pixel density can change between displays without changing the viewport's CSS size. */
export function observeViewportDensity(resize: () => void) {
  const detector = new DprDetector(resize)
  return () => detector.dispose()
}

/** Safari's streamed-video resize workaround; other browsers retain the host's normal sizing. */
export function streamVideoObjectFit(userAgent: string) {
  return /^((?!chrome|android).)*safari/i.test(userAgent) ? 'fill' : 'contain'
}

/** Resize the drawing surfaces before recomputing camera dimensions. */
export function resizeSceneCanvas(
  scene: Pick<SceneInfra, 'onCanvasResized'> & {
    camControls: Pick<SceneInfra['camControls'], 'onWindowResize'>
  }
) {
  scene.onCanvasResized()
  scene.camControls.onWindowResize()
}
