/** How far a pointer may travel and still be a contextual click. */
const CONTEXT_CLICK_SLOP_PX = 4

export interface ContextMenuClick {
  clientX: number
  clientY: number
}

export interface ContextMenuClickRecogniserDependencies {
  onClick: (click: ContextMenuClick) => void
}

/**
 * Recognise a native context-menu request only after it proves not to be a drag.
 *
 * Browsers disagree about whether `contextmenu` arrives before or after
 * `pointerup`. Both orders are represented explicitly: an early context event
 * waits for release, while a late one consults the release that just happened.
 * Movement beyond the click slop cancels either route.
 */
export function createContextMenuClickRecogniser(
  element: HTMLElement,
  { onClick }: ContextMenuClickRecogniserDependencies
): () => void {
  interface Press {
    pointerId: number
    x: number
    y: number
    dragged: boolean
    pendingContext: ContextMenuClick | null
  }

  let press: Press | null = null
  let release: { dragged: boolean } | null = null

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      press = null
      release = null
      return
    }

    press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragged: false,
      pendingContext: null,
    }
    release = null
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!press || press.pointerId !== event.pointerId || press.dragged) {
      return
    }

    press.dragged =
      Math.hypot(event.clientX - press.x, event.clientY - press.y) >
      CONTEXT_CLICK_SLOP_PX
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!press || press.pointerId !== event.pointerId) {
      return
    }

    const completed = press
    press = null
    release = { dragged: completed.dragged }

    if (completed.pendingContext && !completed.dragged) {
      release = null
      onClick(completed.pendingContext)
    }
  }

  const onPointerCancel = () => {
    press = null
    release = null
  }

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const click = { clientX: event.clientX, clientY: event.clientY }

    // An event at (0, 0) is conventionally keyboard-originated. There is no
    // pointer drag to wait for, even if the last pointer happened to move.
    if (event.clientX === 0 && event.clientY === 0) {
      onClick(click)
      return
    }

    if (press) {
      press.pendingContext = click
      return
    }

    if (release) {
      const completed = release
      release = null
      if (!completed.dragged) {
        onClick(click)
      }
      return
    }

    // Synthetic context-menu events and platforms without Pointer Events have
    // no gesture to reconcile. Preserving that fallback keeps the component
    // usable without making the pointer path eager again.
    onClick(click)
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointercancel', onPointerCancel)
  element.addEventListener('contextmenu', onContextMenu)

  return () => {
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointermove', onPointerMove)
    element.removeEventListener('pointerup', onPointerUp)
    element.removeEventListener('pointercancel', onPointerCancel)
    element.removeEventListener('contextmenu', onContextMenu)
  }
}
