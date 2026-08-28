import type {
  CameraDriver,
  CameraGestureKind,
  ScenePoint,
} from '@src/contracts/scene'
import type { MouseGuard } from '@src/features/camera/mouseGuards'
import { interactionFor } from '@src/features/camera/mouseGuards'

export interface GestureRecogniserDependencies {
  /** Read per event: a renderer can appear and disappear under the viewport. */
  driver: () => CameraDriver | undefined
  guard: () => MouseGuard
  orbit: () => 'spherical' | 'trackball'
  /** Injectable for tests; defaults to `window.devicePixelRatio`. */
  pixelRatio?: () => number
}

/**
 * Turn pointer input over the scene into camera gestures.
 *
 * Everything here is true of any renderer: which gesture a button and a modifier
 * mean, holding the pointer through a drag that leaves the element, treating a
 * touch as an orbit because it has no buttons to read, and keeping the context
 * menu out of the way of a right-drag.
 *
 * What it deliberately does *not* know is how a gesture becomes camera motion.
 * That is the driver's, because the answer differs completely: the streamed
 * engine wants its own pixel space and charges a re-render and a re-stream per
 * message, while a renderer running in this process can follow the pointer every
 * frame. Rate-limiting here would impose the remote renderer's cost on a local
 * one.
 */
export function createGestureRecogniser(
  element: HTMLElement,
  dependencies: GestureRecogniserDependencies
): () => void {
  const { driver, guard, orbit } = dependencies
  const pixelRatio = dependencies.pixelRatio ?? (() => window.devicePixelRatio)

  let dragging: CameraGestureKind | null = null
  let pointerId: number | null = null

  /**
   * Where the pointer is, in the element's own pixels.
   *
   * The size it was measured against travels with it, because that is what a
   * driver needs to map into whatever space its renderer works in.
   */
  const pointAt = (event: { clientX: number; clientY: number }): ScenePoint => {
    const rect = element.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      viewport: { width: rect.width, height: rect.height },
    }
  }

  const active = () => {
    const current = driver()
    return current?.ready.peek() ? current : undefined
  }

  const interactionOf = (event: MouseEvent | WheelEvent) => {
    // Touch has no buttons or modifiers to read, so it gets the one-finger
    // gesture rather than nothing at all.
    if ('pointerType' in event && event.pointerType === 'touch') {
      return orbit() === 'trackball' ? 'rotatetrackball' : 'rotate'
    }
    return interactionFor(guard(), event, orbit())
  }

  const onPointerDown = (event: PointerEvent) => {
    const current = active()
    if (!current) return
    const kind = interactionOf(event)
    if (!kind) return

    // Capture, so a drag that leaves the element keeps orbiting instead of
    // stopping halfway with the button still down.
    element.setPointerCapture(event.pointerId)
    pointerId = event.pointerId
    dragging = kind

    event.preventDefault()
    current.gesture({ kind, phase: 'start', at: pointAt(event) })
  }

  const onPointerMove = (event: PointerEvent) => {
    if (dragging === null || event.pointerId !== pointerId) return
    active()?.gesture({
      kind: dragging,
      phase: 'move',
      at: pointAt(event),
    })
  }

  const endDrag = (event: PointerEvent) => {
    if (dragging === null || event.pointerId !== pointerId) return

    const kind = dragging
    dragging = null
    pointerId = null

    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId)
    }

    active()?.gesture({ kind, phase: 'end', at: pointAt(event) })
  }

  const onWheel = (event: WheelEvent) => {
    const current = active()
    if (!current) return
    if (interactionOf(event) !== 'zoom') return

    // Otherwise the page scrolls behind the viewport, which on a trackpad means
    // the whole panel drifts while you are trying to zoom.
    event.preventDefault()
    current.zoom({
      magnitude: (-1 * event.deltaY) / pixelRatio(),
      at: pointAt(event),
    })
  }

  /**
   * Suppress the context menu.
   *
   * Right-drag is rotate under four of the seven conventions, and without this
   * the menu opens on top of the model on mouse-up.
   */
  const onContextMenu = (event: MouseEvent) => event.preventDefault()

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', endDrag)
  element.addEventListener('pointercancel', endDrag)
  element.addEventListener('contextmenu', onContextMenu)
  // Not passive: the handler has to be able to prevent the page from scrolling.
  element.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointermove', onPointerMove)
    element.removeEventListener('pointerup', endDrag)
    element.removeEventListener('pointercancel', endDrag)
    element.removeEventListener('contextmenu', onContextMenu)
    element.removeEventListener('wheel', onWheel)

    // A drag interrupted by the viewport unmounting still has to be closed off,
    // or a renderer keeps orbiting against a pointer that no longer exists.
    if (dragging !== null) {
      active()?.gesture({
        kind: dragging,
        phase: 'end',
        at: { x: 0, y: 0, viewport: { width: 0, height: 0 } },
      })
      dragging = null
    }
  }
}
