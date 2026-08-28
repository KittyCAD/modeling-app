/**
 * A click on the scene, as distinct from a drag of it.
 *
 * The camera already owns dragging, and under every one of the seven gesture
 * conventions a *drag* is what moves the view. So a selection click is a press
 * and a release in nearly the same place: press, move less than a few pixels,
 * release. Without the distance check, the last frame of an orbit would select
 * whatever the pointer happened to be over.
 *
 * Left button only. The right and middle buttons belong to the camera in every
 * convention, and taking a click from them would fight the guard table rather
 * than compose with it.
 */

/** How far the pointer may travel and still count as a click. */
const SLOP_PX = 4

export interface ClickRecogniserDependencies {
  onClick: (event: PointerEvent) => void
}

export function createClickRecogniser(
  element: HTMLElement,
  { onClick }: ClickRecogniserDependencies
): () => void {
  let start: { x: number; y: number; pointerId: number } | null = null

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      start = null
      return
    }
    start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  const onPointerUp = (event: PointerEvent) => {
    const pressed = start
    start = null

    if (!pressed || pressed.pointerId !== event.pointerId) return

    const travelled = Math.hypot(
      event.clientX - pressed.x,
      event.clientY - pressed.y
    )
    if (travelled > SLOP_PX) return

    onClick(event)
  }

  const onPointerCancel = () => {
    start = null
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointercancel', onPointerCancel)

  return () => {
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointerup', onPointerUp)
    element.removeEventListener('pointercancel', onPointerCancel)
  }
}

/**
 * What a click's modifiers mean.
 *
 * Shift adds and Alt removes, which is what every CAD package and every file
 * manager does. Nothing here is configurable yet; when it is, it belongs in the
 * camera's guard table beside the rest of the mouse conventions.
 */
export function selectionModeFor(
  event: Pick<PointerEvent, 'shiftKey' | 'altKey'>
): 'replace' | 'add' | 'remove' {
  if (event.altKey) return 'remove'
  if (event.shiftKey) return 'add'
  return 'replace'
}
