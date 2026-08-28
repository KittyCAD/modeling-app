import type { EngineConnection } from '@src/contracts/engine'
import type {
  CameraInteraction,
  MouseGuard,
} from '@src/features/engineScene/camera/mouseGuards'
import { interactionFor } from '@src/features/engineScene/camera/mouseGuards'

/**
 * How often a drag reports while the pointer is moving.
 *
 * The engine re-renders and re-streams a frame for each one, so sending every
 * pointer event buys nothing a viewer can see and costs a queue that runs behind
 * the pointer. Fifteen a second is what the existing app settled on.
 */
const MOVE_INTERVAL_MS = 1000 / 15

export interface CameraInteractionDependencies {
  connection: EngineConnection
  /** Read per event, so changing the preference takes effect mid-session. */
  guard: () => MouseGuard
  orbit: () => 'spherical' | 'trackball'
  /** Injectable for tests; defaults to `window.devicePixelRatio`. */
  pixelRatio?: () => number
}

/**
 * Turn pointer input over the stream into camera commands.
 *
 * The scene lives on the engine, so there is no local camera to move: a drag is
 * a message, and what comes back is a video frame. That makes this much smaller
 * than a client-side orbit control — there is no matrix maths here at all — but
 * it also means every gesture has to be translated into the engine's own
 * coordinate space, which is the stream's pixels rather than the element's.
 */
export function createCameraInteraction(
  element: HTMLElement,
  dependencies: CameraInteractionDependencies
): () => void {
  const { connection, guard, orbit } = dependencies
  const pixelRatio = dependencies.pixelRatio ?? (() => window.devicePixelRatio)

  let dragging: CameraInteraction | null = null
  let pointerId: number | null = null
  /** Null until the first move of a drag, which is never throttled. */
  let lastSentAt: number | null = null
  let pendingMove: { x: number; y: number } | null = null
  let moveTimer: number | undefined

  /**
   * Element coordinates in the engine's pixels.
   *
   * The element is almost never the size of the stream — the stream's dimensions
   * are clamped to what the engine accepts, and the panel is whatever the user
   * dragged it to — so a click at the element's midpoint has to arrive as the
   * midpoint of the *frame*.
   */
  const toStreamCoordinates = (event: { clientX: number; clientY: number }) => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }

    const stream = connection.viewportSize.peek()
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * stream.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * stream.height),
    }
  }

  const connected = () => connection.state.peek().status === 'connected'

  const interactionOf = (event: MouseEvent | WheelEvent) => {
    // Touch has no buttons or modifiers to read, so it gets the one-finger
    // gesture rather than nothing at all.
    if ('pointerType' in event && event.pointerType === 'touch') {
      return orbit() === 'trackball' ? 'rotatetrackball' : 'rotate'
    }
    return interactionFor(guard(), event, orbit())
  }

  const flushMove = () => {
    moveTimer = undefined
    if (!dragging || !pendingMove) return
    lastSentAt = performance.now()
    connection.fireCommand({
      type: 'camera_drag_move',
      interaction: dragging,
      window: pendingMove,
    })
    pendingMove = null
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!connected()) return
    const interaction = interactionOf(event)
    if (!interaction) return

    // Capture, so a drag that leaves the element keeps orbiting instead of
    // stopping halfway with the button still down.
    element.setPointerCapture(event.pointerId)
    pointerId = event.pointerId
    dragging = interaction
    lastSentAt = null
    pendingMove = null

    event.preventDefault()
    connection.fireCommand({
      type: 'camera_drag_start',
      interaction,
      window: toStreamCoordinates(event),
    })
  }

  const onPointerMove = (event: PointerEvent) => {
    if (dragging === null || event.pointerId !== pointerId) return

    pendingMove = toStreamCoordinates(event)
    // Explicitly unbounded for the first move rather than relying on the clock
    // having started long ago, which is only true outside a test.
    const since =
      lastSentAt === null
        ? Number.POSITIVE_INFINITY
        : performance.now() - lastSentAt
    if (since >= MOVE_INTERVAL_MS) {
      flushMove()
      return
    }
    // Trailing edge, so the gesture ends where the pointer actually is rather
    // than wherever the last interval happened to land.
    if (moveTimer === undefined) {
      moveTimer = window.setTimeout(flushMove, MOVE_INTERVAL_MS - since)
    }
  }

  const endDrag = (event: PointerEvent) => {
    if (dragging === null || event.pointerId !== pointerId) return

    const interaction = dragging
    dragging = null
    pointerId = null
    pendingMove = null
    if (moveTimer !== undefined) {
      window.clearTimeout(moveTimer)
      moveTimer = undefined
    }

    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId)
    }

    connection.fireCommand({
      type: 'camera_drag_end',
      interaction,
      window: toStreamCoordinates(event),
    })
  }

  const onWheel = (event: WheelEvent) => {
    if (!connected()) return
    if (interactionOf(event) !== 'zoom') return

    // Otherwise the page scrolls behind the viewport, which on a trackpad means
    // the whole panel drifts while you are trying to zoom.
    event.preventDefault()
    connection.fireCommand({
      type: 'default_camera_zoom',
      magnitude: (-1 * event.deltaY) / pixelRatio(),
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
    if (moveTimer !== undefined) window.clearTimeout(moveTimer)

    // A drag interrupted by the viewport unmounting still has to be closed off,
    // or the engine keeps orbiting against a pointer that no longer exists.
    if (dragging !== null) {
      connection.fireCommand({
        type: 'camera_drag_end',
        interaction: dragging,
        window: { x: 0, y: 0 },
      })
      dragging = null
    }
  }
}
