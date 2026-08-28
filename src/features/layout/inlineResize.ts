import type { Signal } from '@preact/signals'

/** Defaults for a rail region: narrow enough to be a strip, wide enough to read. */
export const DEFAULT_MIN_EXTENT = 180
export const DEFAULT_MAX_EXTENT = 720

export interface InlineResizeOptions {
  /**
   * Which way a rightward drag moves the edge.
   *
   * `1` when the resized thing is to the left of its handle, `-1` when it is to
   * the right — a rail docked to the inline end widens as the pointer moves
   * left.
   */
  direction: 1 | -1
  min?: number
  max?: number
}

/**
 * Drag and keyboard handlers for one inline resize handle.
 *
 * Shared because there are now two of these — a rail's outer edge and the file
 * column inside the code panel — and they have to agree about the things that
 * are easy to get subtly different: pointer capture, the clamp, and the fact
 * that a handle is a `separator` a keyboard can nudge.
 *
 * Writes straight to the extent signal rather than reporting a delta. Preact
 * subscribes a signal-valued `style` directly, so a drag frame is one style
 * write instead of a re-render of the panel and everything in it.
 */
export function inlineResizeHandlers(
  extent: Signal<number>,
  { direction, min, max }: InlineResizeOptions
) {
  const lower = min ?? DEFAULT_MIN_EXTENT
  const upper = max ?? DEFAULT_MAX_EXTENT
  const clamp = (value: number) => Math.min(Math.max(value, lower), upper)

  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()

      const handle = event.currentTarget as HTMLElement
      handle.setPointerCapture(event.pointerId)

      const startX = event.clientX
      const startExtent = extent.peek()

      const onMove = (move: PointerEvent) => {
        extent.value = clamp(startExtent + (move.clientX - startX) * direction)
      }

      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },

    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()

      const step =
        (event.shiftKey ? 40 : 12) * (event.key === 'ArrowRight' ? 1 : -1)
      extent.value = clamp(extent.peek() + step * direction)
    },
  }
}
